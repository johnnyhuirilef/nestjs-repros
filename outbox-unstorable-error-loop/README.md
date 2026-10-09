# `@nestjs/outbox` loops forever on an error its Postgres store cannot write

With the Postgres store, a handler can throw an error whose message holds a lone
UTF-16 surrogate or `U+0000`. Postgres refuses to store that text in a `jsonb`
column. The relay swallows the store error, so the message is never retried with
backoff and never dead-lettered. The handler runs again each time the lease
expires, with no end. The in-memory store dead-letters the same message.

A common trigger is `JSON.parse('😀 not json')`: V8 puts a cut-in-half emoji
(`\ud83d`) into the error message.

## Run it

```bash
npm install
npm run repro
```

No database is needed. The script uses PGlite (Postgres in the same process).
It runs two cases with the same config (3 attempts, 100 ms backoff, 600 ms
lease) and watches each for 4 seconds. The process exits by itself.

Node used: v24.19.0

## What you should see

```
--- control: handler throws JSON.parse("x not json") ---
handler calls:   3
events:          retry-scheduled=2 dead-lettered=1
stats:           pending=0 deadLetters=1
row attempts:    row is gone
store log:       "Outbox store fail failed" logged 0 times
other errors:    0

--- bug: handler throws JSON.parse("😀 not json") ---
handler calls:   7
events:          none
stats:           pending=1 deadLetters=0
row attempts:    0
store log:       "Outbox store fail failed" logged 7 times
first one:       Outbox store fail failed: Error: Failed query: UPDATE "nest_outbox".messages
other errors:    0

RESULT: BUG: the message with the unstorable error was never retried or dead-lettered
        (7 handler calls, limit is 3; attempts stays 0)
```

The control case retries twice, then dead-letters on the third failure. The bug
case calls the handler more than 3 times, schedules no retry, and leaves
`attempts` at 0. The call count in the bug run grows with time: it is 7 after
4 seconds, and it keeps growing as long as the process runs. The exact number
varies a little between runs.

## Why it happens

Line numbers are from `nestjs/outbox` at `02d9c8c`.

1. `lib/utils/describe-error.util.ts:4-7` builds the stored error text. It
   cuts the text with `slice(0, 2000)` and does not remove `U+0000` or lone
   surrogates. (The cut can also split a surrogate pair.)
2. `lib/postgres/postgres-outbox.store.ts:220-232` (`reschedule`) and
   `:239-257` (`deadLetter`) write that text into the `history` `jsonb`
   column (`history || ${p.json([update.error])}`). Postgres rejects it, so the
   query throws.
3. `lib/services/outbox-relay.service.ts:407-409` (`fail()`) catches the store
   error, logs `Outbox store fail failed`, and returns `'lost'`. Nothing was
   written, so `attempts` stays 0 and the lease is still held. When the lease
   expires, the relay claims the message again and the cycle repeats.

Postgres says no to both kinds of text. This is PGlite, which runs the real
Postgres parser:

```ts
await client.query('select $1::jsonb', ['"a\\u0000b"']); // unsupported Unicode escape sequence
await client.query('select $1::jsonb', ['"\\ud83d"']);   // invalid input syntax for type json
```

## Versions

`@nestjs/outbox` 0.1.1 · `@nestjs/common` 12.1.2 · `@nestjs/core` 12.1.2 ·
`@electric-sql/pglite` 0.5.8 · `drizzle-orm` 0.45.4 · `tsx` 4.23.15 · Node 24

`tsx` does not emit decorator metadata, so the handler injects its dependency
with an explicit `@Inject()`.
