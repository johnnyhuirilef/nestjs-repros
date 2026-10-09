import 'reflect-metadata';
import { PGlite } from '@electric-sql/pglite';
import { Inject, Injectable, Module, type LoggerService } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  OnOutboxMessage,
  Outbox,
  OutboxError,
  OutboxModule,
  OutboxStorage,
  type NewOutboxMessage,
  type OutboxHandlerContext,
} from '@nestjs/outbox';
import { fromDrizzle, fromPg, PostgresOutboxStore, type SqlExecutor } from '@nestjs/outbox/postgres';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import pg from 'pg';

const DELIVERY_TIMEOUT_MS = 3_000;

// V8 puts the unparsable input into the message. The emoji is cut in half, which leaves a lone surrogate.
function realJsonParseErrorMessage(): string {
  try {
    JSON.parse('😀 not json');
  } catch (error) {
    if (error instanceof Error) return error.message;
    throw error;
  }
  throw new Error('JSON.parse accepted the input');
}

interface Case {
  name: string;
  isControl: boolean;
  message: NewOutboxMessage;
}

const cases: Case[] = [
  { name: 'control', isControl: true, message: { topic: 'demo', payload: { text: 'hello' } } },
  { name: 'payload U+0000', isControl: false, message: { topic: 'demo', payload: { text: 'a\u0000b' } } },
  {
    name: 'payload lone surrogate',
    isControl: false,
    message: { topic: 'demo', payload: { text: realJsonParseErrorMessage() } },
  },
  { name: 'header U+0000', isControl: false, message: { topic: 'demo', payload: {}, headers: { note: 'a\u0000b' } } },
];

// With DATABASE_URL set, the script uses a real PostgreSQL server. Without it, it uses PGlite.
const databaseUrl = process.env.DATABASE_URL;

interface Backend {
  name: string;
  /** Undefined means the in-memory store: the module registers no store of its own. */
  executor: SqlExecutor<'postgres'> | undefined;
  /** Runs `work` with a transaction handle and a function that inserts one business row. */
  inTransaction(work: (transaction: unknown, insertOrder: () => Promise<void>) => Promise<void>): Promise<void>;
  /** Undefined when the backend has no business table. */
  countOrders(): Promise<number | undefined>;
  resetOrders(): Promise<void>;
  close(): Promise<void>;
}

const memoryBackend: Backend = {
  name: 'in-memory',
  executor: undefined,
  // The docs say the in-memory store cannot join a transaction. It takes any handle, so a plain object is enough.
  inTransaction: (work) => work({}, async () => {}),
  countOrders: async () => undefined,
  resetOrders: async () => {},
  close: async () => {},
};

async function openPglite(): Promise<Backend> {
  const client = new PGlite();
  const db = drizzle({ client });
  await client.query('CREATE TABLE orders (id serial PRIMARY KEY)');
  return {
    name: 'PostgreSQL (PGlite)',
    executor: fromDrizzle(db),
    inTransaction: (work) => db.transaction((tx) => work(tx, async () => void (await tx.execute(sql`INSERT INTO orders DEFAULT VALUES`)))),
    countOrders: async () => (await client.query<{ count: number }>('SELECT count(*)::int AS count FROM orders')).rows[0]?.count,
    resetOrders: async () => void (await client.query('DELETE FROM orders')),
    close: () => client.close(),
  };
}

