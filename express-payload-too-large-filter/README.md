# A body that is too large reaches exception filters unmapped on the Express adapter

On the Express adapter, a JSON body that is larger than the limit of the body
parser reaches a global exception filter as a raw `PayloadTooLargeError`, not
as an `HttpException`:

- The "Catch everything" filter of the
  [docs](https://docs.nestjs.com/exception-filters#catch-everything) uses
  `500` for any error that is not an `HttpException`, so it responds `500`
  instead of `413`.
- A `@Catch(HttpException)` filter does not run. The response is the `413` of
  the built-in filter.

Fastify gives both filters an `HttpException` with status `413`.

## Run it

No database or broker is needed. Each case starts the app with
`NestFactory.create()`, adds one global filter, listens on a free port on
`127.0.0.1` and sends one `POST` request with `http.request`.

```bash
npm install
npm run repro
```

The script runs two filters on Express and on Fastify:

- `catch-everything`: the "Catch everything" filter of the docs.
- `http-exception`: a `@Catch(HttpException)` filter.

Both filters set an `x-filter` header, so the script can see which filter
answered. They also put the class name of the exception that they received
in the body.

Each setup gets two requests. `too-large JSON` sends a 2 MB JSON body, which
is larger than the default limit of both adapters. `malformed JSON` sends
`{"a":` as a control.

## What you should see

Output of `NO_COLOR=1 npm run repro`:

```
=== express, catch-everything filter: too-large JSON ===
  status:     HTTP 500
  x-filter:   "catch-everything"
  expected:   HTTP 413, "catch-everything"
  body:       {"statusCode":500,"received":"PayloadTooLargeError"}

=== express, catch-everything filter: malformed JSON ===
  status:     HTTP 400
  x-filter:   "catch-everything"
  expected:   HTTP 400, "catch-everything"
  body:       {"statusCode":400,"received":"BadRequestException"}

=== express, http-exception filter: too-large JSON ===
  status:     HTTP 413
  x-filter:   undefined
  expected:   HTTP 413, "http-exception"
  body:       {"statusCode":413,"message":"request entity too large"}

=== express, http-exception filter: malformed JSON ===
  status:     HTTP 400
  x-filter:   "http-exception"
  expected:   HTTP 400, "http-exception"
  body:       {"statusCode":400,"received":"BadRequestException"}

=== fastify, catch-everything filter: too-large JSON ===
  status:     HTTP 413
  x-filter:   "catch-everything"
  expected:   HTTP 413, "catch-everything"
  body:       {"statusCode":413,"received":"HttpException"}

=== fastify, catch-everything filter: malformed JSON ===
  status:     HTTP 400
  x-filter:   "catch-everything"
  expected:   HTTP 400, "catch-everything"
  body:       {"statusCode":400,"received":"HttpException"}

=== fastify, http-exception filter: too-large JSON ===
  status:     HTTP 413
  x-filter:   "http-exception"
  expected:   HTTP 413, "http-exception"
  body:       {"statusCode":413,"received":"HttpException"}

=== fastify, http-exception filter: malformed JSON ===
  status:     HTTP 400
  x-filter:   "http-exception"
  expected:   HTTP 400, "http-exception"
  body:       {"statusCode":400,"received":"HttpException"}

RESULT: BUG: 2 of 8 responses do not come from the filter with the right status.
```

The exit code of `npm run repro` is 1.

## Why it happens

An error of the body parser goes to the exception handler of the router. That
handler calls `mapException()` of the adapter before the filters see the
error
([`routes-resolver.ts:173-181`](https://github.com/nestjs/nest/blob/d5d7e2c89f46b7f0f76e1d588bb092b41b4b926e/packages/core/router/routes-resolver.ts#L173-L181)).

- `ExpressAdapter.mapException()` changes only `SyntaxError` and `URIError`
  into a `BadRequestException`
  ([`express-adapter.ts:671-681`](https://github.com/nestjs/nest/blob/d5d7e2c89f46b7f0f76e1d588bb092b41b4b926e/packages/platform-express/adapters/express-adapter.ts#L671-L681)).
  This is why the malformed JSON works. The `PayloadTooLargeError` of
  `body-parser` comes from `http-errors`, so it goes to the filters without
  a change.
- `FastifyAdapter.mapException()` changes every Fastify error with a
  `statusCode` into an `HttpException`
  ([`fastify-adapter.ts:1285-1291`](https://github.com/nestjs/nest/blob/d5d7e2c89f46b7f0f76e1d588bb092b41b4b926e/packages/platform-fastify/adapters/fastify-adapter.ts#L1285-L1291)).

When no custom filter runs, the built-in filter already reads the
`statusCode` of an `http-errors` error
([`base-exception-filter.ts:59-73`](https://github.com/nestjs/nest/blob/d5d7e2c89f46b7f0f76e1d588bb092b41b4b926e/packages/core/exceptions/base-exception-filter.ts#L59-L73)).
It does that since nestjs/nest#5990, which was tracked from nestjs/nest#5191.

## Verifying a fix

With a fix, every response comes from the filter with the right status. The
last line is:

```
RESULT: FIXED: all 8 responses come from the filter with the right status.
```

The exit code is 0. To test a local build, install the packed
`@nestjs/platform-express` with `npm install ./path/to/package.tgz`.

## Versions

`@nestjs/common` 12.2.0 · `@nestjs/core` 12.2.0 · `@nestjs/platform-express`
12.2.0 · `@nestjs/platform-fastify` 12.2.0 · `fastify` 5.12.7 · Node 24
