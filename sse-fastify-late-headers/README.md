# Headers set by an interceptor or a handler are dropped on a Fastify `@Sse()` route

On an `@Sse()` route, the router copies the reply headers once and passes the
copy to the SSE response:

```ts
// packages/core/router/router-execution-context.ts (simplified)
responseController.sse(result, res, req, {
  additionalHeaders: res.getHeaders?.(),
  statusCode,
});
```

The interceptors of an SSE route run later, when the stream is subscribed, and
the handler can set headers before it returns the Observable. The SSE response
writes the head when the first event is ready, and it writes the copy, not the
reply. Express keeps its headers on the raw response, so they still go out.
Fastify keeps them on the `FastifyReply`, so only the copy reaches the client.

The result on Fastify:

- A header that an interceptor sets with `reply.header()` is not sent.
- A header that the handler sets with `@Res({ passthrough: true })` is not sent.
- A header from `@Header()`, a guard or a middleware is sent, because it is set
  before the copy.

The same code works on a normal route and on Express.

## Run it

No broker is needed. The script starts the same app on Express and on Fastify.
It has a normal `@Get()` route and an `@Sse()` route. An interceptor sets
`x-interceptor`, the handler sets `x-handler`, and `@Header()` sets
`x-decorator` (the baseline). A real HTTP client prints the headers it receives.
For the SSE route it reads the first event and aborts.

```bash
npm install
npm run repro
```

## What you should see

Output of `NO_COLOR=1 npm run repro`:

```
=== express: plain route ===
  expected: x-decorator, x-interceptor, x-handler
  received: x-decorator, x-interceptor, x-handler
  outcome:  as expected

=== express: sse route ===
  expected: x-decorator, x-interceptor, x-handler
  received: x-decorator, x-interceptor, x-handler
  outcome:  as expected

=== fastify: plain route ===
  expected: x-decorator, x-interceptor, x-handler
  received: x-decorator, x-interceptor, x-handler
  outcome:  as expected

=== fastify: sse route ===
  expected: x-decorator, x-interceptor, x-handler
  received: x-decorator
  outcome:  missing x-interceptor, x-handler

RESULT: BUG: 1 of 4 cases did not end as expected (headers set by an interceptor or a handler are dropped on an @Sse() route on Fastify).
```

The exit code of `npm run repro` is 1.

## Verifying a fix

With the fix, the Fastify SSE route receives all three headers. The last line
is:

```
RESULT: FIXED: all 4 cases carry the decorator, interceptor and handler headers.
```

The exit code is 0. To test a local build, install the packed `@nestjs/core`
(and `@nestjs/common` and `@nestjs/platform-fastify` if they changed) with
`npm install ./path/to/package.tgz`.

## Versions

`@nestjs/common` 12.1.2 · `@nestjs/core` 12.1.2 · `@nestjs/platform-express`
12.1.2 · `@nestjs/platform-fastify` 12.1.2 · `fastify` 5.12.5 · Node 24
