# `useMocker()` skips request-scoped providers resolved with `moduleRef.resolve()`

`Test.createTestingModule().useMocker()` creates a mock for a dependency that no
module provides. On 11.1.20 and 12.1.3, this does not work for a request-scoped
provider that the test gets with `moduleRef.resolve()`:

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
// 11.1.20 and 12.1.3: Nest can't resolve dependencies of the RequestConsumer (?)
```

The same happens when the missing dependency is one level down, in a transient
provider that the request-scoped provider uses.

Not affected: a provider with the default scope still gets the mock.

## Run it

No app, broker or network is needed. For each case, the script compiles a
testing module with `useMocker()`, reads the dependency, and prints what it got.

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

## Verifying a fix

With the fix, every case gets the mock, and the last lines are:

```
=== RESULT ===
  FIXED: every case got the mock.
```

The exit code is 0. To test a local build, install the packed `@nestjs/testing`
(and `@nestjs/core` if it changed) with `npm install ./path/to/package.tgz`.

11.1.19 is the last version before the regression, and it gives the same result:

```bash
npm install --no-save @nestjs/common@11.1.19 @nestjs/core@11.1.19 @nestjs/testing@11.1.19
npm run repro
```

Run `npm install` again to go back to 12.1.3.

## Versions

`@nestjs/common` 12.1.3 · `@nestjs/core` 12.1.3 · `@nestjs/testing` 12.1.3 ·
Node 24. The first version that fails is 11.1.20.
