# `@nestjs/http-client` throws on `304 Not Modified`

The docs say that with `responseType: 'auto'` (the default), `data` is
`undefined` for `204`, `205` and `304` responses. With the default settings, a
`304` never returns `undefined`: the client throws `HttpResponseError` first.
`data` is `undefined` only when `throwOnHttpError` is `false`.

A `304` comes back when the client sends a conditional request, for example an
`If-None-Match` header with an ETag it has cached.

## Run it

```bash
npm install
npm run repro
```

Node.js 24.19.0 was used. The package needs Node.js 20.19 or later.

## What you should see

```
1. first GET               -> 200 {"name":"cat"}
2. GET with If-None-Match  -> THROWS HttpResponseError: GET http://127.0.0.1:34865/item failed with 304 Not Modified
3. same, throwOnHttpError: false -> 304 undefined
```

The port changes on every run.

## Why it happens

In `@nestjs/http-client` 0.0.2, `lib/utils/response.util.ts`:

- `finish()` throws `HttpResponseError` when `!response.ok && throwOnHttpError`
  (line 79). A `304` is not `ok`, and `throwOnHttpError` is `true` by default.
- The code that gives `undefined` for `204`, `205` and `304` (line 138) runs
  only after that check.

The docs that promise `undefined` for `304`:

- The JSDoc of `HttpResponseType` (`lib/interfaces/http-request.interface.ts`,
  line 28): "`undefined` for empty bodies, 204/205/304 and HEAD."
- The `responseType` table on
  [docs.nestjs.com](https://docs.nestjs.com/application/http-client).
