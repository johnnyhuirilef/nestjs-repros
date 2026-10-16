# `setCookie()` drops a middleware cookie on the Fastify adapter

The cookie helpers promise that "every cookie set during a request is sent, on
every platform". On the Fastify adapter, two cases break that promise:

1. A middleware writes `Set-Cookie: session=abc` on the raw response, and the
   handler then calls `httpAdapter.setCookie(res, 'theme', 'dark')`. The
   response only has `theme=dark`. Fastify replaces raw headers with the
   reply's own headers when it writes them, and `appendHeader()` only adds the
   new value to the reply.
2. A middleware calls `httpAdapter.setCookie()` on the raw response that it
   receives. The call throws `response.header is not a function`, so the
   request fails with HTTP 500. `setHeader()` and `appendHeader()` only accept
   a Fastify reply, but `status()`, `end()` and `reply()` already accept the
   raw response.

Express sends every cookie in both cases.

## Run it

No database or broker is needed. Each case starts the app with
`NestFactory.create()`, listens on a free port on `127.0.0.1` and sends one
request with `fetch`.

```bash
npm install
npm run repro
```

## What you should see

Output of `NO_COLOR=1 npm run repro`:

```
=== express: after-middleware-cookie ===
  status:     HTTP 200
  set-cookie: ["session=abc","theme=dark; Path=/"]
  expected:   ["session=abc","theme=dark; Path=/"]

=== express: from-middleware ===
  status:     HTTP 200
  set-cookie: ["c=d; Path=/"]
  expected:   ["c=d; Path=/"]

=== fastify: after-middleware-cookie ===
  status:     HTTP 200
  set-cookie: ["theme=dark; Path=/"]
  expected:   ["session=abc","theme=dark; Path=/"]

=== fastify: from-middleware ===
  status:     HTTP 500
  set-cookie: []
  expected:   ["c=d; Path=/"]

RESULT: BUG: 2 of 4 cases lost a cookie or failed.
```

The exit code of `npm run repro` is 1.

## Verifying a fix

With the fix, both Fastify cases send the expected cookies. The last line is:

```
RESULT: FIXED: all 4 cases send every cookie.
```

The exit code is 0. To test a local build, install the packed
`@nestjs/platform-fastify` with `npm install ./path/to/package.tgz`.

## Versions

`@nestjs/common` 12.1.3 · `@nestjs/core` 12.1.3 · `@nestjs/platform-express`
12.1.3 · `@nestjs/platform-fastify` 12.1.3 · `fastify` 5.12.5 · Node 24
