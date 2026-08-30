# nestjs-repros

Minimal, self-contained reproductions for issues I've reported against
[nestjs/nest](https://github.com/nestjs/nest).

Each directory is one reproduction: its own `package.json` with pinned
versions, and a README with the exact commands and the output to expect.

| Directory | Issue | What it shows |
|---|---|---|
| [`sse-http2-shared-socket`](./sse-http2-shared-socket) | [#17605](https://github.com/nestjs/nest/issues/17605) | An `@Sse()` request disables the idle timeout for the whole HTTP/2 connection, including streams that never used SSE |
| [`ws-adapter-upgrade-listener`](./ws-adapter-upgrade-listener) | *(pending)* | `WsAdapter.dispose()` leaves its `upgrade` listener on a caller-supplied HTTP server, breaking sockets for whatever runs next |
