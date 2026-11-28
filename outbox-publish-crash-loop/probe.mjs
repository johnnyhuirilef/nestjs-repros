import 'reflect-metadata';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { PostgresOutboxStore, fromDrizzle } from '@nestjs/outbox/postgres';
import { OutboxRelay } from '@nestjs/outbox';

const RUNS = 5;
const LEASE = 300;
const [role, dir, mode] = process.argv.slice(2);

async function open(dir) {
  const client = new PGlite(dir);
  const db = drizzle(client);
  const store = new PostgresOutboxStore({ executor: fromDrizzle(db), migrate: true });
  await store.onModuleInit();
  return { client, db, store };
}

if (role === 'seed') {
  // Two messages with the same key: `first` must be handled before `second` is published
  const { client, db, store } = await open(dir);
  const message = (id) => ({
    id, topic: 'order.placed', key: 'order-1', payload: { id }, headers: {},
    createdAt: Date.now(), availableAt: Date.now(), attempts: 0, lastError: null,
  });
  await db.transaction((tx) => store.add(tx, [message('first'), message('second')]));
  await client.close();
} else if (role === 'relay') {
  // One relay process. The transport fails on `first`: it throws (mode "throw"),
  // or the process dies while publishing, as with an OOM kill (mode "crash").
  const { store } = await open(dir);
  const relay = new OutboxRelay({
    store,
    transports: {
      broker: {
        async publish(message) {
          if (message.id !== 'first') return;
          if (mode === 'crash') process.exit(137);
          throw new Error('broker rejected the message');
        },
      },
    },
    relay: { lease: LEASE, publishTimeout: 100 },
    retry: { attempts: 3, backoff: { delay: 0 } },
    logger: { log() {}, warn() {}, error() {}, debug() {}, verbose() {} },
  });
  await relay.runOnce();
  process.exit(0);
} else if (role === 'inspect') {
  const { client } = await open(dir);
  const rows = (await client.query('SELECT id, attempts FROM nest_outbox.messages ORDER BY seq')).rows;
  const dead = (await client.query('SELECT id FROM nest_outbox.dead_letters')).rows.map((r) => r.id);
  console.log(JSON.stringify({ pending: rows, deadLetters: dead }));
  await client.close();
} else {
  const node = (...args) =>
    spawnSync(process.execPath, [import.meta.filename, ...args], { encoding: 'utf8' });
  const scenario = async (label, mode) => {
    const dir = mkdtempSync(join(tmpdir(), 'outbox-crash-loop-'));
    node('seed', dir);
    console.log(label);
    let last;
    for (let run = 1; run <= RUNS; run++) {
      const relay = node('relay', dir, mode);
      last = JSON.parse(node('inspect', dir).stdout);
      const pending = last.pending.map((m) => `${m.id} (attempts ${m.attempts})`).join(', ') || 'none';
      console.log(`  relay run ${run}: exit ${relay.status}, pending: ${pending}, dead letters: ${last.deadLetters.join(', ') || 'none'}`);
      await new Promise((resolve) => setTimeout(resolve, LEASE + 100)); // the lease expires
    }
    rmSync(dir, { recursive: true, force: true });
    return last;
  };

  console.log(`Two messages with key "order-1", retry.attempts 3, ${RUNS} relay runs.\n`);
  const thrown = await scenario('publish of "first" throws (control):', 'throw');
  console.log();
  const crashed = await scenario('publish of "first" kills the process (exit 137):', 'crash');

  const stuck = crashed.deadLetters.length === 0 && crashed.pending.some((m) => m.id === 'second');
  const control = thrown.deadLetters.includes('first') && thrown.pending.length === 0;
  if (control && stuck) {
    console.log('\nRESULT: BUG: a message whose publish kills the process never uses up its attempts, is never dead-lettered, and "second" is never published.');
    process.exit(1);
  }
  console.log(`\nRESULT: ${control ? 'FIXED' : 'UNEXPECTED: the control did not dead-letter "first"'}`);
  process.exit(control ? 0 : 2);
}
