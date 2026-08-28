# `@Sse()` disables the idle timeout for the whole HTTP/2 connection

An `@Sse()` request sets `session.timeout = 0` for the entire HTTP/2
connection. Ordinary requests that never touch SSE lose their idle-timeout
protection, and it is not restored after the SSE stream closes.

## Run it

```bash
npm install
npm run control   # no SSE on the connection
npm run sse       # one SSE request first, same connection
```

Both arms issue the same victim request — `GET /plain`, an ordinary
`@Get()` route that never constructs an `SseStream`. The only difference is
whether an `@Sse()` request ran earlier on that connection.

## What you should see

```
######## npm run control ########
[+   79ms] VICTIM: done. session.timeout = 800
[+  879ms] >>> SESSION TIMEOUT FIRED
[+ 3083ms] PROTECTED: the connection was reclaimed on schedule

######## npm run sse ########
[+   87ms] SSE stream finished and closed
[+   88ms] VICTIM: done. session.timeout = 0
[+ 3094ms] HARMED: the connection is pinned open indefinitely
```

Note the SSE stream has already finished and closed before the victim
request is issued.

## Why it happens

`SseStream`'s constructor tunes the request socket for streaming:

```ts
// packages/core/router/sse-stream.ts
if (req && req.socket) {
  req.socket.setKeepAlive(true);
  req.socket.setNoDelay(true);
  req.socket.setTimeout(0);
}
```

Under HTTP/2 that is not scoped to the request. Node documents
[`request.socket`](https://nodejs.org/api/http2.html#requestsocket) as a proxy:

> `setTimeout` method will be called on `request.stream.session`. […] All
> other interactions will be routed directly to the socket.

So `setTimeout(0)` lands on the `Http2Session` shared by every multiplexed
stream, and `setKeepAlive`/`setNoDelay` land on the shared TCP socket.

It is observable because Fastify enables a session idle timeout by default:
`http2SessionTimeout` defaults to `72000` (`fastify/lib/config-validator.js`)
and is applied to every session unconditionally (`fastify/lib/server.js`).
This reproduction shortens it to 800ms so the effect is visible immediately.

## Scope

- Affects `@nestjs/platform-fastify` with `http2: true` (or `http2` + `https`).
- `@nestjs/platform-express` has no HTTP/2 support, and Fastify over HTTP/1.1
  gives each request its own socket — neither is affected.
- The tuning *is* needed under HTTP/1.1: without it the stream is killed at
  ~514ms in the same setup. So this wants a guard, not a removal.

## Versions

`@nestjs/core` 11.2.3 · `@nestjs/platform-fastify` 11.2.3 · `fastify` 5.11.3 · Node 24
