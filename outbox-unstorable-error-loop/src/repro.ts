import 'reflect-metadata';
import { PGlite } from '@electric-sql/pglite';
import { Inject, Injectable, Module, type LoggerService } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { OnOutboxMessage, Outbox, OutboxEvents, OutboxModule, OutboxRelay, OutboxStorage } from '@nestjs/outbox';
import { fromDrizzle, fromPg, PostgresOutboxStore, type SqlExecutor } from '@nestjs/outbox/postgres';
import { drizzle } from 'drizzle-orm/pglite';
import pg from 'pg';

const RETRY_ATTEMPTS = 3;
const OBSERVE_MS = 4_000;

// V8 puts the unparsable input into the message. The emoji is cut in half, which leaves a lone surrogate.
const runs = [
  { name: 'control', input: 'x not json' },
  { name: 'bug', input: '😀 not json' },
];

// With DATABASE_URL set, the script uses a real PostgreSQL server. Without it, it uses PGlite.
const databaseUrl = process.env.DATABASE_URL;

interface Database {
  executor: SqlExecutor<'postgres'>;
  addInTransaction(work: (transaction: unknown) => Promise<void>): Promise<void>;
  readAttempts(): Promise<number | undefined>;
  close(): Promise<void>;
}

async function openPglite(): Promise<Database> {
  const client = new PGlite();
  const db = drizzle({ client });
  return {
    executor: fromDrizzle(db),
    addInTransaction: (work) => db.transaction((tx) => work(tx)),
    readAttempts: async () => (await client.query<{ attempts: number }>('SELECT attempts FROM nest_outbox.messages')).rows[0]?.attempts,
    close: () => client.close(),
  };
}

async function openPostgres(connectionString: string): Promise<Database> {
  const pool = new pg.Pool({ connectionString });
  // Each run starts from an empty schema, so repeated runs give the same result.
  await pool.query('DROP SCHEMA IF EXISTS nest_outbox CASCADE');
  return {
    executor: fromPg(pool),
    addInTransaction: async (work) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await work(client);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    readAttempts: async () => (await pool.query<{ attempts: number }>('SELECT attempts FROM nest_outbox.messages')).rows[0]?.attempts,
    close: () => pool.end(),
  };
}

class HandlerProbe {
  calls = 0;
  constructor(readonly failWith: string) {}
}

@Injectable()
class DemoHandler {
  constructor(@Inject(HandlerProbe) private readonly probe: HandlerProbe) {}

  @OnOutboxMessage('demo', { consumer: 'demo' })
  handle() {
    this.probe.calls++;
    JSON.parse(this.probe.failWith);
  }
}

// Counts the store errors the relay logs, so the repetition is visible without flooding the output.
class ErrorCounter implements LoggerService {
  storeFailures = 0;
  firstFailure = '';
  otherErrors = 0;
  firstOtherError = '';

  error(message: unknown) {
    const firstLine = String(message).split('\n')[0];
    if (firstLine.includes('Outbox store fail failed')) {
      this.storeFailures++;
      this.firstFailure ||= firstLine;
    } else {
      this.otherErrors++;
      this.firstOtherError ||= firstLine;
    }
  }
  log() {}
  warn() {}
}

async function observe(run: (typeof runs)[number]) {
  const database = await (databaseUrl ? openPostgres(databaseUrl) : openPglite());
  const probe = new HandlerProbe(run.input);

  @Module({
    imports: [
      OutboxModule.forRoot({
        relay: { pollInterval: 50, lease: '600ms' },
        retry: { attempts: RETRY_ATTEMPTS, backoff: { delay: 100, factor: 1, jitter: 'none' } },
      }),
    ],
    providers: [
      DemoHandler,
      { provide: HandlerProbe, useValue: probe },
      {
        provide: PostgresOutboxStore,
        inject: [OutboxStorage],
        useFactory: (storage: OutboxStorage) => new PostgresOutboxStore({ executor: database.executor }, storage),
      },
    ],
  })
  class AppModule {}

  const logger = new ErrorCounter();
  const app = await NestFactory.createApplicationContext(AppModule, { logger });

  const eventCounts = new Map<string, number>();
  app.get(OutboxEvents).events$.subscribe(({ type }) => eventCounts.set(type, (eventCounts.get(type) ?? 0) + 1));

  await database.addInTransaction(async (transaction) => {
    await app.get(Outbox).add(transaction, { topic: 'demo', payload: {} });
  });
  app.get(Outbox).notify();
  await new Promise((resolve) => setTimeout(resolve, OBSERVE_MS));

  const stats = await app.get(OutboxRelay).stats();
  const attempts = await database.readAttempts();
  await app.close();
  await database.close();

  const result = {
    handlerCalls: probe.calls,
    pending: stats.pending,
    deadLetters: stats.deadLetters,
    attempts,
    storeFailures: logger.storeFailures,
    otherErrors: logger.otherErrors,
  };

  console.log(`--- ${run.name}: handler throws JSON.parse(${JSON.stringify(run.input)}) ---`);
  console.log(`handler calls:   ${result.handlerCalls}`);
  const seen = [...eventCounts].map(([type, count]) => `${type}=${count}`).join(' ');
  console.log(`events:          ${seen || 'none'}`);
  console.log(`stats:           pending=${result.pending} deadLetters=${result.deadLetters}`);
  console.log(`row attempts:    ${result.attempts ?? 'row is gone'}`);
  console.log(`store log:       "Outbox store fail failed" logged ${result.storeFailures} times`);
  if (logger.firstFailure) console.log(`first one:       ${logger.firstFailure}`);
  console.log(`other errors:    ${result.otherErrors}`);
  if (logger.firstOtherError) console.log(`first one:       ${logger.firstOtherError}`);
  console.log();
  return result;
}

const [control, bug] = [await observe(runs[0]), await observe(runs[1])];

const controlWorks = control.handlerCalls === RETRY_ATTEMPTS && control.deadLetters === 1;
const bugLoops = bug.handlerCalls > RETRY_ATTEMPTS && bug.deadLetters === 0 && bug.attempts === 0;

// The loop is the bug, not a failed script: exit 0 whatever the result.
if (controlWorks && bugLoops) {
  console.log('RESULT: BUG: the message with the unstorable error was never retried or dead-lettered');
  console.log(`        (${bug.handlerCalls} handler calls, limit is ${RETRY_ATTEMPTS}; attempts stays ${bug.attempts})`);
} else if (controlWorks && bug.deadLetters === 1) {
  console.log('RESULT: OK: both messages were dead-lettered');
} else {
  console.log('RESULT: INCONCLUSIVE: the runs did not match either known pattern');
}
