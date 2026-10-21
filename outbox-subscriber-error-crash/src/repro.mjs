import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Each scenario runs in its own process, because a crash ends the process.
const scenario = fileURLToPath(new URL('./scenario.mjs', import.meta.url));

// What the relay's try/catch around emit() is there for: log the error and keep running.
const CAUGHT = 'the relay logs "Outbox event subscriber threw", exit code 0';
const SCENARIOS = [
  ['a subscriber that does not throw (control)', 'control', 'exit code 0'],
  ['an events$ subscriber that throws', 'events$', CAUGHT],
  ['a diagnostics_channel subscriber that throws', 'channel', CAUGHT],
];

let crashed = 0;
for (const [name, mode, expected] of SCENARIOS) {
  const run = spawnSync(process.execPath, [scenario, mode], { encoding: 'utf8' });
  const error = run.stderr.split('\n').find((line) => /^\w*Error/.test(line));
  if (run.status !== 0) crashed++;
  console.log(`=== ${name} ===`);
  process.stdout.write(run.stdout);
  if (error) console.log(`  uncaught:      ${error}`);
  console.log(`  exit code:     ${run.status}`);
  console.log(`  expected:      ${expected}\n`);
}

console.log(
  crashed === 0
    ? `RESULT: FIXED: the process keeps running in all ${SCENARIOS.length} scenarios.`
    : `RESULT: BUG: the process crashes in ${crashed} of ${SCENARIOS.length} scenarios.`,
);
process.exitCode = crashed === 0 ? 0 : 1;
