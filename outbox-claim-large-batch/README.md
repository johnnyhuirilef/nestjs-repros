# `@nestjs/outbox` SQL stores: one `claim()` gets superlinear with a large `relay.batchSize`

With a large `relay.batchSize`, one `claim()` takes much more than a linear amount of time on
both SQL stores. The default of 100 is fine. The setting has no
upper limit, and the docs list it as `100 | Messages per claim` without a
warning about large values. In this run, 10000 messages take about 4.6 s on
MySQL 8.4 and about 6.9 s on PostgreSQL 18.6. The cost per message at 10000 is
3.9 times (MySQL) and 6.1 times (PostgreSQL) the cost at 1000.

## Run it

You need Docker, Node and npm.

```bash
npm install
docker compose up -d --wait
npm run repro
docker compose down -v
```

The `compose.yaml` file starts `mysql:8.4.11` on `127.0.0.1:53308` and
`postgres:18.6` on `127.0.0.1:55438`. To use other servers, set `MYSQL_URL` and
`POSTGRES_URL`. The script drops and creates its own tables (`repro_*` on MySQL,
the `repro` schema on PostgreSQL), so every run starts clean. The whole run
takes about 20 seconds.

For each store, the script inserts 10000 due messages, each with its own key.
Then it calls `store.claim({ limit })` once for each batch size, the same call
the relay makes with `relay.batchSize` as the limit. Before each claim, it
clears the leases. On MySQL, it also adds up the time of the statement that
`gaps()` sends (the `gaps ms` column). The first claim of a run is a warm-up of
one message and is not in the table.

Timings depend on the machine, so expect other numbers. The shape of the
growth is what counts.

## Result rule

A claim that scales linearly costs the same per message at every batch size, so
the ratio is about 1. The script prints `RESULT: SLOW` when a store costs more
than 2 times as much per message at 10000 as at 1000. Otherwise it prints
`RESULT: OK`. The base is 1000 and not 100, because a claim of 100 takes under
10 ms and its timing is noisy.

## Example output

Output of a real run:

```
10000 due messages, every one with its own key. One claim() per batch size.

store            | batch size | claimed | claim ms | gaps ms | ms per message
MySQL 8.4        |        100 |     100 |        9 |       4 |          0.092
MySQL 8.4        |       1000 |    1000 |      118 |      91 |          0.118
MySQL 8.4        |       5000 |    5000 |     1385 |    1222 |          0.277
MySQL 8.4        |      10000 |   10000 |     4581 |    4219 |          0.458
PostgreSQL 18.6  |        100 |     100 |        7 |       - |          0.066
PostgreSQL 18.6  |       1000 |    1000 |      113 |       - |          0.113
PostgreSQL 18.6  |       5000 |    5000 |     2114 |       - |          0.423
PostgreSQL 18.6  |      10000 |   10000 |     6921 |       - |          0.692

RESULT: SLOW: MySQL 8.4 costs 3.9x more per message at 10000 than at 1000; PostgreSQL 18.6 costs 6.1x more per message at 10000 than at 1000 (limit 2x)
```

Node used: v24.19.0. MySQL 8.4.11 and PostgreSQL 18.6. In an earlier run, MySQL
9.7.0 gave the same shape (10000 messages in about 8.5 s).

## Why it happens

Line numbers are from `nestjs/outbox` at `origin/master`
([`67735f7`](https://github.com/nestjs/outbox/tree/67735f744ce7d712993167261503fb2a85379b9e)).
The `lib` folder is the same as in 0.1.1.

- MySQL: `gaps()`
  ([`mysql-outbox.store.ts:639-662`](https://github.com/nestjs/outbox/blob/67735f744ce7d712993167261503fb2a85379b9e/lib/mysql/mysql-outbox.store.ts#L639-L662))
  builds one `UNION ALL` branch for each keyed row and sends them as one
  statement
  ([`:660`](https://github.com/nestjs/outbox/blob/67735f744ce7d712993167261503fb2a85379b9e/lib/mysql/mysql-outbox.store.ts#L660)).
  That statement takes 88% (5000) and 92% (10000) of the claim time in the table above.
- PostgreSQL: the `taken` step has `NOT EXISTS (SELECT 1 FROM cut WHERE cut.key = c.key AND cut.seq <= c.seq)`
  ([`postgres-outbox.store.ts:195`](https://github.com/nestjs/outbox/blob/67735f744ce7d712993167261503fb2a85379b9e/lib/postgres/postgres-outbox.store.ts#L195)).
  `EXPLAIN ANALYZE` shows that this subquery scans the CTE once for each row
  (`loops=10000`, `Rows Removed by Filter: 10000`).
