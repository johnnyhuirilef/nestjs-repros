# An `RpcException` from an `@EventPattern` handler is discarded

A handler that throws `RpcException` produces no signal at all when the pattern
is an event: no log, no client error, no rejected promise. The same exception
from a `@MessagePattern` handler reaches the client, and a plain `Error` from an
event handler is logged — so the one shape the docs teach is the silent one.

## Run it

```bash
npm install
npm run repro
```

## What you should see

```
=== A) @MessagePattern throwing RpcException ===
  [filter] custom filter ran, wants to alert: message failed
  client received: "message failed"

=== B) @EventPattern throwing a plain Error ===
[Nest] ERROR [RpcExceptionsHandler] Error: event failed with a plain Error
    at AppController.evtPlain (src/repro.ts:51:11)

=== C) @EventPattern throwing RpcException ===
  (watch for any output below before the next section)
  [filter] custom filter ran, wants to alert: event failed

=== D) @EventPattern + RpcException, with a custom filter ===
  [filter] custom filter ran, wants to alert: order sync failed
  custom filter executed: true

=== RESULT ===
  RpcException reports from event handlers: 0 (cases C and D)
  BUG: the failure was discarded with no signal.
```

`unhandledRejection` and `uncaughtException` are both listened for, and neither
fires.

Case D is the one worth looking at: the application's own `@Catch(RpcException)`
filter runs, so the developer's error handling appears to work. What the filter
returns is then thrown away.

## Why it happens

`Server.handleEvent` connects the handler's observable without subscribing to it:

```ts
// packages/microservices/server/server.ts
const connectableSource = connectable(
  resultOrStream.pipe(finalize(() => this.onProcessingEndHook?.(...))),
  {
    connector: () => new Subject(),
    resetOnDisconnect: false,
  },
);
connectableSource.connect();
```

`BaseRpcExceptionFilter.catch` returns `throwError(() => message)` — a cold
observable that only produces its error notification when something subscribes.
For a `@MessagePattern`, `Server.send()` subscribes and forwards the error to the
client. For an `@EventPattern`, nothing does, so the notification has nowhere to
go.

A plain `Error` only surfaces because `handleUnknownError` logs as a side effect
before returning the same unsubscribed observable.

## Verifying a fix

The script counts what Nest writes, thus it shows the result on any version.
With nestjs/nest#17634 applied, cases C and D report the exception with a stack
trace that points at the handler:

```
=== C) @EventPattern throwing RpcException ===
  [filter] custom filter ran, wants to alert: event failed
[Nest] ERROR [RpcExceptionsHandler] RpcException [Error]: event failed
    at AppController.evtRpc (src/repro.ts:46:11)

=== RESULT ===
  RpcException reports from event handlers: 2 (cases C and D)
  FIXED: both event handlers reported the failure.
```

Cases A and B do not change.

## Who runs into this

Anyone using `@EventPattern` with `RpcException` on a transport that uses the
base `handleEvent`: TCP, Redis, NATS, MQTT and RabbitMQ. Kafka overrides
`handleEvent` and awaits the stream, thus the error already reaches its caller
there.

## Versions

`@nestjs/core` 12.0.1 · `@nestjs/microservices` 12.0.1 · Node 24 · TCP transport
