import 'reflect-metadata';
import { Injectable, Scope } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

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

const MOCK = { mocked: true };
const EXPECTED = JSON.stringify(MOCK);

const CASES = [
  {
    name: 'DEFAULT consumer, moduleRef.get() (baseline)',
    providers: [DefaultConsumer],
    read: async (ref: TestingModule) => ref.get(DefaultConsumer).dep,
  },
  {
    name: 'REQUEST consumer, moduleRef.resolve()',
    providers: [RequestConsumer],
    read: async (ref: TestingModule) => (await ref.resolve(RequestConsumer)).dep,
  },
  {
    name: 'REQUEST consumer -> TRANSIENT provider, moduleRef.resolve()',
    providers: [RequestWithTransient, TransientService],
    read: async (ref: TestingModule) =>
      (await ref.resolve(RequestWithTransient)).transient.dep,
  },
];

async function injectedDep({ providers, read }: (typeof CASES)[number]) {
  try {
    const moduleRef = await Test.createTestingModule({ providers })
      .useMocker(() => MOCK)
      .compile();
    return JSON.stringify(await read(moduleRef));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `throws: ${message.split('\n')[0]}`;
  }
}

async function main() {
  const results = await Promise.all(
    CASES.map(async testCase => ({
      name: testCase.name,
      got: await injectedDep(testCase),
    })),
  );
  const failed = results.filter(({ got }) => got !== EXPECTED).length;

  results.forEach(({ name, got }) => {
    console.log(`=== ${name} ===`);
    console.log(`  expected: ${EXPECTED}`);
    console.log(`  got:      ${got}\n`);
  });
  console.log('=== RESULT ===');
  console.log(
    failed === 0
      ? '  FIXED: every case got the mock.'
      : `  BUG: ${failed} of ${CASES.length} cases did not get the mock.`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
