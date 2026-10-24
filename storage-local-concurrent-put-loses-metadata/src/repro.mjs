// Four puts on the same key, each with its own metadata, on a LocalDisk of @nestjs/storage.
// After all of them resolve, the file that stays should keep the metadata of the put that wrote it.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDisk } from '@nestjs/storage';

const KEYS = 200;
const root = await mkdtemp(join(tmpdir(), 'storage-repro-'));
const disk = new LocalDisk({ root });

const put = (key, writer) =>
  disk.put(key, `body from ${writer}`, { contentType: 'text/plain', metadata: { writer } });

async function check(title, write) {
  let lost = 0;
  let example;
  for (let i = 0; i < KEYS; i++) {
    const key = `${title.split(' ')[0]}/file-${i}.txt`;
    await write(key);
    const stat = await disk.stat(key);
    const body = await streamText((await disk.get(key)).body);
    if (stat.metadata?.writer !== body.replace('body from ', '')) {
      lost++;
      example ??= { key, body, contentType: stat.contentType, metadata: stat.metadata };
    }
  }
  console.log(`=== ${title} ===`);
  console.log(`  keys where the file and its metadata do not match: ${lost} of ${KEYS}`);
  if (example) console.log(`  example: ${JSON.stringify(example)}`);
  console.log();
  return lost;
}

async function streamText(stream) {
  let text = '';
  for await (const chunk of stream) text += chunk;
  return text;
}

const control = await check('sequential puts (control)', async (key) => {
  await put(key, 'A');
  await put(key, 'B');
});
const concurrent = await check('concurrent puts', (key) => Promise.all(['A', 'B', 'C', 'D'].map((writer) => put(key, writer))));

await rm(root, { recursive: true, force: true });

if (control === 0 && concurrent > 0) {
  console.log(`RESULT: BUG: after four concurrent puts, ${concurrent} of ${KEYS} files lost the metadata of the put that wrote them.`);
  process.exitCode = 1;
} else {
  console.log('RESULT: FIXED: every file keeps the metadata of the put that wrote it.');
}
