import 'reflect-metadata';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryDisk, LocalDisk, StorageError, type StorageDisk } from '@nestjs/storage';

// Only library errors are part of the output. Anything else is a bug in this script.
async function observe(action: () => Promise<unknown>): Promise<string> {
  try {
    const value = await action();
    return value === undefined ? 'ok' : JSON.stringify(value);
  } catch (error) {
    if (error instanceof StorageError) {
      return `${error.constructor.name}: ${error.message}`;
    }
    throw error;
  }
}

// A write is only reported as ok or as its error. Its result (size, etag) is not part of the bug.
function write(action: () => Promise<unknown>): Promise<string> {
  return observe(() => action().then(() => undefined));
}

async function keys(disk: StorageDisk): Promise<string[]> {
  return (await disk.list()).entries.map((entry) => entry.key);
}

// The same steps on each disk: store a file under `avatars/`, delete it, then store a file named `avatars`.
async function run(name: string, disk: StorageDisk, root?: string): Promise<boolean> {
  console.log(`=== ${name} ===`);
  console.log(`  put avatars/a.png:     ${await write(() => disk.put('avatars/a.png', 'png'))}`);
  console.log(`  delete avatars/a.png:  ${await write(() => disk.delete('avatars/a.png'))}`);
  console.log(`  exists avatars:        ${await observe(() => disk.exists('avatars'))}`);
  console.log(`  list:                  ${JSON.stringify(await keys(disk))}`);
  if (root) {
    const entries = await readdir(root);
    console.log(`  root folder holds:     ${JSON.stringify(entries.filter((entry) => entry !== '.nest-storage'))}`);
  }
  const put = await write(() => disk.put('avatars', 'text'));
  console.log(`  put avatars:           ${put}`);
  console.log();
  return put === 'ok';
}

const root = await mkdtemp(join(tmpdir(), 'local-disk-'));
const freshRoot = await mkdtemp(join(tmpdir(), 'local-disk-fresh-'));
try {
  const memoryOk = await run('InMemoryDisk', new InMemoryDisk());
  const localOk = await run('LocalDisk', new LocalDisk({ root }), root);

  console.log('=== LocalDisk, empty root (control) ===');
  const freshPut = await write(() => new LocalDisk({ root: freshRoot }).put('avatars', 'text'));
  console.log(`  put avatars:           ${freshPut}`);
  console.log();

  if (memoryOk && freshPut === 'ok' && !localOk) {
    console.log('RESULT: BUG: after the delete, LocalDisk refuses a key that InMemoryDisk accepts.');
    process.exitCode = 1;
  } else {
    console.log('RESULT: OK: every disk accepts the key after the delete.');
  }
} finally {
  await rm(root, { recursive: true, force: true });
  await rm(freshRoot, { recursive: true, force: true });
}
