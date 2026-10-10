import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Outbox, OutboxModule, OutboxStorage, type NewOutboxMessage } from '@nestjs/outbox';
import { fromMysql2, MySqlOutboxStore } from '@nestjs/outbox/mysql';
import mysql, { type Pool } from 'mysql2/promise';

const KILOBYTE = 1024;
const SORT_MEMORY_ERROR = 'Out of sort memory';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('Set DATABASE_URL, for example mysql://root:root@127.0.0.1:53306/outbox_repro');
}

const textOfKilobytes = (kilobytes: number) => 'x'.repeat(kilobytes * KILOBYTE);
const smallMessage = (): NewOutboxMessage => ({ topic: 'demo', payload: { n: 1 } });

const cases: { name: string; messages: NewOutboxMessage[]; isControl?: true }[] = [
  { name: '100 KB payload (control)', isControl: true, messages: [{ topic: 'demo', payload: { text: textOfKilobytes(100) } }] },
  { name: '300 KB payload', messages: [{ topic: 'demo', payload: { text: textOfKilobytes(300) } }] },
  { name: '300 KB headers', messages: [{ topic: 'demo', payload: { n: 1 }, headers: { text: textOfKilobytes(300) } }] },
  {
    name: 'batch: 300 KB payload + 10 small',
    messages: [{ topic: 'demo', payload: { text: textOfKilobytes(300) } }, ...Array.from({ length: 10 }, smallMessage)],
  },
];

interface CaseResult {
  name: string;
  isControl: boolean;
  outcome: string;
  failedWithSortMemory: boolean;
  businessRowSurvived: boolean;
}

function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const code = 'code' in error && typeof error.code === 'string' ? `${error.code}: ` : '';
  return `${code}${error.message.split('\n')[0]}`;
}

// The server is shared by every run, so each run drops and creates its own database.
async function createCleanDatabase(url: string): Promise<void> {
  const serverUrl = new URL(url);
  const databaseName = decodeURIComponent(serverUrl.pathname.slice(1));
  serverUrl.pathname = '';
  const admin = mysql.createPool({ uri: serverUrl.toString(), connectionLimit: 1 });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${mysql.escapeId(databaseName)}`);
    await admin.query(`CREATE DATABASE ${mysql.escapeId(databaseName)}`);
  } finally {
    await admin.end();
  }
}

async function runCase(pool: Pool, outbox: Outbox, index: number, testCase: (typeof cases)[number]): Promise<CaseResult> {
  const businessRowId = `case-${index}`;
  const connection = await pool.getConnection();
  let outcome = 'ok';
  try {
    await connection.beginTransaction();
    await connection.query('INSERT INTO business_rows (id) VALUES (?)', [businessRowId]);
    await outbox.add(connection, testCase.messages);
    await connection.commit();
  } catch (error) {
    outcome = describeFailure(error);
    await connection.rollback();
  } finally {
    connection.release();
  }
  const [rows] = await pool.query('SELECT id FROM business_rows WHERE id = ?', [businessRowId]);
  return {
    name: testCase.name,
    isControl: testCase.isControl === true,
    outcome,
    failedWithSortMemory: outcome.includes(SORT_MEMORY_ERROR),
    businessRowSurvived: Array.isArray(rows) && rows.length === 1,
  };
}

function judge(results: CaseResult[]): string {
  const control = results.find((result) => result.isControl);
  const largeCases = results.filter((result) => !result.isControl);
  if (control?.outcome !== 'ok') {
    return 'INCONCLUSIVE: the control case failed';
  }
  if (largeCases.every((result) => result.outcome === 'ok')) {
    return 'OK: every case passed';
  }
  if (largeCases.some((result) => result.failedWithSortMemory)) {
    return 'BUG: the control passed and a large message failed with the sort-memory error';
  }
  return 'INCONCLUSIVE: a large case failed with another error';
}

async function main(url: string): Promise<void> {
  await createCleanDatabase(url);
  const pool = mysql.createPool({ uri: url, connectionLimit: 3 });

  @Module({
    imports: [OutboxModule.forRoot()],
    providers: [
      {
        provide: MySqlOutboxStore,
        inject: [OutboxStorage],
        useFactory: (storage: OutboxStorage) => new MySqlOutboxStore({ executor: fromMysql2(pool) }, storage),
      },
    ],
  })
  class AppModule {}

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    await pool.query('CREATE TABLE business_rows (id varchar(64) PRIMARY KEY)');
    const [versionRows] = await pool.query('SELECT VERSION() AS version, @@sort_buffer_size AS sortBufferSize');
    if (Array.isArray(versionRows) && versionRows[0]) {
      console.log(`MySQL ${JSON.stringify(versionRows[0])}`);
    }

    const outbox = app.get(Outbox);
    const results: CaseResult[] = [];
    for (const [index, testCase] of cases.entries()) {
      const result = await runCase(pool, outbox, index, testCase);
      results.push(result);
      console.log(`${result.name.padEnd(34)} ${result.outcome} | business row survived: ${result.businessRowSurvived}`);
    }
    console.log(`\nRESULT: ${judge(results)}`);
  } finally {
    await app.close();
    await pool.end();
  }
}

await main(databaseUrl);
