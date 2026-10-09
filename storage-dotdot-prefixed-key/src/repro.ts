import 'reflect-metadata';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryDisk, LocalDisk, StorageError, type StorageDisk } from '@nestjs/storage';

const KEYS = ['foo/a', '..foo/a', '..a'];
const MISSING_DIRECTORY_NAME = '..foo';

type Observation = {
  disk: string;
  key: string;
  put: string;
  exists: string;
  get: string;
  list: string;
  delete: string;
};

// Only library errors are part of the observation. Anything else is a bug in this script.
async function observe(action: () => Promise<unknown>): Promise<string> {
  try {
    const value = await action();
    return value === undefined ? 'ok' : String(value);
  } catch (error) {
    if (error instanceof StorageError) {
      return `${error.constructor.name}: ${error.message}`;
    }
    throw error;
  }
}

async function observeKey(diskName: string, disk: StorageDisk, key: string): Promise<Observation> {
  const put = await observe(() => disk.put(key, 'hello').then(() => 'ok'));
  const exists = await observe(() => disk.exists(key));
  const get = await observe(() => disk.getText(key));
  const list = await observe(async () => {
    const page = await disk.list({ prefix: key });
    return `[${page.entries.map((entry) => entry.key).join(',')}]`;
  });
  const deleted = await observe(() => disk.delete(key));
  return { disk: diskName, key, put, exists, get, list, delete: deleted };
}

function printObservation(o: Observation): void {
  console.log(
    `${o.disk.padEnd(12)} ${o.key.padEnd(8)} put: ${o.put}   exists: ${o.exists}   get: ${o.get}   list: ${o.list}   delete: ${o.delete}`,
  );
}

function findObservation(all: Observation[], disk: string, key: string): Observation {
  const found = all.find((o) => o.disk === disk && o.key === key);
  if (found === undefined) {
    throw new Error(`no observation for ${disk} ${key}`);
  }
  return found;
}

const root = await mkdtemp(join(tmpdir(), 'storage-dotdot-'));
try {
  const disks: [string, StorageDisk][] = [
    ['InMemoryDisk', new InMemoryDisk()],
    ['LocalDisk', new LocalDisk({ root })],
  ];

  const observations: Observation[] = [];
  let strayDirectoryAfterFailedPut = false;
  for (const [diskName, disk] of disks) {
    for (const key of KEYS) {
      const observation = await observeKey(diskName, disk, key);
      observations.push(observation);
      printObservation(observation);
      if (diskName === 'LocalDisk' && key === '..foo/a') {
        strayDirectoryAfterFailedPut = (await readdir(root)).includes(MISSING_DIRECTORY_NAME);
      }
    }
  }

  const memory = findObservation(observations, 'InMemoryDisk', '..foo/a');
  const local = findObservation(observations, 'LocalDisk', '..foo/a');
  if (local.put !== 'ok') {
    console.log('');
    console.log(
      `LocalDisk root holds a "${MISSING_DIRECTORY_NAME}" directory after the failed put of "..foo/a": ${strayDirectoryAfterFailedPut}`,
    );
  }
  const memoryAccepts = memory.put === 'ok' && memory.exists === 'true';
  const localAccepts = local.put === 'ok' && local.exists === 'true';

  console.log('');
  if (memoryAccepts && !localAccepts) {
    console.log('RESULT: BUG: InMemoryDisk accepts "..foo/a" and LocalDisk refuses it');
  } else if (memoryAccepts && localAccepts) {
    console.log('RESULT: OK: both disks accept "..foo/a"');
  } else {
    console.log('RESULT: INCONCLUSIVE: InMemoryDisk did not accept "..foo/a"');
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
