# `@Redirect()` with a non-ASCII URL responds 500 on the Fastify adapter

On the Fastify adapter, `@Redirect('/文档')` responds with HTTP 500 and the
error code `ERR_INVALID_CHAR`. A redirect to a URL that has a space or a
Latin-1 character, such as `/a b?q=ü`, sends the `Location` header without
encoding. A dynamic redirect (`return { url: '/文档' }`) fails in the same
way.

Express encodes the `Location` header and redirects with HTTP 302 in all
cases.

## Run it

No database or broker is needed. Each case starts the app with
`NestFactory.create()`, listens on a free port on `127.0.0.1` and sends one
request with `http.get`.

```bash
npm install
npm run repro
```

## What you should see

Output of `NO_COLOR=1 npm run repro`:

```
=== express: non-ascii ===
  status:   HTTP 302
  location: "/%E6%96%87%E6%A1%A3"
  expected: "/%E6%96%87%E6%A1%A3"

=== express: dynamic-non-ascii ===
  status:   HTTP 302
  location: "/%E6%96%87%E6%A1%A3"
  expected: "/%E6%96%87%E6%A1%A3"

=== express: space-and-query ===
  status:   HTTP 302
  location: "/a%20b?q=%C3%BC"
  expected: "/a%20b?q=%C3%BC"

=== express: already-encoded ===
  status:   HTTP 302
  location: "/%E6%96%87%E6%A1%A3"
  expected: "/%E6%96%87%E6%A1%A3"

=== fastify: non-ascii ===
  status:   HTTP 500
  location: undefined
  expected: "/%E6%96%87%E6%A1%A3"
  body:     {"statusCode":500,"code":"ERR_INVALID_CHAR","error":"Internal Server Error","message":"Invalid character in header content [\"location\"]"}

=== fastify: dynamic-non-ascii ===
  status:   HTTP 500
  location: undefined
  expected: "/%E6%96%87%E6%A1%A3"
  body:     {"statusCode":500,"code":"ERR_INVALID_CHAR","error":"Internal Server Error","message":"Invalid character in header content [\"location\"]"}

=== fastify: space-and-query ===
  status:   HTTP 302
  location: "/a b?q=ü"
  expected: "/a%20b?q=%C3%BC"

=== fastify: already-encoded ===
  status:   HTTP 302
  location: "/%E6%96%87%E6%A1%A3"
  expected: "/%E6%96%87%E6%A1%A3"

RESULT: BUG: 3 of 8 cases failed or sent an unencoded Location header.
```

The exit code of `npm run repro` is 1.

## Why it happens

`FastifyAdapter.redirect()` gives the URL to `reply.redirect()` without
changing it
([`fastify-adapter.ts:807-810`](https://github.com/nestjs/nest/blob/a6cc71a4a8210794a628157e0e2025494d12e00a/packages/platform-fastify/adapters/fastify-adapter.ts#L807-L810)).
The Fastify docs say that the caller must encode the URL, and that an invalid
URL results in a 500 response
([`Reply.md`](https://github.com/fastify/fastify/blob/main/docs/Reference/Reply.md#redirectdest--code)).
Express calls `encodeUrl()` on the URL in `res.location()`
(`express/lib/response.js:798`).

## Verifying a fix

With the fix, all Fastify cases send the same `Location` header as Express.
The last line is:

```
RESULT: FIXED: all 8 cases redirect with an encoded Location header.
```

The exit code is 0. The `already-encoded` case makes sure that a fix does
not encode a `%` a second time. To test a local build, install the packed
`@nestjs/platform-fastify` with `npm install ./path/to/package.tgz`.

## Versions

`@nestjs/common` 12.2.0 · `@nestjs/core` 12.2.0 · `@nestjs/platform-express`
12.2.0 · `@nestjs/platform-fastify` 12.2.0 · `fastify` 5.12.7 · Node 24
