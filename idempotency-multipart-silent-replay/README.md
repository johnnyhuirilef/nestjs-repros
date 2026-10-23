# `@nestjs/idempotency` replays a multipart request with other content, and logs nothing

The interceptor computes the fingerprint before `FileInterceptor` (multer) or
`req.parts()` parses a multipart body. So the fingerprint covers neither the
text fields nor the files. A key reused with other content gets the first
response, not a 422, and nothing is logged.

## Run it

```bash
npm install
npm run repro
```

No database is needed. The script uses the default in-memory store. It starts
an Express app with `FileInterceptor`, a Fastify app that reads
`req.parts()` in the handler, and, as a control, a Fastify app with
`attachFieldsToBody: 'keyValues'`. Each pair of requests uses the same
`Idempotency-Key`. The process exits by itself.

Node used: v24.21.0

## What you should see

On `@nestjs/idempotency` 0.0.2:

```
=== Express, FileInterceptor ===
  other text field
    first  201 {"note":"first","file":"same file"}
    second 201 {"note":"first","file":"same file"}
    handler runs: 1
  other file
    first  201 {"note":"same","file":"file one"}
    second 201 {"note":"same","file":"file one"}
    handler runs: 1
  JSON body (control)
    first  201 {"body":{"a":1}}
    second 422 {"statusCode":422,"error":"Unprocessable Entity","code":"IDEMPOTENCY_KEY_REUSED","message"
    handler runs: 1

=== Fastify, req.parts() in the handler ===
  other text field
    first  201 {"note":"first","file":"same file"}
    second 201 {"note":"first","file":"same file"}
    handler runs: 1
  other file
    first  201 {"note":"same","file":"file one"}
    second 201 {"note":"same","file":"file one"}
    handler runs: 1

=== Fastify, attachFieldsToBody: 'keyValues' (control) ===
  other text field
    first  201 {"note":"first","file":"same file"}
    second 422 {"statusCode":422,"error":"Unprocessable Entity","code":"IDEMPOTENCY_KEY_REUSED","message"
    handler runs: 1

warnings logged while the apps ran: 0

RESULT: BUG: 4 multipart retries with other content got the first answer, and nothing was logged.
```

The exit code is 1. A JSON body with other content gets a 422, and so does a
Fastify multipart body that is parsed before the interceptor.
