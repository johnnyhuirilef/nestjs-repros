import { spawn } from 'child_process';
import { connect } from '@nats-io/transport-node';
import { NATS_URL, SUBJECT } from './config';

/**
 * ClientNats deserializes each reply inside an async subscription callback that
 * nats-core calls without awaiting it. A reply that is not valid JSON, sent by a
 * responder that is not a Nest server, makes JSON.parse throw inside that
 * callback: an unhandled rejection kills the process, and without a handler the
 * request would never settle.
 *
 *   docker run --rm -d --name nats-repro -p 4222:4222 -p 8222:8222 nats -m 8222
 *   npm run repro
 */
const CASES = [
  { name: 'reply is not JSON ("not json")', reply: 'not json', expected: 'rejected' },
  { name: 'reply is valid JSON (baseline)', reply: '{"response":"ok","isDisposed":true}', expected: 'resolved' },
];

const EXPECTED_LINE = {
  rejected: 'send() rejected with the parse error, process keeps running (exit code 0)',
  resolved: 'send() resolves with "ok", process keeps running (exit code 0)',
};

function runClient(): Promise<{ exitCode: number | null; stdout: string; keyLine: string }> {
  // A child process lets us observe the exit code without inheriting the crash. It has to be
  // async: the responder below lives in this process and must keep answering.
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['-r', 'ts-node/register', 'src/client-case.ts'], {
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

async function main() {
  const responder = await connect({ servers: [NATS_URL] });
  let reply = '';
  responder.subscribe(SUBJECT, { callback: (_err, msg) => msg.respond(reply) });
  await responder.flush();

  let failed = 0;
  for (const { name, reply: payload, expected } of CASES) {
    reply = payload;
    const { exitCode, stdout, keyLine } = await runClient();
    console.log(`=== ${name} ===`);
    console.log(`  expected: ${EXPECTED_LINE[expected]}`);
    console.log(`  stdout:      ${(stdout || '(nothing printed)').replaceAll('\n', '\n               ')}`);
    console.log(`  stderr line: ${keyLine}`);
    console.log(`  exit code:   ${exitCode}`);
    console.log('');
    failed += exitCode === 0 ? 0 : 1;
  }
  await responder.close();

  console.log('=== RESULT ===');
  console.log(
    failed === 0
      ? '  FIXED: the non-JSON reply failed the request and the process kept running.'
      : `  BUG: ${failed} of ${CASES.length} cases ended without settling the request cleanly.`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
