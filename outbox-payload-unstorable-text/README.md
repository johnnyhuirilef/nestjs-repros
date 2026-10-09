# `@nestjs/outbox` Postgres store throws a raw driver error for text it cannot store

With the PostgreSQL store, `outbox.add()` throws a raw driver error when a string
in `payload` or `headers` holds `U+0000` or a lone UTF-16 surrogate. The error is
not an `OutboxError` or a `TypeError`, and it aborts your business transaction.
The in-memory store accepts the same message and delivers it to the handler.

A common source is `JSON.parse('😀 not json')`: V8 puts a cut-in-half emoji
(`\ud83d`) into the error message, and an app can store that message in a payload.

## Run it

```bash
npm install
npm run repro
```

No database is needed. The script uses PGlite (Postgres in the same process).
It runs the in-memory store first as a control, then the PostgreSQL store. Each
case adds one message in a transaction that also inserts one business row. The
process exits by itself with code 0.

Node used: v24.19.0

## What you should see

```
in-memory            | control                | add: ok delivered: true hasNul=false
in-memory            | payload U+0000         | add: ok delivered: true hasNul=true
in-memory            | payload lone surrogate | add: ok delivered: true hasNul=false
in-memory            | header U+0000          | add: ok delivered: true hasNul=true
PostgreSQL (PGlite)  | control                | add: ok orders-after=1
PostgreSQL (PGlite)  | payload U+0000         | add: DrizzleQueryError 22P05: unsupported Unicode escape sequence OutboxError=false TypeError=false orders-after=0
PostgreSQL (PGlite)  | payload lone surrogate | add: DrizzleQueryError 22P02: invalid input syntax for type json OutboxError=false TypeError=false orders-after=0
PostgreSQL (PGlite)  | header U+0000          | add: DrizzleQueryError 22P05: unsupported Unicode escape sequence OutboxError=false TypeError=false orders-after=0

RESULT: BUG: the in-memory store accepts and delivers these messages, but PostgreSQL throws a raw driver error
```

Each line shows the store, the case, the result of `add()`, and the type of the
error. For PostgreSQL it also shows how many business rows exist after the
transaction. For the in-memory store it shows whether the handler got the
message and whether the text still holds `U+0000`.

The control message works in both stores. The three other messages work in memory
and fail in PostgreSQL. The error is a driver error (`DrizzleQueryError` here,
`DatabaseError` with `fromPg`), with PostgreSQL code `22P05` for `U+0000` and
`22P02` for a lone surrogate. The business row is gone, because the failed
`add()` rolls back the whole transaction. The error is neither an `OutboxError`
nor a `TypeError`, so code that handles outbox errors cannot tell this case from
a lost database connection.

Object key names with the same text fail the same way. The script checks values only.

## Run it on a real PostgreSQL server

The default run uses PGlite. To use a real PostgreSQL server, you need Docker.
The `compose.yaml` file starts `postgres:18.6` on `127.0.0.1:55434`. The script
uses it when `DATABASE_URL` is set. The `repro:pg` script sets that variable
for you. Each run drops the `nest_outbox` schema and the `orders` table first,
so every run starts clean.

```bash
docker compose up -d --wait
npm run repro:pg
docker compose down -v
```

The output has the same shape. Only the error class differs (`DatabaseError`
instead of `DrizzleQueryError`). To use another server, set your own URL:
`DATABASE_URL=postgres://... npm run repro:pg`.

## Why it happens

Line numbers are from `nestjs/outbox` at `02d9c8c` (`origin/master`).

1. `lib/outbox.service.ts:57-93` (`build()`) already checks a message before it
   reaches the store. It throws a `TypeError` for a payload that is not
   JSON-serializable (BigInt, a cycle, `undefined`). It does not check for text
   that JSON accepts but PostgreSQL does not.
2. `lib/postgres/migrations/initial.migration.ts:17-18` stores `payload` and
   `headers` in `jsonb` columns.
3. PostgreSQL rejects the text when the store inserts the row. The driver error
   goes up from `add()` as it is. The transaction is now aborted, so the
   application loses its own work too.

The PostgreSQL documentation says
(https://www.postgresql.org/docs/current/datatype-json.html):

> The `jsonb` type also rejects `\u0000` (because that cannot be represented in
> PostgreSQL's `text` type), and it insists that any use of Unicode surrogate
> pairs to designate characters outside the Unicode Basic Multilingual Plane be
> correct.

PGlite runs the real Postgres parser, so the plain SQL shows the same errors:

```ts
await client.query('select $1::jsonb', ['"a\\u0000b"']); // unsupported Unicode escape sequence
await client.query('select $1::jsonb', ['"\\ud83d"']);   // invalid input syntax for type json
```

## Versions

`@nestjs/outbox` 0.1.1 · `@nestjs/common` 12.1.2 · `@nestjs/core` 12.1.2 ·
`@electric-sql/pglite` 0.5.8 · `drizzle-orm` 0.45.4 · `pg` 8.23.1 · `postgres` 18.6 · `tsx` 4.23.15 · Node 24

`tsx` does not emit decorator metadata, so the handler injects its dependency
with an explicit `@Inject()`.
