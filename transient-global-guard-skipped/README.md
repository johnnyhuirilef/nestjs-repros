# A transient global guard never runs on controllers and microservice handlers

A global guard registered with the `APP_GUARD` token can have a transient scope
(`@Injectable({ scope: Scope.TRANSIENT })`):

```ts
{ provide: APP_GUARD, useClass: DenyGuard } // DenyGuard is Scope.TRANSIENT
```

Nest creates the guard, but never calls `canActivate()`. The route handler runs
with no guard, no log and no error. The same guard returns 403 when it is a
default (singleton) or request-scoped global guard, or when it is used with
`@UseGuards()`.

## Cause

A transient or request-scoped global enhancer has no single instance to call.
`DependenciesScanner` registers it with `addGlobalRequestGuard()` and attaches it
to every controller, so the injector can build one per host.

A controller is "static" when nothing in its dependency tree is request-scoped.
A transient dependency does not change that, so the router takes the static path:

```ts
// packages/core/guards/guards-context-creator.ts (simplified)
getGlobalMetadata(contextId = STATIC_CONTEXT, inquirerId?) {
  if (!this.config) return [];
  const globalGuards = this.config.getGlobalGuards();
  if (contextId === STATIC_CONTEXT && !inquirerId) {
    return globalGuards; // getGlobalRequestGuards() is never read
  }
  ...
}
```

A request-scoped global guard works because it makes the controller
non-static. A transient one does not, so it is created at startup and skipped on
every request. Global pipes, interceptors and exception filters use the same
early return.

An app with a transient global auth guard is open on every route and every
message handler.

## Run it

The script starts one Nest app per case on a local port, sends one request, and
prints whether the guard and the handler ran. Each guard always returns `false`.

```bash
npm install
npm run repro
```

Set `PORT` (default `3988`) and `TCP_PORT` (default `3989`) to use other ports.

## What you should see

Output of `NO_COLOR=1 npm run repro`:

```
=== HTTP route + transient global guard that denies ===
  expected: the guard runs, the handler does not run
  guard created: 1
  guard ran:     false
  handler ran:   true
  client got:    HTTP 200

=== HTTP route + default global guard that denies (baseline) ===
  expected: the guard runs, the handler does not run
  guard created: 0
  guard ran:     true
  handler ran:   false
  client got:    HTTP 403

=== HTTP route + request-scoped global guard that denies (baseline) ===
  expected: the guard runs, the handler does not run
  guard created: 0
  guard ran:     true
  handler ran:   false
  client got:    HTTP 403

=== HTTP route + @UseGuards(TransientDenyGuard) (baseline) ===
  expected: the guard runs, the handler does not run
  guard created: 1
  guard ran:     true
  handler ran:   false
  client got:    HTTP 403

=== TCP message + transient global guard that denies ===
  expected: the guard runs, the handler does not run
  guard created: 1
  guard ran:     false
  handler ran:   true
  client got:    handler ran

RESULT: BUG: 2 of 5 cases ran the handler without the guard.
```

The baselines show that the guard class works: it denies as a default or
request-scoped global guard, and with `@UseGuards()`. Only the combination of a
transient global guard and a static host skips it. The exit code of
`npm run repro` is 1.

## Verifying a fix

The script reports the result on any version. With the transient global guard
applied, the first and last cases match the baselines and the last line is:

```
RESULT: FIXED: the guard denied the request in every case.
```

The exit code is 0.

## Other enhancers

Transient global pipes, interceptors and exception filters (`APP_PIPE`,
`APP_INTERCEPTOR`, `APP_FILTER`) go through the same registration and the same
early return, so they are skipped on static hosts in the same way. This script
only shows the guard.

## Versions

`@nestjs/common` 12.1.2 · `@nestjs/core` 12.1.2 · `@nestjs/microservices` 12.1.2 ·
`@nestjs/platform-express` 12.1.2 · Node 24
