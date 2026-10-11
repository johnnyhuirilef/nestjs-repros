import 'reflect-metadata';
import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Workflow, WorkflowClient, WorkflowsModule, WorkflowStorage, type WorkflowContext } from '@nestjs/workflows';
import { fromMysql2, MySqlWorkflowStore } from '@nestjs/workflows/mysql';
import { fromPg, PostgresWorkflowStore } from '@nestjs/workflows/postgres';
import mysql from 'mysql2/promise';
import pg from 'pg';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Set ${name}, for example MYSQL_URL=mysql://root:root@127.0.0.1:53307`);
  }
  return value;
}

const mysqlUrl = requiredEnv('MYSQL_URL');
const postgresUrl = requiredEnv('POSTGRES_URL');

const WATCH_SECONDS = 10;
const TERMINAL = ['completed', 'failed', 'cancelled', 'compensation_failed'];

// The step name of the current case. A workflow reads it when it runs.
let stepName = 'n';

@Workflow('leaf')
class Leaf {
  async run(_ctx: WorkflowContext) {
    return 'ok';
  }
}

// The engine builds the child id as `<parent id>/leaf#1`.
@Workflow('parent')
class Parent {
  async run(ctx: WorkflowContext) {
    await ctx.executeChild('leaf', {});
    return 'done';
  }
}

// The engine writes the compensation as `$compensate:<step>`.
@Workflow('compensating')
class Compensating {
  async run(ctx: WorkflowContext) {
    await ctx.step(stepName, async () => 1, { compensate: async () => {} });
    throw new Error('boom');
  }
}

@Workflow('plain')
class Plain {
  async run(ctx: WorkflowContext) {
    await ctx.step(stepName, async () => 1);
    return 'done';
  }
}

type Db = 'mysql' | 'postgres';
interface Case {
  name: string;
  db: Db;
  workflow: new () => object;
  id: string;
  step?: string;
  isControl?: true;
}

const MYSQL_CASES: Omit<Case, 'db'>[] = [
  { name: 'control: short names', workflow: Plain, id: 'control', step: 'pay', isControl: true },
  { name: 'child id 256 chars', workflow: Parent, id: 'p'.repeat(249) },
  { name: '$compensate: name 513 chars', workflow: Compensating, id: 'compensating', step: 's'.repeat(501) },
  { name: 'step name 513 chars', workflow: Plain, id: 'plain', step: 's'.repeat(513) },
];
const POSTGRES_CASES: Omit<Case, 'db'>[] = MYSQL_CASES.filter((c) => c.name !== 'control: short names');
const cases: Case[] = [
  ...MYSQL_CASES.map((c) => ({ ...c, db: 'mysql' as const })),
  ...POSTGRES_CASES.map((c) => ({ ...c, db: 'postgres' as const })),
];

// Collect what the engine logs as errors instead of printing every stack trace.
let loggedErrors: string[] = [];
Logger.overrideLogger({
  log() {},
  warn() {},
  debug() {},
  verbose() {},
  error(message: unknown, ...rest: unknown[]) {
    const detail = rest.find((item): item is Error => item instanceof Error);
    loggedErrors.push(detail ? `${detail.name}: ${detail.message}` : String(message));
  },
});

const trim = (text: string, max = 150) => (text.length > max ? `${text.slice(0, max)}...` : text);

async function createStore(testCase: Case, storage: WorkflowStorage, schema: string): Promise<{ store: object; close: () => Promise<void> }> {
  if (testCase.db === 'mysql') {
    const admin = await mysql.createConnection({ uri: mysqlUrl });
    await admin.query(`CREATE DATABASE ${mysql.escapeId(schema)}`);
    await admin.end();
    const pool = mysql.createPool({ uri: `${mysqlUrl}/${schema}`, connectionLimit: 3 });
    return { store: new MySqlWorkflowStore({ executor: fromMysql2(pool) }, storage), close: () => pool.end() };
  }
  const pool = new pg.Pool({ connectionString: postgresUrl, max: 3 });
  return { store: new PostgresWorkflowStore({ executor: fromPg(pool), schema }, storage), close: () => pool.end() };
}

