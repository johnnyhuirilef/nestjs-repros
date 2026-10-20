# Returning an object with a non-JSON `Content-Type` responds 500 on the Fastify adapter

On the Fastify adapter, a handler that returns an object while the response
has a `Content-Type` that is not JSON responds with HTTP 500. The error code
is `FST_ERR_REP_INVALID_PAYLOAD_TYPE`. This happens with
`@Header('Content-Type', 'text/plain')`, with `text/html`, and when the
handler sets the header on the response object.

Express sends the object as JSON text with HTTP 200, and keeps the
`Content-Type` of the handler.

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
=== express: text-plain ===
  status:       HTTP 200
  content-type: "text/plain; charset=utf-8"
  expected:     HTTP 200, "text/plain"
  body:         {"hello":"world"}

=== express: text-html ===
  status:       HTTP 200
  content-type: "text/html; charset=utf-8"
  expected:     HTTP 200, "text/html"
  body:         {"hello":"world"}

=== express: passthrough-header ===
  status:       HTTP 200
  content-type: "text/plain; charset=utf-8"
  expected:     HTTP 200, "text/plain"
  body:         {"hello":"world"}

=== express: no-header ===
  status:       HTTP 200
  content-type: "application/json; charset=utf-8"
  expected:     HTTP 200, "application/json"
  body:         {"hello":"world"}

=== fastify: text-plain ===
  status:       HTTP 500
  content-type: "application/json; charset=utf-8"
  expected:     HTTP 200, "text/plain"
  body:         {"statusCode":500,"message":"Attempted to send payload of invalid type 'object'. Expected a string or Buffer."}

=== fastify: text-html ===
  status:       HTTP 500
  content-type: "application/json; charset=utf-8"
  expected:     HTTP 200, "text/html"
  body:         {"statusCode":500,"message":"Attempted to send payload of invalid type 'object'. Expected a string or Buffer."}

=== fastify: passthrough-header ===
  status:       HTTP 500
  content-type: "application/json; charset=utf-8"
  expected:     HTTP 200, "text/plain"
  body:         {"statusCode":500,"message":"Attempted to send payload of invalid type 'object'. Expected a string or Buffer."}

=== fastify: no-header ===
  status:       HTTP 200
  content-type: "application/json; charset=utf-8"
  expected:     HTTP 200, "application/json"
  body:         {"hello":"world"}

RESULT: BUG: 3 of 8 cases did not send the object with the Content-Type of the handler.
```

The exit code of `npm run repro` is 1. The `no-header` case is a control:
without a `Content-Type` header, both adapters send the object as JSON.

## Why it happens

`FastifyAdapter.reply()` gives the object to `reply.send()` without changing
it
([`fastify-adapter.ts:767-779`](https://github.com/nestjs/nest/blob/3a44abff549bc5e69162f29c1ad2a48cf3c91f57/packages/platform-fastify/adapters/fastify-adapter.ts#L767-L779)).
Fastify serializes an object only when the reply has no `Content-Type`, or
when the `Content-Type` is JSON (`fastify/lib/reply.js:219`). For other types
it expects a string, a Buffer or a stream, and it throws
`FST_ERR_REP_INVALID_PAYLOAD_TYPE`. Plain Fastify without Nest fails in the
same way.

The check in lines 767-778 changes the `Content-Type` to JSON, but only for an
error body (`statusCode >= 400`). It came from
[#10474](https://github.com/nestjs/nest/pull/10474), which fixed
[#8469](https://github.com/nestjs/nest/issues/8469). A successful response
does not get to that check.

Express calls `response.json(body)` for an object
([`express-adapter.ts:230`](https://github.com/nestjs/nest/blob/3a44abff549bc5e69162f29c1ad2a48cf3c91f57/packages/platform-express/adapters/express-adapter.ts#L230)).
`response.json()` keeps a `Content-Type` that is already set.

## Verifying a fix

With the fix, all Fastify cases send the object with the `Content-Type` of the
handler. The last line is:

```
RESULT: FIXED: all 8 cases send the object with the Content-Type of the handler.
```

The exit code is 0. Express adds `; charset=utf-8` to the `Content-Type`, so
the script compares only the media type. To test a local build, install the
packed `@nestjs/platform-fastify` with `npm install ./path/to/package.tgz`.

## Versions

`@nestjs/common` 12.2.0 · `@nestjs/core` 12.2.0 · `@nestjs/platform-express`
12.2.0 · `@nestjs/platform-fastify` 12.2.0 · `fastify` 5.12.7 · Node 24
