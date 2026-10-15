import 'reflect-metadata';
import { Injectable, Scope } from '@nestjs/common';
import { Test } from '@nestjs/testing';

/**
 * `useMocker()` mocks a dependency that no module provides. Since 11.1.20 it
 * no longer does that for a request-scoped provider resolved with
 * `moduleRef.resolve()`: the call throws "Nest can't resolve dependencies".
 *
 *   npm run repro
 */
class MissingDep {}

@Injectable()
class DefaultConsumer {
  constructor(public readonly dep: MissingDep) {}
}

@Injectable({ scope: Scope.REQUEST })
class RequestConsumer {
  constructor(public readonly dep: MissingDep) {}
}

@Injectable({ scope: Scope.TRANSIENT })
class TransientService {
  constructor(public readonly dep: MissingDep) {}
}

@Injectable({ scope: Scope.REQUEST })
class RequestWithTransient {
  constructor(public readonly transient: TransientService) {}
}

const CASES = [
  {
    name: 'DEFAULT consumer, moduleRef.get() (baseline)',
    providers: [DefaultConsumer],
    read: async (ref: any) => ref.get(DefaultConsumer).dep,
  },
  {
    name: 'REQUEST consumer, moduleRef.resolve()',
    providers: [RequestConsumer],
    read: async (ref: any) => (await ref.resolve(RequestConsumer)).dep,
  },
  {
    name: 'REQUEST consumer -> TRANSIENT provider, moduleRef.resolve()',
    providers: [RequestWithTransient, TransientService],
    read: async (ref: any) =>
      (await ref.resolve(RequestWithTransient)).transient?.dep,
  },
];

async function main() {
  let failed = 0;
  for (const { name, providers, read } of CASES) {
    let result: string;
    try {
      const moduleRef = await Test.createTestingModule({ providers })
        .useMocker(() => ({ mocked: true }))
        .compile();
      result = JSON.stringify(await read(moduleRef));
    } catch (err) {
      result = `throws: ${(err as Error).message.split('\n')[0]}`;
    }
    const ok = result === '{"mocked":true}';
    if (!ok) failed++;
    console.log(`=== ${name} ===`);
    console.log(`  expected: {"mocked":true}`);
    console.log(`  got:      ${result}\n`);
  }
  console.log('=== RESULT ===');
  console.log(
    failed
      ? `  BUG: ${failed} of ${CASES.length} cases did not get the mock.`
      : '  FIXED: every case got the mock.',
  );
  process.exitCode = failed ? 1 : 0;
}

main();
