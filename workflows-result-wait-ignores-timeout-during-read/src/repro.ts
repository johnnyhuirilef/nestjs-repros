import 'reflect-metadata';
import { Inject, Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  InMemoryWorkflowStore,
  Workflow,
  WorkflowClient,
  WorkflowsModule,
  WorkflowStorage,
  type WorkflowContext,
  type WorkflowRunner,
} from '@nestjs/workflows';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The in-memory store, with a get() that takes `readDelayMs` to answer,
// as a database under load or behind a slow network would.
@Injectable()
class SlowReadStore extends InMemoryWorkflowStore {
  readDelayMs = 0;

  constructor(@Inject(WorkflowStorage) storage: WorkflowStorage) {
    super();
    storage.registerSource(this);
  }

  override async get(...args: Parameters<InMemoryWorkflowStore['get']>) {
    await sleep(this.readDelayMs);
    return super.get(...args);
  }
}

// A workflow that runs for an hour, so the wait can only end by its timeout or its signal.
@Workflow('report')
class ReportWorkflow implements WorkflowRunner<Record<string, never>, string> {
  async run(ctx: WorkflowContext): Promise<string> {
    await ctx.sleep('render', '1h');
    return 'done';
  }
}

@Module({
  imports: [WorkflowsModule.forRoot({ worker: false })],
  providers: [SlowReadStore, ReportWorkflow],
})
class AppModule {}

const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
const store = app.get(SlowReadStore);
const client = app.get(WorkflowClient);

// Runs one wait and returns how long it took to settle.
const measure = async (label: string, wait: () => Promise<unknown>) => {
  const startedAt = performance.now();
  let outcome: string;
  try {
    await wait();
    outcome = 'resolved';
  } catch (error) {
    outcome = `rejected with ${(error as Error).name}`;
  }
  const ms = Math.round(performance.now() - startedAt);
  console.log(`  ${label.padEnd(34)} ${outcome}, after ${ms} ms`);
  return ms;
};

const late: string[] = [];
let run = 0;
for (const readDelayMs of [0, 3000]) {
  console.log(`\n=== store.get() takes ${readDelayMs} ms ===`);
  const waits: Array<[string, () => Promise<unknown>]> = [
    ['result(), timeout 200 ms', async () => {
      const { id } = await client.start(ReportWorkflow, {}, { id: `report-${++run}` });
      store.readDelayMs = readDelayMs;
      return client.result(id, { timeout: 200 });
    }],
    ['result(), signal aborts at 200 ms', async () => {
      const { id } = await client.start(ReportWorkflow, {}, { id: `report-${++run}` });
      store.readDelayMs = readDelayMs;
      return client.result(id, { signal: AbortSignal.timeout(200) });
    }],
    ['startAndWait(), timeout 200 ms', async () => {
      store.readDelayMs = readDelayMs;
      return client.startAndWait(ReportWorkflow, {}, { id: `report-${++run}` }, { timeout: 200 });
    }],
  ];
  for (const [label, wait] of waits) {
    store.readDelayMs = 0;
    const ms = await measure(label, wait);
    if (ms > 1000) late.push(`${label}, ${readDelayMs} ms read`);
  }
}

await app.close();

console.log(
  late.length
    ? `\nRESULT: BUG: ${late.length} waits ended more than 1 s after their 200 ms limit.`
    : '\nRESULT: OK: every wait ended near its 200 ms limit.',
);
process.exitCode = late.length ? 1 : 0;
