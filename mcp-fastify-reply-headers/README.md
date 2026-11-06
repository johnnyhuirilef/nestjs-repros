# Fastify: /mcp misses the headers that the app set on the reply

In `@nestjs/mcp` 0.0.3 on Fastify, the MCP endpoint calls `reply.hijack()` and writes the raw response with the headers of the MCP SDK only. A header that the app set on the Fastify reply before is not sent. For example, a header from a global interceptor, from an `onRequest` hook, or from `@fastify/cors` registered with `app.register()`. The same headers reach the other routes of the app. On Express, the interceptor's header reaches `/mcp` too.

The script starts an app with `McpModule.forRoot()`, one tool and a `GET /ping` route, four times: on Express with a global interceptor that sets `x-request-id` (the control), and on Fastify with that interceptor, with an `onRequest` hook that calls `reply.header()`, and with `app.register(@fastify/cors)`. Each time, it sends `tools/list` to `/mcp` and a GET to `/ping`, both with an `Origin` header that `allowedOrigins` accepts, and prints the header on each response.

## Run

```bash
npm install
npm run repro
```

## Output

On Node 26.13.0, macOS:

```
=== express: a global interceptor sets x-request-id (control) ===
  GET /ping:  200, x-request-id: req-1
  POST /mcp:  200, x-request-id: req-1, tool listed: true

=== fastify: a global interceptor sets x-request-id ===
  GET /ping:  200, x-request-id: req-1
  POST /mcp:  200, x-request-id: null, tool listed: true

=== fastify: an onRequest hook sets x-request-id with reply.header() ===
  GET /ping:  200, x-request-id: req-1
  POST /mcp:  200, x-request-id: null, tool listed: true

=== fastify: app.register(@fastify/cors) ===
  GET /ping:  200, access-control-allow-origin: https://support.catstore.example
  POST /mcp:  200, access-control-allow-origin: null, tool listed: true

RESULT: BUG: /mcp misses a header that the same app sends on its other routes, in 3 of 4 cases.
```

The exit code is 1. When the bug is fixed, the script prints `RESULT: FIXED` and exits with 0.
