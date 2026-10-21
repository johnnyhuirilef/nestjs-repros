import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  ManualWorkflowClock,
  Workflow,
  WorkflowClient,
  WorkflowsModule,
  WorkflowWorker,
  type WorkflowContext,
} from '@nestjs/workflows';

type StepOptions = { timeout?: string | number; heartbeatTimeout?: string | number };

const scenarios: { label: string; options: StepOptions; expected: string }[] = [
  { label: "timeout: '24d' (control)", options: { timeout: '24d' }, expected: 'completed after 1 run' },
  { label: "timeout: '30d'", options: { timeout: '30d' }, expected: 'completed after 1 run' },
  { label: "heartbeatTimeout: '30d'", options: { heartbeatTimeout: '30d' }, expected: 'completed after 1 run' },
];

const warnings: string[] = [];
process.on('warning', (warning) => warnings.push(`${warning.name}: ${warning.message.split('\n')[0]}`));

let bugs = 0;

for (const { label, options, expected } of scenarios) {
  let runs = 0;
  const clock = new ManualWorkflowClock();

  // The step takes 200 ms, far less than its timeout.
  @Workflow('report')
  class Report {
    async run(ctx: WorkflowContext) {
      return ctx.step(
        'build',
        async () => {
          runs++;
          await new Promise((resolve) => setTimeout(resolve, 200));
          return 'ok';
        },
        options,
      );
    }
  }

  @Module({
    // The worker runs by hand (drain()), and the clock moves only when told to.
    imports: [WorkflowsModule.forRoot({ worker: { enabled: false }, clock })],
    providers: [Report],
  })
  class AppModule {}

  warnings.length = 0;
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const client = app.get(WorkflowClient);
  const worker = app.get(WorkflowWorker);

  const startedAt = performance.now();
  await client.start(Report, undefined, { id: 'r-1' });
  await worker.drain();
  const firstAttemptMs = Math.round(performance.now() - startedAt);

  // Move the clock to each retry, until the run ends.
  let status = await client.getStatus('r-1');
  while (status?.status === 'suspended' && status.wakeAt) {
    clock.advance(status.wakeAt - clock.now());
    await worker.drain();
    status = await client.getStatus('r-1');
  }
  await app.close();

  const outcome = `${status?.status} after ${runs} run${runs === 1 ? '' : 's'}`;
  if (outcome !== expected) bugs++;
  console.log(`=== ${label} ===`);
  console.log(`  first attempt ended after: ${firstAttemptMs} ms`);
  console.log(`  outcome:                   ${outcome}`);
  if (status?.error) console.log(`  error:                     ${status.error.message}`);
  for (const warning of [...new Set(warnings)]) console.log(`  warning:                   ${warning}`);
  console.log(`  expected:                  ${expected}`);
  console.log();
}

if (bugs) {
  console.log(`RESULT: BUG: ${bugs} of ${scenarios.length} steps fail at once instead of running for 200 ms.`);
  process.exit(1);
}
console.log('RESULT: FIXED: every step completes.');
