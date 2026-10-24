// Runs the real `nest-outbox` CLI of @nestjs/outbox, which uses runStoreCli() of @nestjs/store-kit,
// against a port where nothing listens, and prints what the user sees on stderr.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cli = require.resolve('@nestjs/outbox/package.json').replace(/package\.json$/, 'dist/sql/cli.js');

function run(title, url) {
  const { status, stderr } = spawnSync(process.execPath, [cli, 'status', '--url', url], { encoding: 'utf8' });
  console.log(`=== ${title} ===`);
  console.log(`  npx @nestjs/outbox status --url ${url}`);
  console.log(`  exit code: ${status}`);
  console.log(`  stderr:    ${JSON.stringify(stderr)}`);
  console.log();
  return stderr;
}

const control = run('127.0.0.1, nothing listens (control)', 'postgres://user:pass@127.0.0.1:1/app');
const blank = run('localhost, nothing listens', 'postgres://user:pass@localhost:1/app');

if (blank.trim() === '' && control.trim() !== '') {
  console.log('RESULT: BUG: with localhost, the CLI exits 1 and prints an empty line instead of the connection error.');
  process.exitCode = 1;
} else {
  console.log('RESULT: FIXED: the CLI prints the connection error for localhost too.');
}
