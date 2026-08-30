# `WsAdapter.dispose()` leaves its `upgrade` listener behind

When `WsAdapter` is given an HTTP server, `dispose()` does not remove the
`'upgrade'` listener it attached to it. The listener survives `app.close()`, and
it still answers upgrade requests — destroying sockets that belong to whatever
runs on that server next.

## Run it

```bash
npm install
npm run leak          # listener count after repeated create/close cycles
npm run interference  # a closed app's listener breaking a live one
```

## What you should see

```
######## npm run leak ########
before any app        upgrade listeners: 0
after create + close #1  upgrade listeners: 1
after create + close #2  upgrade listeners: 2
after create + close #3  upgrade listeners: 3

LEAK: listeners survived app.close()

######## npm run interference ########
closed app left        upgrade listeners: 1
with the live app      upgrade listeners: 2

client asked the live gateway -> ERROR: Parse Error: Invalid header token
BROKEN: the closed app's listener destroyed the socket
```

In the second run the first app is created and closed before the second one
starts. Its gateway is on `/other`, the live one is on `/live`. A client asking
for `/live` still fails, because the dead app's listener runs first, finds no
gateway matching that path, and calls `socket.destroy()`.

## Why it happens

`ensureHttpServerExists` attaches an anonymous listener and keeps no reference
to it:

```ts
// packages/platform-ws/adapters/ws-adapter.ts
httpServer.on('upgrade', (request, socket, head) => {
  // ...
  if (!isRequestDelegated) {
    socket.destroy();
  }
});
```

`dispose()` then filters out the caller-supplied server, correctly, since
closing a server it does not own would be wrong:

```ts
const closeEventSignals = Array.from(this.httpServersRegistry)
  .filter(([port]) => port !== UNDERLYING_HTTP_SERVER_PORT)
  .map(([_, server]) => new Promise(resolve => server.close(resolve)));
```

For its own servers the listener goes away with the server. For a borrowed one
nothing removes it, and there is no reference left to remove it with.

## Who runs into this

Anything that creates and closes several apps in one process against a shared
server: e2e suites, `Test.createTestingModule` per spec file, or a host process
that restarts an app. The listener count grows with each cycle, and once two
gateways use different paths the stale listener starts destroying live sockets.

## Versions

`@nestjs/core` 12.0.1 · `@nestjs/platform-ws` 12.0.1 · `ws` 8.18.0 · Node 24
