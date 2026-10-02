import { spawn } from 'child_process';
import { foreignReply, wellFormedReply } from './config';
import { RESPONDERS, Transport } from './responders';

/**
 * ClientTCP, ClientRedis, ClientMqtt and ClientRMQ await `deserializer.deserialize()`
 * inside an async listener that the socket, the broker library or the event emitter
 * never awaits. A custom deserializer that throws on a reply (for example because
 * another publisher on the reply topic sent a payload of another shape) turns
 * into an unhandled rejection: Node exits with code 1, and without a handler the
 * request would never settle.
 *
 * Each case runs the client in a child process, so one crash does not stop the
 * others. A plain responder in this process answers every request.
 *
 *   docker run --rm -d --name redis-repro -p 16379:6379 redis:7-alpine
 *   docker run --rm -d --name mqtt-repro -p 11883:1883 eclipse-mosquitto:2 mosquitto -c /mosquitto-no-auth.conf
 *   docker run --rm -d --name rmq-repro -p 15672:5672 rabbitmq:3.13
 *   npm run repro
 */
type Outcome = 'resolved' | 'rejected' | 'still pending' | 'crashed';

const CRASHED = 1;
const STILL_PENDING = 3;

const CASES: {
  transport: Transport;
  reply: (id: string) => string;
  expected: Outcome;
  note: string;
}[] = [
  ...(['tcp', 'redis', 'mqtt', 'rmq'] as const).flatMap(transport => [
    {
      transport,
      reply: foreignReply,
      // The request id is unknown, so only RMQ can fail the exact request.
      expected: (transport === 'rmq' ? 'rejected' : 'still pending') as Outcome,
      note:
        transport === 'rmq'
          ? 'the request fails with the deserializer error'
          : 'the packet is dropped and the process keeps running',
    },
    {
      transport,
      reply: wellFormedReply,
      expected: 'resolved' as Outcome,
      note: 'baseline: the request resolves',
    },
  ]),
];

function runClient(transport: Transport): Promise<{ exitCode: number | null; stdout: string; keyLine: string }> {
  // A child process lets us observe the exit code without inheriting the crash. It has to be
  // async: the responder lives in this process and must keep answering.
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['-r', 'ts-node/register', 'src/client-case.ts', transport], {
      timeout: 20000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => (stdout += chunk));
    child.stderr.on('data', chunk => (stderr += chunk));
    child.on('close', exitCode => {
      const keyLine = stderr.split('\n').find(line => /^\w*Error: /.test(line)) ?? '(none)';
      resolve({ exitCode, stdout: stdout.trim(), keyLine: keyLine.trim() });
    });
  });
}

function outcomeOf(exitCode: number | null, stdout: string): Outcome {
  if (exitCode === STILL_PENDING) return 'still pending';
  if (exitCode !== 0) return 'crashed';
  return stdout.includes('send() rejected') ? 'rejected' : 'resolved';
}

async function main() {
  let failed = 0;
  for (const { transport, reply, expected, note } of CASES) {
    const stop = await RESPONDERS[transport](reply);
    const { exitCode, stdout, keyLine } = await runClient(transport);
    await stop();

    const outcome = outcomeOf(exitCode, stdout);
    const callerLine = stdout.split('\n').find(line => line.startsWith('send() r')) ?? '(none)';
    console.log(
      `=== ${transport.toUpperCase()}: ${reply === foreignReply ? 'reply the deserializer rejects' : 'well-formed reply'} ===`,
    );
    console.log(`  expected:    ${expected} (${note})`);
    console.log(`  outcome:     ${outcome}${exitCode === CRASHED ? ' (process exit code 1)' : ''}`);
    console.log(`  exit code:   ${exitCode}`);
    console.log(`  caller got:  ${callerLine}`);
    console.log(`  stderr line: ${keyLine}`);
    console.log('');
    failed += outcome === expected ? 0 : 1;
  }

  console.log(
    failed === 0
      ? 'RESULT: FIXED: no client crashed, and RMQ failed the request with the deserializer error.'
      : `RESULT: BUG: ${failed} of ${CASES.length} cases did not end as expected (a crashed client exits with code 1).`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
