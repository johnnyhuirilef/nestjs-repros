import { spawnSync } from 'child_process';

/**
 * app.listen('<path>.sock') should listen on a Unix socket, as it does on
 * Express. On the Fastify adapter it throws a RangeError on a later tick that
 * nothing can catch, because the adapter turns every non-object argument into
 * { port: +argument } and +'<path>.sock' is NaN.
 *
 * Each case runs in its own child process (src/case.ts), because the Fastify
 * case crashes the process. A real HTTP client sends one request over the
 * socket or the port. Two Fastify baselines show what already works.
 *
 *   npm run repro
 */
const CASES = [
  { name: 'express: listen(socketPath)' },
  { name: 'fastify: listen(socketPath)' },
  { name: 'fastify: listen(0)' },
  { name: 'fastify: listen({ path })' },
];

function runCase(name: string) {
  const child = spawnSync(process.execPath, ['-r', 'ts-node/register', 'src/case.ts', name], {
    encoding: 'utf8',
    timeout: 20000,
  });
  if (child.status === 0) {
    return { ok: true, text: child.stdout.trim() };
  }
  const errorLine = child.stderr.split('\n').find(line => /Error/.test(line)) ?? `exit code ${child.status}`;
  return { ok: false, text: `crash: ${errorLine.trim()}` };
}

let failed = 0;
for (const { name } of CASES) {
  const outcome = runCase(name);
  console.log(`=== ${name} ===`);
  console.log(`  outcome:  ${outcome.text}`);
  console.log('');
  failed += outcome.ok ? 0 : 1;
}

if (failed) {
  console.log(`RESULT: BUG: ${failed} of ${CASES.length} cases did not listen (a socket path crashes the process on Fastify).`);
  process.exit(1);
}
console.log(`RESULT: FIXED: all ${CASES.length} cases listen and answer HTTP 200.`);
