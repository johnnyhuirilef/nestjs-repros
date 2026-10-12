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
    throw new Error(`Set ${name}, for example MYSQL_URL=mysql://root:root@127.0.0.1:53309`);
  }
  return value;
}

const mysqlUrl = requiredEnv('MYSQL_URL');
const postgresUrl = requiredEnv('POSTGRES_URL');

const WATCH_SECONDS = 10;
const TERMINAL = ['completed', 'failed', 'cancelled', 'compensation_failed'];

// A high surrogate with no low surrogate after it. A cut inside an emoji makes one.
const LONE_SURROGATE = 'x' + '😀'.slice(0, 1);
const NUL = 'a\u0000b';
const EMOJI_PAIR = 'x😀y';

// The value of the current case, and how many times a step body ran.
let value = '';
let stepBodyRuns = 0;

// Case (a): the step returns the value. The step body must run once.
@Workflow('step-result')
class StepResult {
  async run(ctx: WorkflowContext) {
    await ctx.step('s1', async () => {
      stepBodyRuns++;
      return { note: value };
    });
    return 'done';
  }
}

// Case (b): the step is fine, and the workflow returns the value.
@Workflow('final-return')
class FinalReturn {
  async run(ctx: WorkflowContext) {
    await ctx.step('s1', async () => {
      stepBodyRuns++;
      return 1;
    });
    return { note: value };
  }
}

type Db = 'memory' | 'postgres' | 'mysql';
interface Case {
  label: string;
  db: Db;
  workflow: new () => object;
  value: string;
  // What a correct engine does: the instance reaches a final status with one run.
  expectBad: boolean;
}

const cases: Case[] = [
  { label: '(c) control: in-memory, lone surrogate in a step result', db: 'memory', workflow: StepResult, value: LONE_SURROGATE, expectBad: false },
  { label: '(c) control: in-memory, U+0000 in the returned value', db: 'memory', workflow: FinalReturn, value: NUL, expectBad: false },
  { label: '(c) control: PostgreSQL, valid emoji pair in a step result', db: 'postgres', workflow: StepResult, value: EMOJI_PAIR, expectBad: false },
  { label: '(a) step result with a lone surrogate', db: 'postgres', workflow: StepResult, value: LONE_SURROGATE, expectBad: true },
  { label: '(a) step result with a lone surrogate', db: 'mysql', workflow: StepResult, value: LONE_SURROGATE, expectBad: true },
  { label: '(b) returned value with U+0000', db: 'postgres', workflow: FinalReturn, value: NUL, expectBad: true },
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

async function createStore(db: 'postgres' | 'mysql', storage: WorkflowStorage, schema: string): Promise<{ store: object; close: () => Promise<void> }> {
  if (db === 'mysql') {
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
  bodyRuns: number;
  error: string;
  errorCount: number;
}

async function runCase(testCase: Case, index: number): Promise<Outcome> {
  value = testCase.value;
  stepBodyRuns = 0;
  loggedErrors = [];
  const schema = `wf_unstorable_${Date.now() % 1_000_000}_${index}`;
  let closeStore = async () => {};

  const providers: object[] = [StepResult, FinalReturn];
  if (testCase.db !== 'memory') {
    const db = testCase.db;
    providers.push({
      provide: db === 'mysql' ? MySqlWorkflowStore : PostgresWorkflowStore,
      inject: [WorkflowStorage],
      useFactory: async (storage: WorkflowStorage) => {
        const created = await createStore(db, storage, schema);
        closeStore = created.close;
        return created.store;
      },
    });
  }

  @Module({
    imports: [WorkflowsModule.forRoot({ worker: { pollInterval: '200ms', leaseDuration: '3s', heartbeatInterval: '1s' } })],
    providers: providers as never[],
  })
  class AppModule {}

  const app = await NestFactory.createApplicationContext(AppModule);
  const client = app.get(WorkflowClient);
  const timeline: string[] = [];
  let last = { status: 'none', runs: 0 };
  let instanceError = '-';
  try {
    await client.start(testCase.workflow, {}, { id: 'unstorable' });
    const startedAt = Date.now();
    for (let i = 0; i < WATCH_SECONDS; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const instance = (await client.list({ limit: 100 })).find((item) => item.id === 'unstorable');
      if (!instance) {
        continue;
      }
      if (instance.status !== last.status || instance.runs !== last.runs) {
        last = { status: instance.status, runs: instance.runs };
        timeline.push(`${instance.status}(runs=${instance.runs})@${Math.round((Date.now() - startedAt) / 1000)}s`);
      }
      if (TERMINAL.includes(instance.status)) {
        const error = (instance as { error?: { message?: string } | null }).error;
        instanceError = error?.message ?? '-';
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
    bodyRuns: stepBodyRuns,
    error: instanceError !== '-' ? instanceError : (loggedErrors[0] ?? '-'),
    errorCount: loggedErrors.length,
  };
}

// A bad case reproduces when the engine does not finish it in one run:
// a step body ran more than once, or the instance never reached a final status
// and its run counter reached 3 or more.
const misbehaves = (o: Outcome) => o.bodyRuns > 1 || (!TERMINAL.includes(o.finalStatus) && o.runs >= 3);
// A control is fine when it completes in one run, and the step body runs once.
const controlFine = (o: Outcome) => o.finalStatus === 'completed' && o.runs === 1 && o.bodyRuns === 1;

function judge(results: { testCase: Case; outcome: Outcome }[]): string {
  const badControls = results.filter((r) => !r.testCase.expectBad && !controlFine(r.outcome));
  if (badControls.length > 0) {
    return `UNEXPECTED: ${badControls.length} control(s) did not complete in one run`;
  }
  const bad = results.filter((r) => r.testCase.expectBad);
  const reproduced = bad.filter((r) => misbehaves(r.outcome));
  if (reproduced.length === bad.length) {
    return `REPRODUCED: all ${bad.length} bad case(s) on SQL stores re-ran a step or looped, and the controls completed in one run`;
  }
  if (reproduced.length === 0) {
    return `OK: no bad case re-ran a step or looped (${bad.length} checked), and the controls completed in one run`;
  }
  return `UNEXPECTED: ${reproduced.length} of ${bad.length} bad case(s) misbehaved`;
}

const results: { testCase: Case; outcome: Outcome }[] = [];
for (const [index, testCase] of cases.entries()) {
  const outcome = await runCase(testCase, index);
  results.push({ testCase, outcome });
  console.log(`case:      ${testCase.label}`);
  console.log(`store:     ${testCase.db}`);
  console.log(`status:    ${outcome.timeline || 'none'}`);
  console.log(`runs:      ${outcome.runs}`);
  console.log(`step body: ${outcome.bodyRuns} run(s)`);
  console.log(`error:     ${trim(outcome.error)}  (logged errors: ${outcome.errorCount})\n`);
}
console.log(`RESULT: ${judge(results)}`);