interface Outcome {
  timeline: string;
  runs: number;
  finalStatus: string;
  error: string;
  errorCount: number;
}

async function runCase(testCase: Case, index: number): Promise<Outcome> {
  stepName = testCase.step ?? 'n';
  loggedErrors = [];
  const schema = `wf_repro_${Date.now() % 1_000_000}_${index}`;
  let closeStore = async () => {};
  const Store = testCase.db === 'mysql' ? MySqlWorkflowStore : PostgresWorkflowStore;

  @Module({
    imports: [WorkflowsModule.forRoot({ worker: { pollInterval: '200ms', leaseDuration: '3s', heartbeatInterval: '1s' } })],
    providers: [
      Leaf,
      Parent,
      Compensating,
      Plain,
      {
        provide: Store,
        inject: [WorkflowStorage],
        useFactory: async (storage: WorkflowStorage) => {
          const created = await createStore(testCase, storage, schema);
          closeStore = created.close;
          return created.store;
        },
      },
    ],
  })
  class AppModule {}

  const app = await NestFactory.createApplicationContext(AppModule);
  const client = app.get(WorkflowClient);
  const timeline: string[] = [];
  let last = { status: 'none', runs: 0 };
  try {
    await client.start(testCase.workflow, {}, { id: testCase.id });
    const startedAt = Date.now();
    for (let i = 0; i < WATCH_SECONDS; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const instance = (await client.list({ limit: 100 })).find((item) => item.id === testCase.id);
      if (!instance) {
        continue;
      }
      if (instance.status !== last.status || instance.runs !== last.runs) {
        last = { status: instance.status, runs: instance.runs };
        timeline.push(`${instance.status}@${Math.round((Date.now() - startedAt) / 1000)}s`);
      }
      if (TERMINAL.includes(instance.status)) {
        break;
      }
    }
  } finally {
    await app.close();
    await closeStore();
  }
  return {
    timeline: timeline.join(' -> '),
    runs: last.runs,
    finalStatus: last.status,
    error: loggedErrors.find((message) => message.startsWith('RangeError')) ?? loggedErrors[0] ?? '-',
    errorCount: loggedErrors.length,
  };
}

function judge(results: { testCase: Case; outcome: Outcome }[]): string {
  const control = results.find((r) => r.testCase.isControl);
  if (control?.outcome.finalStatus !== 'completed') {
    return 'INCONCLUSIVE: the MySQL control did not finish';
  }
  const stuck = (r: (typeof results)[number]) => !TERMINAL.includes(r.outcome.finalStatus) && r.outcome.runs >= 3;
  const mysqlStuck = results.filter((r) => r.testCase.db === 'mysql' && !r.testCase.isControl && stuck(r));
  const postgresDone = results.filter((r) => r.testCase.db === 'postgres').every((r) => TERMINAL.includes(r.outcome.finalStatus));
  if (mysqlStuck.length > 0 && postgresDone) {
    return `BUG: ${mysqlStuck.length} MySQL case(s) re-run until the lease expires again, and the same workflows finish on PostgreSQL`;
  }
  if (mysqlStuck.length === 0) {
    return 'OK: every MySQL case reached a final status';
  }
  return 'INCONCLUSIVE: PostgreSQL did not finish a case';
}

const results: { testCase: Case; outcome: Outcome }[] = [];
for (const [index, testCase] of cases.entries()) {
  const outcome = await runCase(testCase, index);
  results.push({ testCase, outcome });
  console.log(`case:    ${testCase.name}`);
  console.log(`db:      ${testCase.db}`);
  console.log(`status:  ${outcome.timeline || 'none'}`);
  console.log(`runs:    ${outcome.runs}  (logged errors: ${outcome.errorCount})`);
  console.log(`error:   ${trim(outcome.error)}\n`);
}
console.log(`RESULT: ${judge(results)}`);
