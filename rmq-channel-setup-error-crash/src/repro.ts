import { spawnSync } from 'child_process';
import * as amqp from 'amqplib';
import { QUEUE, RMQ_URL } from './config';

/**
 * A channel setup function that throws (here: assertQueue against a queue that
 * exists with other arguments) makes amqp-connection-manager emit 'error' on the
 * ChannelWrapper. Nest never listens to it, so Node kills the process.
 *
 *   docker run --rm -d --name rmq-repro -p 5672:5672 rabbitmq:3.13
 *   npm run repro
 */
const CASES = [
  { name: 'ClientRMQ: await client.connect()', script: 'src/client-case.ts' },
  { name: 'ServerRMQ: await app.listen()', script: 'src/server-case.ts' },
];

async function withDurableQueue<T>(run: () => T): Promise<T> {
  const connection = await amqp.connect(RMQ_URL);
  const channel = await connection.createChannel();
  await channel.assertQueue(QUEUE, { durable: true });
  try {
    return run();
  } finally {
    await channel.deleteQueue(QUEUE);
    await connection.close();
  }
}

function runCase({ script }: { script: string }) {
  // Run in a child process to observe the exit code without inheriting the crash.
  const child = spawnSync(process.execPath, ['-r', 'ts-node/register', script], {
    encoding: 'utf8',
    timeout: 20000,
  });
  const keyLine =
    child.stderr.split('\n').find(line => line.startsWith('Error: Operation failed')) ??
    '(none)';
  return { exitCode: child.status, stdout: child.stdout.trim(), keyLine: keyLine.trim() };
}

async function main() {
  const results = await withDurableQueue(() => CASES.map(runCase));

  let crashed = 0;
  CASES.forEach(({ name }, index) => {
    const { exitCode, stdout, keyLine } = results[index];
    console.log(`=== ${name} (queue declared durable, requested non-durable) ===`);
    console.log('  expected: rejected with the 406 error, process keeps running (exit code 0)');
    console.log(`  stdout:      ${(stdout || '(nothing printed)').replaceAll('\n', '\n               ')}`);
    console.log(`  stderr line: ${keyLine}`);
    console.log(`  exit code:   ${exitCode}`);
    console.log('');
    crashed += exitCode === 0 ? 0 : 1;
  });

  console.log('=== RESULT ===');
  console.log(
    crashed === 0
      ? '  FIXED: both cases rejected with the 406 error and the process kept running.'
      : `  BUG: ${crashed} of ${CASES.length} cases crashed the process instead of rejecting.`,
  );
  process.exitCode = crashed === 0 ? 0 : 1;
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
