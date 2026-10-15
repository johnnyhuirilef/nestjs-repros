# useMocker() skips request-scoped providers resolved with moduleRef.resolve()

`Test.createTestingModule().useMocker()` creates a mock for a dependency that no
module provides. On 11.1.19 this works for the three cases below. Since 11.1.20 it does
not work for a request-scoped provider that the test resolves with
`moduleRef.resolve()`:

```ts
@Injectable({ scope: Scope.REQUEST })
class RequestConsumer {
  constructor(public readonly dep: MissingDep) {}
}

const moduleRef = await Test.createTestingModule({ providers: [RequestConsumer] })
  .useMocker(() => ({ mocked: true }))
  .compile();

await moduleRef.resolve(RequestConsumer);
// 11.1.19: RequestConsumer { dep: { mocked: true } }
// 11.1.20 and later: Nest can't resolve dependencies of the RequestConsumer (?)
```

The same happens when the missing dependency is one level down, in a transient
provider that the request-scoped provider uses.

A provider with the default scope still gets the mock.

## Run it

```bash
npm install
npm run repro
```

## What you should see

Output of `NO_COLOR=1 npm run repro` on 12.1.3:

```
=== DEFAULT consumer, moduleRef.get() (baseline) ===
  expected: {"mocked":true}
  got:      {"mocked":true}

=== REQUEST consumer, moduleRef.resolve() ===
  expected: {"mocked":true}
  got:      throws: Nest can't resolve dependencies of the RequestConsumer (?). Please make sure that the argument MissingDep at index [0] is available in the RootTestModule module.

=== REQUEST consumer -> TRANSIENT provider, moduleRef.resolve() ===
  expected: {"mocked":true}
  got:      throws: Nest can't resolve dependencies of the TransientService (?). Please make sure that the argument MissingDep at index [0] is available in the RootTestModule module.

=== RESULT ===
  BUG: 2 of 3 cases did not get the mock.
```

The exit code of `npm run repro` is 1.

## The same script on 11.1.19

```bash
npm install --no-save @nestjs/common@11.1.19 @nestjs/core@11.1.19 @nestjs/testing@11.1.19
npm run repro
```

```
=== DEFAULT consumer, moduleRef.get() (baseline) ===
  expected: {"mocked":true}
  got:      {"mocked":true}

=== REQUEST consumer, moduleRef.resolve() ===
  expected: {"mocked":true}
  got:      {"mocked":true}

=== REQUEST consumer -> TRANSIENT provider, moduleRef.resolve() ===
  expected: {"mocked":true}
  got:      {"mocked":true}

=== RESULT ===
  FIXED: every case got the mock.
```

Run `npm install` again to go back to 12.1.3.

## Versions

`@nestjs/common` 12.1.3 · `@nestjs/core` 12.1.3 · `@nestjs/testing` 12.1.3 ·
Node 24. The first version that fails is 11.1.20.
