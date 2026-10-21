# A reused idempotency key with a different file replays the first upload

In `@nestjs/idempotency`, a request that reuses a key with a different body
must get a 422 `IDEMPOTENCY_KEY_REUSED`. The
[docs](https://github.com/nestjs/docs.nestjs.com/blob/de141305c6da0e932e35dd63aee183ca6628ec81/content/reliability/idempotency.md?plain=1#L130)
say so in the table of answers.

For a multipart upload, the second request gets the first response
replayed instead, with `Idempotent-Replayed: true`. The handler does not see
the second file.

## Run it

No database is needed. The script uses the default in-memory store and
sends real HTTP requests to the Express adapter.

```bash
npm install
npm run repro
```

The script runs three scenarios. In each, two requests use the same key with
a different body.

- `JSON body`: two payments with a different amount. This is the control.
- `multipart upload`: two uploads with a different file, through
  `FileInterceptor()`.
- `multipart upload with a Content-Digest fingerprint`: the same uploads,
  with an RFC 9530 `Content-Digest` header and a `fingerprint` option that
  uses that header.

## What you should see

Output of `npm run repro`:

```
=== JSON body, same key, different amount (control) ===
  first request:   201 {"amount":10}
  second request:  422 IDEMPOTENCY_KEY_REUSED
  handler calls:   1
  expected:        second request 422 IDEMPOTENCY_KEY_REUSED

=== multipart upload, same key, different file ===
  first request:   201 {"file":"bf41cf94047f"}
  second request:  201 (Idempotent-Replayed: true) {"file":"bf41cf94047f"}
  handler calls:   1
  expected:        second request 422 IDEMPOTENCY_KEY_REUSED

=== multipart upload with a Content-Digest fingerprint, same key, different file ===
  first request:   201 {"file":"bf41cf94047f"}
  second request:  422 IDEMPOTENCY_KEY_REUSED
  handler calls:   1
  expected:        second request 422 IDEMPOTENCY_KEY_REUSED

RESULT: BUG: a different body is replayed in 1 of 3 scenarios.
```

The `file` value is a short SHA-256 of the uploaded file. The exit code of
`npm run repro` is 1.

## Why it happens

`IdempotencyModule` registers its interceptor globally
([`idempotency.module.ts:38`](https://github.com/nestjs/idempotency/blob/b2c1e79af2c68cf04a3e6daecb1468a76da78bd4/lib/idempotency.module.ts#L38)),
so it runs before the interceptors of a handler. The fingerprint hashes the
scope, the method, the URL and `req.body`
([`idempotency.interceptor.ts:371-376`](https://github.com/nestjs/idempotency/blob/b2c1e79af2c68cf04a3e6daecb1468a76da78bd4/lib/interceptors/idempotency.interceptor.ts#L371-L376)).
At that point, `FileInterceptor()` has not parsed the multipart body, so the
file is not part of the fingerprint. Two uploads with a different file get
the same fingerprint.

The third scenario uses the recipe that the package's own test calls "The
README's recipe for bodies no parser reads"
([`http.integration.spec.ts:158`](https://github.com/nestjs/idempotency/blob/b2c1e79af2c68cf04a3e6daecb1468a76da78bd4/tests/http.integration.spec.ts#L158)).
The README and the docs do not contain it.

If a client does not send the `Content-Digest` header, the recipe falls back
to the scope, the method and the URL, and the upload is replayed again.

## Versions

`@nestjs/idempotency` 0.0.2 · `@nestjs/common` 12.2.0 · `@nestjs/core`
12.2.0 · `@nestjs/platform-express` 12.2.0 · Node 24
