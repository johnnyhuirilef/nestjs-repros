# nestjs-repros

Minimal, self-contained reproductions for issues I've reported against
[nestjs/nest](https://github.com/nestjs/nest).

Each directory is one reproduction: its own `package.json` with pinned
versions, and a README with the exact commands and the output to expect.

| Directory | Issue | What it shows |
|---|---|---|
| [`sse-http2-shared-socket`](./sse-http2-shared-socket) | [#17605](https://github.com/nestjs/nest/issues/17605) | An `@Sse()` request disables the idle timeout for the whole HTTP/2 connection, including streams that never used SSE |
| [`ws-adapter-upgrade-listener`](./ws-adapter-upgrade-listener) | [#17629](https://github.com/nestjs/nest/issues/17629) | `WsAdapter.dispose()` leaves its `upgrade` listener on a caller-supplied HTTP server, breaking sockets for whatever runs next |
| [`event-pattern-rpc-exception`](./event-pattern-rpc-exception) | *(pending)* | An `RpcException` thrown from an `@EventPattern` handler is discarded with no log, no client error and no rejection |
| [`nats-publish-throw-leak`](./nats-publish-throw-leak) | *(pending)* | `ClientNats` leaves the reply-inbox subscription behind when `publish()` throws, e.g. for a payload above `max_payload` |
| [`tcp-listen-hangs-on-listen-error`](./tcp-listen-hangs-on-listen-error) | *(pending)* | `ServerTCP` only passes `EADDRINUSE`/`ECONNREFUSED` to the listen callback, so `await app.listen()` hangs forever on `EACCES`, `EADDRNOTAVAIL` and every other listen error |
| [`rmq-client-duplicate-channel`](./rmq-client-duplicate-channel) | *(pending)* | `ClientRMQ` creates its channel twice on the first connect, so every client holds a second, orphaned channel (and a second consumer on a named `replyQueue`) |
| [`rmq-channel-setup-error-crash`](./rmq-channel-setup-error-crash) | *(pending)* | An RMQ channel setup error (e.g., `406 PRECONDITION_FAILED` on a queue declared with other arguments) is never listened to by `ClientRMQ` and `ServerRMQ`, so it crashes the process instead of failing `connect()` and `listen()` |
| [`nats-client-non-json-reply-crash`](./nats-client-non-json-reply-crash) | *(pending)* | A reply that is not valid JSON, sent by a non-Nest responder, makes `ClientNats` reject inside a callback nats-core does not await: the process crashes, or the request never settles when the rejection is handled |
| [`event-pattern-empty-handler-cancels-siblings`](./event-pattern-empty-handler-cancels-siblings) | *(pending)* | An `@EventPattern` handler whose Observable completes without emitting (`EMPTY`, `filter`) ends the `forkJoin` that chains handlers of the same pattern, which cancels the other handlers: a cold Observable from a sibling handler never runs |
| [`ws-gateway-request-scoped-global-guard`](./ws-gateway-request-scoped-global-guard) | *(pending)* | A global `APP_GUARD` with request scope is never attached to WebSocket gateways, so the `@SubscribeMessage()` handler runs unguarded with no log, while the same guard returns 403 on HTTP routes |
| [`transient-global-guard-skipped`](./transient-global-guard-skipped) | *(pending)* | A global `APP_GUARD` with transient scope is created but its `canActivate()` never runs on controllers and microservice handlers, so the handler runs unguarded with no log, while a default or request-scoped global guard returns 403 |
