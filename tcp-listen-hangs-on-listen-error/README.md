# `ServerTCP` never settles `listen()` for any listen error except `EADDRINUSE` and `ECONNREFUSED`

`ServerTCP.listen` passes an error to the callback only for two codes:

```ts
// packages/microservices/server/server-tcp.ts
this.server.once(TcpEventsMap.ERROR, (err: Record<string, unknown>) => {
  if (err?.code === EADDRINUSE || err?.code === ECONNREFUSED) {
    this._status$.next(TcpStatus.DISCONNECTED);

    return callback(err);
  }
});
this.server.listen(this.port, this.host, callback as () => void);
```

Node only runs the `listen` callback on success, thus for any other code
(`EACCES` on a privileged port, `EADDRNOTAVAIL` for a host address this machine
does not own) nothing ever calls the callback. `NestMicroservice.listen` wraps
that callback in a promise, so `await app.listen()` neither resolves nor
rejects. Nest does log the error, but the application cannot react to it.

## Run it

```bash
npm install
npm run repro
```

No broker is needed. The script tries two listen failures and races
`app.listen()` against a 3 second timeout:

- `203.0.113.1:3001` (TEST-NET-3, no local interface owns it): `EADDRNOTAVAIL`
- `127.0.0.1:80`: `EACCES` for a non-root user, on a kernel where
  `net.ipv4.ip_unprivileged_port_start` is still 1024. If that value is lower,
  or you run as root, this scenario listens successfully and prints `resolved`.

## What you should see

Output of `NO_COLOR=1 npm run repro`, with the pid, timestamps and stack traces
removed:

```
=== listen on 203.0.113.1:3001 (expect EADDRNOTAVAIL) ===
[Nest] LOG [NestFactory] Starting Nest application...
[Nest] LOG [InstanceLoader] AppModule dependencies initialized
[Nest] ERROR [Server] Error: listen EADDRNOTAVAIL: address not available 203.0.113.1:3001
  outcome after 3000ms: hung

=== listen on 127.0.0.1:80 (expect EACCES) ===
[Nest] LOG [NestFactory] Starting Nest application...
[Nest] LOG [InstanceLoader] AppModule dependencies initialized
[Nest] ERROR [Server] Error: listen EACCES: permission denied 127.0.0.1:80
  outcome after 3000ms: hung

=== RESULT ===
  EADDRNOTAVAIL: listen() hung
  EACCES: listen() hung
  BUG: listen() never settled for EADDRNOTAVAIL, EACCES, though Nest logged the error.
```

The exit code is 1 while `listen()` hangs.

## Verifying a fix

The script reports the outcome itself, thus it shows the result on any version.
With every listen error passed to the callback:

```
=== listen on 203.0.113.1:3001 (expect EADDRNOTAVAIL) ===
  listen() rejected with EADDRNOTAVAIL
  outcome after 3000ms: rejected
...
=== RESULT ===
  EADDRNOTAVAIL: listen() rejected
  EACCES: listen() rejected
  FIXED: listen() rejected for every listen error.
```

## Versions

`@nestjs/common` 12.1.1 · `@nestjs/core` 12.1.1 · `@nestjs/microservices` 12.1.1 ·
Node 24