async function openPostgres(connectionString: string): Promise<Backend> {
  const pool = new pg.Pool({ connectionString });
  // Each run starts from empty tables, so repeated runs give the same result.
  await pool.query('DROP SCHEMA IF EXISTS nest_outbox CASCADE');
  await pool.query('DROP TABLE IF EXISTS orders');
  await pool.query('CREATE TABLE orders (id serial PRIMARY KEY)');
  return {
    name: 'PostgreSQL (server)',
    executor: fromPg(pool),
    inTransaction: async (work) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await work(client, async () => void (await client.query('INSERT INTO orders DEFAULT VALUES')));
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    countOrders: async () => (await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM orders')).rows[0]?.count,
    resetOrders: async () => void (await pool.query('DELETE FROM orders')),
    close: () => pool.end(),
  };
}

interface Delivery {
  messageId: string;
  payload: unknown;
  headers: unknown;
}

class Deliveries {
  readonly received: Delivery[] = [];
}

@Injectable()
class DemoHandler {
  constructor(@Inject(Deliveries) private readonly deliveries: Deliveries) {}

  @OnOutboxMessage('demo', { consumer: 'demo' })
  handle(payload: unknown, context: OutboxHandlerContext) {
    this.deliveries.received.push({ messageId: context.message.id, payload, headers: context.message.headers });
  }
}

// Collects relay errors so the output stays short and nothing is hidden.
class ErrorCollector implements LoggerService {
  readonly errors: string[] = [];
  error(message: unknown) {
    this.errors.push(String(message).split('\n')[0]);
  }
  log() {}
  warn() {}
}

function hasCode(value: unknown): value is { code: unknown } {
  return typeof value === 'object' && value !== null && 'code' in value;
}

// Drivers and ORMs wrap the PostgreSQL error, so the code can sit on the error or on its cause.
function findErrorCode(error: Error): string {
  for (const candidate of [error, error.cause]) {
    if (hasCode(candidate) && typeof candidate.code === 'string') return candidate.code;
  }
  return 'no-code';
}

function describeCause(error: Error): string {
  const root = error.cause instanceof Error ? error.cause : error;
  return root.message.split('\n')[0];
}

interface Observation {
  store: string;
  caseName: string;
  isControl: boolean;
  /** Undefined when the add succeeded. */
  failure: { errorClass: string; code: string; message: string; isOutboxError: boolean; isTypeError: boolean } | undefined;
  ordersAfter: number | undefined;
  delivery: { delivered: boolean; containsNul: boolean } | undefined;
}

const containsNul = (value: unknown) => JSON.stringify(value).includes(String.raw`\u0000`);

async function waitForDelivery(deliveries: Deliveries, messageId: string): Promise<Delivery | undefined> {
  const deadline = Date.now() + DELIVERY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const found = deliveries.received.find((delivery) => delivery.messageId === messageId);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return undefined;
}

async function observeStore(backend: Backend): Promise<Observation[]> {
  const deliveries = new Deliveries();
  const { executor } = backend;

  @Module({
    imports: [OutboxModule.forRoot({ relay: { pollInterval: 50 } })],
    providers: [
      DemoHandler,
      { provide: Deliveries, useValue: deliveries },
      ...(executor
        ? [
            {
              provide: PostgresOutboxStore,
              inject: [OutboxStorage],
              useFactory: (storage: OutboxStorage) => new PostgresOutboxStore({ executor }, storage),
            },
          ]
        : []),
    ],
  })
  class AppModule {}

  const app = await NestFactory.createApplicationContext(AppModule, { logger: new ErrorCollector() });
  const outbox = app.get(Outbox);
  const observations: Observation[] = [];

  for (const testCase of cases) {
    await backend.resetOrders();
    const message = { ...testCase.message, id: `${backend.name}-${testCase.name}`.replace(/\W+/g, '-') };
    let failure: Observation['failure'];
    try {
      await backend.inTransaction(async (transaction, insertOrder) => {
        await insertOrder();
        await outbox.add(transaction, message);
      });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      failure = {
        errorClass: error.constructor.name,
        code: findErrorCode(error),
        message: describeCause(error),
        isOutboxError: error instanceof OutboxError,
        isTypeError: error instanceof TypeError,
      };
    }

    let delivery: Observation['delivery'];
    if (!backend.executor && !failure) {
      outbox.notify();
      const received = await waitForDelivery(deliveries, message.id);
      delivery = { delivered: received !== undefined, containsNul: received !== undefined && (containsNul(received.payload) || containsNul(received.headers)) };
    }
    observations.push({
      store: backend.name,
      caseName: testCase.name,
      isControl: testCase.isControl,
      failure,
      ordersAfter: await backend.countOrders(),
      delivery,
    });
  }

  await app.close();
  await backend.close();
  return observations;
}

function printObservation(o: Observation) {
  const outcome = o.failure ? `${o.failure.errorClass} ${o.failure.code}: ${o.failure.message}` : 'ok';
  const kinds = o.failure ? ` OutboxError=${o.failure.isOutboxError} TypeError=${o.failure.isTypeError}` : '';
  const orders = o.ordersAfter === undefined ? '' : ` orders-after=${o.ordersAfter}`;
  const delivery = o.delivery ? ` delivered: ${o.delivery.delivered} hasNul=${o.delivery.containsNul}` : '';
  console.log(`${o.store.padEnd(20)} | ${o.caseName.padEnd(22)} | add: ${outcome}${kinds}${orders}${delivery}`);
}

const memory = await observeStore(memoryBackend);
const postgres = await observeStore(await (databaseUrl ? openPostgres(databaseUrl) : openPglite()));
[...memory, ...postgres].forEach(printObservation);
console.log();

const controlsWork = [...memory, ...postgres].filter((o) => o.isControl).every((o) => !o.failure);
const memoryAcceptsAll = memory.every((o) => !o.failure && o.delivery?.delivered);
const unstorable = postgres.filter((o) => !o.isControl);
const postgresThrowsRawDriverError = unstorable.every((o) => o.failure && !o.failure.isOutboxError && !o.failure.isTypeError);
const postgresAcceptsAll = unstorable.every((o) => !o.failure);

// The bug is the result, not a failed script: exit 0 whatever it is.
if (!controlsWork) {
  console.log('RESULT: INCONCLUSIVE: the control message failed');
} else if (memoryAcceptsAll && postgresThrowsRawDriverError) {
  console.log('RESULT: BUG: the in-memory store accepts and delivers these messages, but PostgreSQL throws a raw driver error');
} else if (memoryAcceptsAll && postgresAcceptsAll) {
  console.log('RESULT: OK: both stores accept these messages');
} else {
  console.log('RESULT: INCONCLUSIVE: the runs did not match either known pattern');
}
