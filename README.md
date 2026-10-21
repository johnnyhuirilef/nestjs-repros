# nestjs-repros

Minimal, self-contained reproductions for issues that I reported against the
[nestjs](https://github.com/nestjs) organization.

Each directory is one reproduction: its own `package.json` with pinned
versions, and a README with the exact commands and the output to expect.
When a reproduction needs a database or a broker, it has its own
`compose.yaml`.

## nestjs/nest

| Directory | Issue | What it shows |
|---|---|---|
| [`sse-http2-shared-socket`](./sse-http2-shared-socket) | [#17605](https://github.com/nestjs/nest/issues/17605) | An `@Sse()` request disables the idle timeout for the whole HTTP/2 connection, including streams that never used SSE |
| [`ws-adapter-upgrade-listener`](./ws-adapter-upgrade-listener) | [#17629](https://github.com/nestjs/nest/issues/17629) | `WsAdapter.dispose()` leaves its `upgrade` listener on a caller-supplied HTTP server, breaking sockets for whatever runs next |
| [`event-pattern-rpc-exception`](./event-pattern-rpc-exception) | [#17633](https://github.com/nestjs/nest/issues/17633) | An `RpcException` thrown from an `@EventPattern` handler is discarded with no log, no client error and no rejection |
| [`mqtt-listen-callback-reconnect`](./mqtt-listen-callback-reconnect) | [#17640](https://github.com/nestjs/nest/issues/17640) | `ServerMqtt` runs the `listen()` callback again on every broker reconnect |
| [`nats-publish-throw-leak`](./nats-publish-throw-leak) | [#17918](https://github.com/nestjs/nest/issues/17918) | `ClientNats` leaves the reply-inbox subscription behind when `publish()` throws, e.g. for a payload above `max_payload` |
| [`tcp-listen-hangs-on-listen-error`](./tcp-listen-hangs-on-listen-error) | [#17921](https://github.com/nestjs/nest/issues/17921) | `ServerTCP` only passes `EADDRINUSE`/`ECONNREFUSED` to the listen callback, so `await app.listen()` hangs forever on `EACCES`, `EADDRNOTAVAIL` and every other listen error |
| [`rmq-client-duplicate-channel`](./rmq-client-duplicate-channel) | [#17954](https://github.com/nestjs/nest/issues/17954) | `ClientRMQ` creates its channel twice on the first connect, so every client holds a second, orphaned channel (and a second consumer on a named `replyQueue`) |
| [`rmq-channel-setup-error-crash`](./rmq-channel-setup-error-crash) | [#17956](https://github.com/nestjs/nest/issues/17956) | An RMQ channel setup error (e.g., `406 PRECONDITION_FAILED` on a queue declared with other arguments) is never listened to by `ClientRMQ` and `ServerRMQ`, so it crashes the process instead of failing `connect()` and `listen()` |
| [`nats-client-non-json-reply-crash`](./nats-client-non-json-reply-crash) | [#17958](https://github.com/nestjs/nest/issues/17958) | A reply that is not valid JSON, sent by a non-Nest responder, makes `ClientNats` reject inside a callback nats-core does not await: the process crashes, or the request never settles when the rejection is handled |
| [`event-pattern-empty-handler-cancels-siblings`](./event-pattern-empty-handler-cancels-siblings) | [#17960](https://github.com/nestjs/nest/issues/17960) | An `@EventPattern` handler whose Observable completes without emitting (`EMPTY`, `filter`) ends the `forkJoin` that chains handlers of the same pattern, which cancels the other handlers: a cold Observable from a sibling handler never runs |
| [`ws-gateway-request-scoped-global-guard`](./ws-gateway-request-scoped-global-guard) | [#17975](https://github.com/nestjs/nest/issues/17975) | A global `APP_GUARD` with request scope is never attached to WebSocket gateways, so the `@SubscribeMessage()` handler runs unguarded with no log, while the same guard returns 403 on HTTP routes |
| [`transient-global-guard-skipped`](./transient-global-guard-skipped) | [#17991](https://github.com/nestjs/nest/issues/17991) | A global `APP_GUARD` with transient scope is created but its `canActivate()` never runs on controllers and microservice handlers, so the handler runs unguarded with no log, while a default or request-scoped global guard returns 403 |
| [`client-custom-deserializer-crash`](./client-custom-deserializer-crash) | [#17994](https://github.com/nestjs/nest/issues/17994) | A custom `deserializer` that throws or rejects on a reply crashes the process that runs `ClientTCP`, `ClientRedis`, `ClientMqtt` and `ClientRMQ`, because the client awaits it inside a listener nobody awaits, and the request never settles when the rejection is handled |
| [`record-reply-not-unwrapped`](./record-reply-not-unwrapped) | [#18007](https://github.com/nestjs/nest/issues/18007) | A record that a `@MessagePattern()` handler returns (`MqttRecordBuilder`, `NatsRecordBuilder`, `RmqRecordBuilder`) is not unwrapped in the reply, so the client gets `{ data, options }` instead of the data, and the record options (MQTT QoS and properties, NATS headers, RMQ options) are dropped, because the reply packet is `{ response, ... }` and the code that handles records looks at `data` |
| [`sse-fastify-late-headers`](./sse-fastify-late-headers) | [#18010](https://github.com/nestjs/nest/issues/18010) | A header that an interceptor or a handler sets on the reply is dropped on an `@Sse()` route on the Fastify adapter, because the SSE response writes a copy of the reply headers taken before the interceptors run, while Express and normal routes send it |
| [`fastify-listen-socket-path`](./fastify-listen-socket-path) | [#18052](https://github.com/nestjs/nest/issues/18052) | `app.listen('<path>.sock')` crashes the process with a `RangeError` on the Fastify adapter, because the adapter turns every non-object argument into `{ port: +argument }` and `+'<path>.sock'` is `NaN`, while Express listens on the socket |
| [`testing-request-scoped-auto-mock`](./testing-request-scoped-auto-mock) | [#18160](https://github.com/nestjs/nest/issues/18160) | Since 11.1.20, `useMocker()` no longer mocks the missing dependency of a request-scoped provider resolved with `moduleRef.resolve()`, directly or through a transient provider, so the call throws "Nest can't resolve dependencies", while a default-scope provider still gets the mock |
| [`fastify-raw-response-cookies`](./fastify-raw-response-cookies) | [#18174](https://github.com/nestjs/nest/issues/18174) | On the Fastify adapter, `setCookie()` drops a cookie that a middleware wrote on the raw response, and `setHeader()`, `appendHeader()` and `setCookie()` throw on the raw response that a middleware receives, while Express keeps and accepts both |
| [`fastify-redirect-non-ascii-url`](./fastify-redirect-non-ascii-url) | [#18207](https://github.com/nestjs/nest/issues/18207) | On the Fastify adapter, `@Redirect('/文档')` responds 500 `ERR_INVALID_CHAR` and other URLs go out unencoded, while Express encodes the `Location` header |
| [`fastify-object-non-json-content-type`](./fastify-object-non-json-content-type) | [#18208](https://github.com/nestjs/nest/issues/18208) | On the Fastify adapter, returning an object with `@Header('Content-Type', 'text/plain')` responds 500 `FST_ERR_REP_INVALID_PAYLOAD_TYPE`, while Express sends the object as JSON with that `Content-Type` |
| [`fastify-cors-middleware-error`](./fastify-cors-middleware-error) | [#18212](https://github.com/nestjs/nest/issues/18212) | On the Fastify adapter, a response that a Nest middleware ends with an error has no CORS headers of `enableCors()`, and a CORS preflight responds with the error of the middleware, while Express sends the CORS headers and answers the preflight with `204` |

## Other packages

When there is no issue, the link goes to the pull request that fixed it.

| Directory | Package | Issue or PR | What it shows |
|---|---|---|---|
| [`authentication-magic-link-second-request`](./authentication-magic-link-second-request) | `@nestjs/authentication` | [authentication#43](https://github.com/nestjs/authentication/issues/43) | A second magic link request in the same browser makes the first link unusable there |
| [`authentication-reset-cross-origin-sign-in`](./authentication-reset-cross-origin-sign-in) | `@nestjs/authentication` | [authentication#42](https://github.com/nestjs/authentication/pull/42) | `reset()` with `signIn` changes the password and spends the link, then answers 403 for an untrusted origin |
| [`drizzle-empty-connection-name`](./drizzle-empty-connection-name) | `@nestjs/drizzle` | [drizzle#4](https://github.com/nestjs/drizzle/issues/4) | An empty connection name collides with the default one |
| [`http-client-304-throws`](./http-client-304-throws) | `@nestjs/http-client` | [http-client#21](https://github.com/nestjs/http-client/issues/21) | The client throws on `304 Not Modified`, although the docs say `auto` gives `undefined` for 304 |
| [`locks-signal-ignored-during-store-call`](./locks-signal-ignored-during-store-call) | `@nestjs/locks` | [locks#20](https://github.com/nestjs/locks/issues/20) | `signal` and `wait` do not stop an acquire that waits on the store |
| [`observe-null-prototype-provider`](./observe-null-prototype-provider) | `@nestjs/observe` | [observe#10](https://github.com/nestjs/observe/pull/10) | A method call on a provider without a constructor (an ESM namespace) throws `TypeError` |
| [`observe-promise-members-lost`](./observe-promise-members-lost) | `@nestjs/observe` | [observe#11](https://github.com/nestjs/observe/pull/11) | A provider method that returns a Promise with extra members (got, p-cancelable) loses them |
| [`outbox-unstorable-error-loop`](./outbox-unstorable-error-loop) | `@nestjs/outbox` | [outbox#21](https://github.com/nestjs/outbox/issues/21) | Postgres store: a handler error with a lone surrogate or U+0000 makes the message loop forever |
| [`outbox-payload-unstorable-text`](./outbox-payload-unstorable-text) | `@nestjs/outbox` | [outbox#23](https://github.com/nestjs/outbox/issues/23) | Postgres store: `outbox.add()` throws a raw driver error for a payload or header string with U+0000 or a lone surrogate |
| [`outbox-mysql-large-row`](./outbox-mysql-large-row) | `@nestjs/outbox` | [outbox#26](https://github.com/nestjs/outbox/pull/26) | MySQL store: `add()` fails with `Out of sort memory` for a message over about 250 KB |
| [`outbox-claim-large-batch`](./outbox-claim-large-batch) | `@nestjs/outbox` | [outbox#27](https://github.com/nestjs/outbox/issues/27) | SQL stores: one `claim()` gets superlinear with a large `relay.batchSize` |
| [`storage-dotdot-prefixed-key`](./storage-dotdot-prefixed-key) | `@nestjs/storage` | [storage#17](https://github.com/nestjs/storage/pull/17) | `LocalDisk` refuses valid keys whose first segment starts with two dots, but `InMemoryDisk` accepts them |
| [`workflows-mysql-name-loop`](./workflows-mysql-name-loop) | `@nestjs/workflows` | [workflows#24](https://github.com/nestjs/workflows/issues/24) | MySQL store: a name over the column limit makes the instance re-run forever |
| [`workflows-unstorable-text`](./workflows-unstorable-text) | `@nestjs/workflows` | [workflows#28](https://github.com/nestjs/workflows/pull/28) | Text that a database cannot store makes a step run again or a run loop |

## Adding a reproduction

Add its row to the right table in the same commit as the reproduction. Use
*(pending)* until the issue exists, and replace it with the link when you
publish the issue.
