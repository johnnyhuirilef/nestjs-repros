# CORS headers are missing when a middleware ends the request on the Fastify adapter

On the Fastify adapter, the CORS headers of `app.enableCors()` are missing
when a Nest middleware ends the request with an error. A CORS preflight for
the same route also runs the middleware, so it responds with the error of the
middleware instead of `204`. A browser then reports a CORS error instead of
the real response.

Express sends `Access-Control-Allow-Origin` in all of these responses, and
answers the preflight with `204`.

## Run it

No database or broker is needed. Each case starts the app with
`NestFactory.create()`, listens on a free port on `127.0.0.1` and sends one
request with `http.request` and an `Origin` header.

```bash
npm install
npm run repro
```

The script runs three setups:

- `express (enableCors)`: Express with `app.enableCors({ origin: '*' })`.
- `fastify (enableCors)`: the same code on Fastify.
- `fastify (cors before middleware)`: `@fastify/cors` registered on the
  Fastify instance before `NestFactory.create()`, so that its hook runs
  before Nest middleware.

Each setup gets four requests. `GET /throw` goes to a middleware that throws
`UnauthorizedException`. `GET /next-error` goes to a middleware that passes
the same error to `next()`. `OPTIONS /throw` is a CORS preflight for
`/throw`. `GET /ok` is a control without middleware.

## What you should see

Output of `NO_COLOR=1 npm run repro`:

```
=== express (enableCors): GET /ok ===
  status:                      HTTP 200
  access-control-allow-origin: "*"
  expected:                    HTTP 200, "*"
  body:                        {"ok":true}

=== express (enableCors): GET /throw ===
  status:                      HTTP 401
  access-control-allow-origin: "*"
  expected:                    HTTP 401, "*"
  body:                        {"message":"Unauthorized","statusCode":401}

=== express (enableCors): GET /next-error ===
  status:                      HTTP 401
  access-control-allow-origin: "*"
  expected:                    HTTP 401, "*"
  body:                        {"message":"Unauthorized","statusCode":401}

=== express (enableCors): OPTIONS /throw ===
  status:                      HTTP 204
  access-control-allow-origin: "*"
  expected:                    HTTP 204, "*"
  body:                        

=== fastify (enableCors): GET /ok ===
  status:                      HTTP 200
  access-control-allow-origin: "*"
  expected:                    HTTP 200, "*"
  body:                        {"ok":true}

=== fastify (enableCors): GET /throw ===
  status:                      HTTP 401
  access-control-allow-origin: undefined
  expected:                    HTTP 401, "*"
  body:                        {"message":"Unauthorized","statusCode":401}

=== fastify (enableCors): GET /next-error ===
  status:                      HTTP 401
  access-control-allow-origin: undefined
  expected:                    HTTP 401, "*"
  body:                        {"message":"Unauthorized","statusCode":401}

=== fastify (enableCors): OPTIONS /throw ===
  status:                      HTTP 401
  access-control-allow-origin: undefined
  expected:                    HTTP 204, "*"
  body:                        {"message":"Unauthorized","statusCode":401}

=== fastify (cors before middleware): GET /ok ===
  status:                      HTTP 200
  access-control-allow-origin: "*"
  expected:                    HTTP 200, "*"
  body:                        {"ok":true}

=== fastify (cors before middleware): GET /throw ===
  status:                      HTTP 401
  access-control-allow-origin: undefined
  expected:                    HTTP 401, "*"
  body:                        {"message":"Unauthorized","statusCode":401}

=== fastify (cors before middleware): GET /next-error ===
  status:                      HTTP 401
  access-control-allow-origin: "*"
  expected:                    HTTP 401, "*"
  body:                        {"message":"Unauthorized","statusCode":401}

=== fastify (cors before middleware): OPTIONS /throw ===
  status:                      HTTP 204
  access-control-allow-origin: "*"
  expected:                    HTTP 204, "*"
  body:                        

RESULT: BUG: 4 of 12 responses do not match Express.
```

The exit code of `npm run repro` is 1.

## Why it happens

There are two causes.

1. The CORS hook runs after Nest middleware. `NestFactory.create()` calls
   `init()`, which registers `@fastify/middie` first
   ([`fastify-adapter.ts:523-530`](https://github.com/nestjs/nest/blob/d5d7e2c89f46b7f0f76e1d588bb092b41b4b926e/packages/platform-fastify/adapters/fastify-adapter.ts#L523-L530)).
   `app.enableCors()` registers `@fastify/cors` later
   ([`fastify-adapter.ts:1037-1043`](https://github.com/nestjs/nest/blob/d5d7e2c89f46b7f0f76e1d588bb092b41b4b926e/packages/platform-fastify/adapters/fastify-adapter.ts#L1037-L1043)).
   Fastify runs `onRequest` hooks in the order of registration, so a
   middleware that ends the request stops the CORS hook from running. This
   is why `fastify (enableCors)` fails all three requests that go through
   a middleware.
2. A thrown error loses the headers of the Fastify reply. A middleware that
   throws, or that returns a rejected promise, is caught by `RouterProxy`
   ([`router-proxy.ts:20-25`](https://github.com/nestjs/nest/blob/d5d7e2c89f46b7f0f76e1d588bb092b41b4b926e/packages/core/router/router-proxy.ts#L20-L25)).
   The exception filter then answers on the raw Node.js response. For a raw
   response, `FastifyAdapter.reply()` makes a new, empty `Reply`
   ([`fastify-adapter.ts:694-708`](https://github.com/nestjs/nest/blob/d5d7e2c89f46b7f0f76e1d588bb092b41b4b926e/packages/platform-fastify/adapters/fastify-adapter.ts#L694-L708)).
   Headers set with `reply.header()` before the middleware ran, such as the
   CORS headers, are not on that new `Reply`. This is why
   `fastify (cors before middleware)` still fails `GET /throw`. An error
   passed to `next()` goes to the Fastify error handler with the original
   reply, so `GET /next-error` keeps the header.

The built-in security headers do not have these problems. Their hook is added
in the constructor, before middie, and sets the headers on `reply.raw`
([`fastify-adapter.ts:409-423`](https://github.com/nestjs/nest/blob/d5d7e2c89f46b7f0f76e1d588bb092b41b4b926e/packages/platform-fastify/adapters/fastify-adapter.ts#L409-L423)).

## Verifying a fix

With a fix, all Fastify responses match Express. The last line is:

```
RESULT: FIXED: all 12 responses match Express.
```

The exit code is 0. To test a local build, install the packed
`@nestjs/platform-fastify` with `npm install ./path/to/package.tgz`.

## Versions

`@nestjs/common` 12.2.0 · `@nestjs/core` 12.2.0 · `@nestjs/platform-express`
12.2.0 · `@nestjs/platform-fastify` 12.2.0 · `fastify` 5.12.7 ·
`@fastify/cors` 11.3.1 · Node 24
