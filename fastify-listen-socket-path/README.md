# `app.listen('<path>.sock')` crashes the process on the Fastify adapter

`app.listen()` accepts a `string` as well as a number. On Express, a string
that is not a number is a Unix socket path (or a Windows named pipe), and the
server listens on it. On Fastify, the adapter turns every argument that is not
an object into a port:

```ts
// packages/platform-fastify/adapters/fastify-adapter.ts (simplified)
options = { port: +listenOptions };
```

`+'/tmp/app.sock'` is `NaN`, so Fastify passes `NaN` to Node. Node throws a
`RangeError` on a later tick. No `try`/`catch` and no `.catch()` can reach it,
so the process crashes. The error also says nothing about the socket path.

`app.listen({ path })` already works on Fastify. It is the only way to use a
socket there, and the types do not allow it. A numeric string such as `'3000'`
works on both adapters.

## Run it

No broker is needed. Each case runs in its own child process, because the
Fastify case crashes the process. A real HTTP client sends one request over the
socket (or over the port for the `listen(0)` baseline). The socket files are
created in the OS temp directory and deleted at the end of each case.

```bash
npm install
npm run repro
```

## What you should see

Output of `NO_COLOR=1 npm run repro`:

```
=== express: listen(socketPath) ===
  outcome:  listening, GET / answered HTTP 200

=== fastify: listen(socketPath) ===
  outcome:  crash: RangeError: options.port should be >= 0 and < 65536. Received type number (NaN).

=== fastify: listen(0) ===
  outcome:  listening, GET / answered HTTP 200

=== fastify: listen({ path }) ===
  outcome:  listening, GET / answered HTTP 200

RESULT: BUG: 1 of 4 cases did not listen (a socket path crashes the process on Fastify).
```

The exit code of `npm run repro` is 1.

## Verifying a fix

With the fix, the Fastify socket path case listens and answers. The last line
is:

```
RESULT: FIXED: all 4 cases listen and answer HTTP 200.
```

The exit code is 0. To test a local build, install the packed
`@nestjs/platform-fastify` (and `@nestjs/core` and `@nestjs/common` if they
changed) with `npm install ./path/to/package.tgz`.

## Versions

`@nestjs/common` 12.1.2 · `@nestjs/core` 12.1.2 · `@nestjs/platform-express`
12.1.2 · `@nestjs/platform-fastify` 12.1.2 · `fastify` 5.12.5 · Node 24
