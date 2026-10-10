# `@nestjs/outbox` MySQL store fails to add a message over about 250 KB

With the MySQL store, `outbox.add()` fails with `Out of sort memory, consider
increasing server sort buffer size` when the stored JSON of one message is over
about 250 KB. The size can come from the payload or from the headers. The
failure also hits a batch that holds one large message and several small ones.
A message of 100 KB works. The error stops `add()`, so the transaction in the
repro rolls back and the business row is lost too.

## Run it

You need Docker, Node and npm.

```bash
docker compose up -d --wait
npm install
npm run repro
docker compose down -v
```

The `compose.yaml` file starts `mysql:8.4` on `127.0.0.1:53306` with the root
password `root`. The script reads `DATABASE_URL`. The default is
`mysql://root:root@127.0.0.1:53306/outbox_repro`. Each run drops and creates
that database, so every run starts clean. To use another server, set your own
URL: `DATABASE_URL=mysql://... npm run repro`.

The script runs four cases. Each case adds the messages in a transaction that
also inserts a small business row. Then it prints the result and whether the
business row survived.

Node used: v24.19.0
MySQL used: 8.4.11 (`sort_buffer_size` is the default, 262144). Also seen on
9.7.0 in an earlier run.

## What you should see

```
MySQL {"version":"8.4.11","sortBufferSize":262144}
100 KB payload (control)           ok | business row survived: true
300 KB payload                     ER_OUT_OF_SORTMEMORY: Out of sort memory, consider increasing server sort buffer size | business row survived: false
300 KB headers                     ER_OUT_OF_SORTMEMORY: Out of sort memory, consider increasing server sort buffer size | business row survived: false
batch: 300 KB payload + 10 small   ER_OUT_OF_SORTMEMORY: Out of sort memory, consider increasing server sort buffer size | business row survived: false

RESULT: BUG: the control passed and a large message failed with the sort-memory error
```

The control case with a 100 KB payload works. Every case with a 300 KB message
fails, also when the message is in a batch with small ones.

## Why it happens

Line numbers are from `nestjs/outbox` at `origin/master` (`67735f7`), in
`lib/mysql/mysql-outbox.store.ts`.

1. `:214-227` (`add()`) writes the messages with one statement:
   `INSERT INTO ... SELECT ... FROM JSON_TABLE(...) AS j` followed by
   `ORDER BY j.n` (the `ORDER BY` is at `:227`). The sort keeps the numbers
   of the messages in order. It sorts in a buffer of 256 KB by default.
2. A row over about 250 KB does not fit in the default `sort_buffer_size`
   (262144 bytes). The statement fails with `ER_OUT_OF_SORTMEMORY`.
3. `BATCH_JSON_LENGTH` at `:48` is `1 << 20`. Its comment at `:44-47` only
   relates it to `max_allowed_packet`. It does not limit the size of one row,
   so a single large message still goes into the sort.

## Versions

`@nestjs/outbox` 0.1.1 · `@nestjs/common` 12.1.2 · `@nestjs/core` 12.1.2 ·
`mysql2` 3.24.5 · MySQL 8.4.11 · `tsx` 4.23.15 · Node 24

`tsx` does not emit decorator metadata. This script has no decorated class
that needs injection, and the store factory lists its dependency in `inject`.
