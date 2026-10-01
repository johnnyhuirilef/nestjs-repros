# A request-scoped global guard never runs for WebSocket gateways

The docs say that global guards registered with the `APP_GUARD` token apply to
gateways as well. That holds for a guard that is a singleton. It does not hold
for a global guard whose class is request-scoped
(`@Injectable({ scope: Scope.REQUEST })`, or transient):

```ts
{ provide: APP_GUARD, useClass: DenyGuard } // DenyGuard is Scope.REQUEST
```

A request-scoped global enhancer has no single instance to call. Nest attaches
it to each controller and each "entry provider" instead, so it can build one per
request. `DependenciesScanner.addScopedEnhancersMetadata()` does this:

```ts
// packages/core/scanner.ts (simplified)
Array.from(moduleRef.controllers.values()).concat(moduleRef.entryProviders)
```

`entryProviders` holds the providers whose class carries
`ENTRY_PROVIDER_WATERMARK`. Nothing sets that metadata, and a gateway is a
provider, not a controller. So the guard is never attached to the gateway.
`GuardsContextCreator` then drops the missing instance without a message, and the
`@SubscribeMessage()` handler runs with no guard. There is no log and no error.

An app with a request-scoped global auth guard is open on every gateway, while
the same guard returns 403 on every HTTP route.

Not affected: `@UseGuards(RequestScopedGuard)` on a gateway or on one of its
handlers, and a static global guard.

## Run it

The script starts one Nest app per case on a local port, connects with
`socket.io-client` (or `fetch` for the HTTP case), sends `ping`, and prints
whether the guard and the handler ran. Each guard always returns `false`.

```bash
npm install
npm run repro
```

Set `PORT` (default `3987`) to use another port.

## What you should see

Output of `NO_COLOR=1 npm run repro`:

```
=== WebSocket gateway + request-scoped global guard that denies ===
  expected: the guard runs, the handler does not run
  guard ran:   false
  handler ran: true
  client got:  pong "handler ran"

=== WebSocket gateway + static global guard that denies (baseline) ===
  expected: the guard runs, the handler does not run
  guard ran:   true
  handler ran: false
  client got:  exception {"status":"error","message":"Forbidden resource","cause":{"pattern":"ping","data":{}}}

=== HTTP route + request-scoped global guard that denies (baseline) ===
  expected: the guard runs, the handler does not run
  guard ran:   true
  handler ran: false
  client got:  HTTP 403

=== RESULT ===
  BUG: 1 of 3 cases ran the handler without the guard.
```

The two baselines show that the guard class works: the same static guard denies
on the gateway, and the same request-scoped guard denies on an HTTP route. Only
the combination of a request-scoped global guard and a gateway skips it. The exit
code of `npm run repro` is 1.

## Verifying a fix

The script reports the result on any version. With the request-scoped global
guard attached to the gateway, the first case matches the baselines:

```
=== WebSocket gateway + request-scoped global guard that denies ===
  expected: the guard runs, the handler does not run
  guard ran:   true
  handler ran: false
  client got:  exception {"status":"error","message":"Forbidden resource","cause":{"pattern":"ping","data":{}}}
...
=== RESULT ===
  FIXED: the guard denied the request in every case.
```

## Other enhancers

Global pipes, interceptors and filters with request or transient scope go
through the same `addScopedEnhancersMetadata()` path, so they are expected to be
skipped on gateways in the same way. This script only shows the guard.

## Versions

`@nestjs/common` 12.1.2 · `@nestjs/core` 12.1.2 · `@nestjs/websockets` 12.1.2 ·
`@nestjs/platform-socket.io` 12.1.2 (`socket.io` 4.8.3) ·
`@nestjs/platform-express` 12.1.2 · `socket.io-client` 4.8.3 · Node 24
