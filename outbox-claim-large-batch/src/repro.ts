import { fromMysql2, MySqlOutboxStore } from '@nestjs/outbox/mysql';
import { fromPg, PostgresOutboxStore } from '@nestjs/outbox/postgres';
import { Logger } from '@nestjs/common';
import mysql from 'mysql2/promise';
import pg from 'pg';

const MESSAGES = 10_000;
const BATCH_SIZES = [100, 1000, 5000, 10_000];
// A claim that scales linearly costs the same per message at every batch size.
// The run reports SLOW when a message costs more than this many times as much at 10000 as at 1000.
const SLOWDOWN_LIMIT = 2;
const BASE_BATCH_SIZE = 1000;

const mysqlUrl = process.env.MYSQL_URL ?? 'mysql://root:root@127.0.0.1:53308/outbox_repro';
const postgresUrl = process.env.POSTGRES_URL ?? 'postgres://postgres:postgres@127.0.0.1:55438/outbox_repro';

interface Timing {
  batchSize: number;
  claimed: number;
  claimMs: number;
  gapsMs?: number;
}

interface Target {
  name: string;
  run(): Promise<Timing[]>;
}

const round = (ms: number) => Math.round(ms);
const sinceStart = (start: number) => performance.now() - start;

/** One keyed message per row, all due now. Every key is distinct, so no message waits for another of its key. */
const seedRows = (count: number) => Array.from({ length: count }, (_, n) => ({ id: `id-${n}`, key: `key-${n}` }));

const mysqlTarget: Target = {
  name: 'MySQL 8.4',
  async run() {
    const pool = mysql.createPool({ uri: mysqlUrl, connectionLimit: 4 });
    // Time the statement that `gaps()` sends: it is the only one that starts with "(SELECT CAST(".
    let gapsMs = 0;
    const getConnection = pool.getConnection.bind(pool);
    pool.getConnection = async () => {
      const connection = await getConnection();
      for (const method of ['query', 'execute'] as const) {
        const original = connection[method].bind(connection) as (...args: unknown[]) => Promise<unknown>;
        (connection as unknown as Record<string, unknown>)[method] = async (sql: unknown, ...rest: unknown[]) => {
          const text = typeof sql === 'string' ? sql : (sql as { sql: string }).sql;
          const start = performance.now();
          try {
            return await original(sql, ...rest);
          } finally {
            if (text.startsWith('(SELECT CAST(')) {
              gapsMs += sinceStart(start);
            }
          }
        };
      }
      return connection;
    };

    try {
      await pool.query('DROP TABLE IF EXISTS repro_dead_letters, repro_inbox, repro_locks, repro_messages, repro_migrations');
      const store = new MySqlOutboxStore({ executor: fromMysql2(pool), schema: 'repro' });
      await store.migrate();
      const rows = seedRows(MESSAGES);
      const now = Date.now();
      for (let i = 0; i < rows.length; i += 5000) {
        const chunk = rows.slice(i, i + 5000);
        await pool.query(
          `INSERT INTO repro_messages (id, topic, payload, headers, \`key\`, created_at, available_at) VALUES ${chunk
            .map(() => '(?, ?, JSON_OBJECT(), JSON_OBJECT(), ?, ?, ?)')
            .join(',')}`,
          chunk.flatMap((row) => [row.id, 'demo', row.key, now - 1000, now - 1000]),
        );
      }
      await pool.query('ANALYZE TABLE repro_messages');

      const timings: Timing[] = [];
      await store.claim({ owner: 'warm-up', now: Date.now(), leaseMs: 30_000, limit: 1 });
      for (const batchSize of BATCH_SIZES) {
        await pool.query('UPDATE repro_messages SET lease_owner = NULL, lease_until = NULL');
        gapsMs = 0;
        const start = performance.now();
        const claimed = await store.claim({ owner: 'repro', now: Date.now(), leaseMs: 30_000, limit: batchSize });
        timings.push({ batchSize, claimed: claimed.length, claimMs: sinceStart(start), gapsMs });
      }
      return timings;
    } finally {
      await pool.end();
    }
  },
};

const postgresTarget: Target = {
  name: 'PostgreSQL 18.6',
  async run() {
    const pool = new pg.Pool({ connectionString: postgresUrl, max: 4 });
    try {
      await pool.query('DROP SCHEMA IF EXISTS repro CASCADE');
      const store = new PostgresOutboxStore({ executor: fromPg(pool), schema: 'repro' });
      await store.migrate();
      const rows = seedRows(MESSAGES);
      const now = Date.now();
      await pool.query(
        `INSERT INTO repro.messages (id, topic, payload, headers, key, created_at, available_at)
         SELECT id, 'demo', '{}', '{}', key, $3, $3 FROM unnest($1::text[], $2::text[]) AS r(id, key)`,
        [rows.map((row) => row.id), rows.map((row) => row.key), now - 1000],
      );
      await pool.query('ANALYZE repro.messages');

      const timings: Timing[] = [];
      await store.claim({ owner: 'warm-up', now: Date.now(), leaseMs: 30_000, limit: 1 });
      for (const batchSize of BATCH_SIZES) {
        await pool.query('UPDATE repro.messages SET lease_owner = NULL, lease_until = NULL');
        const start = performance.now();
        const claimed = await store.claim({ owner: 'repro', now: Date.now(), leaseMs: 30_000, limit: batchSize });
        timings.push({ batchSize, claimed: claimed.length, claimMs: sinceStart(start) });
      }
      return timings;
    } finally {
      await pool.end();
    }
  },
};

const perMessage = (timing: Timing) => timing.claimMs / timing.claimed;

async function main() {
  Logger.overrideLogger(false);
  console.log(`${MESSAGES} due messages, every one with its own key. One claim() per batch size.\n`);
  console.log('store            | batch size | claimed | claim ms | gaps ms | ms per message');
  const slow: string[] = [];
  for (const target of [mysqlTarget, postgresTarget]) {
    const timings = await target.run();
    for (const timing of timings) {
      console.log(
        [
          target.name.padEnd(16),
          String(timing.batchSize).padStart(10),
          String(timing.claimed).padStart(7),
          String(round(timing.claimMs)).padStart(8),
          (timing.gapsMs === undefined ? '-' : String(round(timing.gapsMs))).padStart(7),
          perMessage(timing).toFixed(3).padStart(14),
        ].join(' | '),
      );
    }
    const first = timings.find((timing) => timing.batchSize === BASE_BATCH_SIZE);
    const last = timings.at(-1);
    if (first === undefined || last === undefined) {
      continue;
    }
    const ratio = perMessage(last) / perMessage(first);
    if (ratio > SLOWDOWN_LIMIT) {
      slow.push(`${target.name} costs ${ratio.toFixed(1)}x more per message at ${last.batchSize} than at ${first.batchSize}`);
    }
  }
  console.log(
    slow.length > 0
      ? `\nRESULT: SLOW: ${slow.join('; ')} (limit ${SLOWDOWN_LIMIT}x)`
      : `\nRESULT: OK: no store costs more than ${SLOWDOWN_LIMIT}x more per message at the largest batch size`,
  );
}

await main();
