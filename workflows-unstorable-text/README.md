# `@nestjs/workflows`: text that a database cannot store makes a step run again or a run loop

PostgreSQL cannot store U+0000 in `jsonb`, and neither PostgreSQL nor MySQL can store a lone UTF-16 surrogate in JSON. The in-memory store keeps both without a problem.

On a SQL store, the engine treats the failed write as a transient store
error. It runs the instance again when the lease expires, with no limit. The
result depends on where the text comes from:

1. A step returns the text (case a). The step body runs 3 times. Then the step
   fails with `StepInterruptedError`, which hides the real cause.
2. The workflow returns the text (case b). The instance stays `running` and
   `runs` grows by one at each lease, with no end.

Tests on the default in-memory store pass (case c), so the problem shows up only on a SQL store.

## Run it

You need Docker, Node and npm.

```bash
npm install
docker compose up -d --wait
npm run repro
docker compose down -v
```

The `compose.yaml` file starts `postgres:18.6` on `127.0.0.1:55439` and
`mysql:8.4.11` on `127.0.0.1:53309`. The script reads `POSTGRES_URL` and
`MYSQL_URL`. The defaults match the compose file. Each case creates its own
database (MySQL) or schema (PostgreSQL), so the script does not clean up after
itself. Run `docker compose down -v` to remove the containers and the data.

The script sets `leaseDuration` to `3s`. It watches each case for up to 10
seconds, and prints the status each time it changes. The whole run takes about
30 seconds.

## Cases

| Case | Store | What the workflow does |
| ---- | ----- | ---------------------- |
| (a) | PostgreSQL, MySQL | A step returns `{ note: 'x' + '😀'.slice(0, 1) }`, a lone surrogate. |
| (b) | PostgreSQL | The workflow returns `{ note: 'a\u0000b' }`. |
| (c) | in-memory | The same two workflows. Control. |
| (c) | PostgreSQL | A step returns `{ note: 'x😀y' }`, a valid pair. Control. |

For each case the script prints the store, the status timeline, `runs`, how
many times the step body ran, and the first error (cut at 150 characters).

## How the result is decided

- `REPRODUCED`: every control completes with `runs: 1` and one step body run. Every bad case also runs its step body more than once, or ends the 10 seconds without a final status and with `runs` of 3 or more.
- `OK`: every control completes in one run, and no bad case does either of the
  two things above.
- `UNEXPECTED`: anything else, for example a control that does not complete in
  one run.

## Output

On `@nestjs/workflows` 0.0.3:

```
case:      (c) control: in-memory, lone surrogate in a step result
store:     memory
status:    completed(runs=1)@1s
runs:      1
step body: 1 run(s)
error:     -  (logged errors: 0)

case:      (c) control: in-memory, U+0000 in the returned value
store:     memory
status:    completed(runs=1)@1s
runs:      1
step body: 1 run(s)
error:     -  (logged errors: 0)

case:      (c) control: PostgreSQL, valid emoji pair in a step result
store:     postgres
status:    completed(runs=1)@1s
runs:      1
step body: 1 run(s)
error:     -  (logged errors: 0)

case:      (a) step result with a lone surrogate
store:     postgres
status:    running(runs=1)@1s -> running(runs=2)@4s -> running(runs=3)@7s -> failed(runs=4)@10s
runs:      4
step body: 3 run(s)
error:     Step "s1" failed after 3 attempt(s): StepInterruptedError: Attempt 3 did not finish: the worker stopped, lost its lease, or could not write the result...  (logged errors: 3)

case:      (a) step result with a lone surrogate
store:     mysql
status:    running(runs=1)@1s -> running(runs=2)@4s -> running(runs=3)@7s -> failed(runs=4)@10s
runs:      4
step body: 3 run(s)
error:     Step "s1" failed after 3 attempt(s): StepInterruptedError: Attempt 3 did not finish: the worker stopped, lost its lease, or could not write the result...  (logged errors: 3)

case:      (b) returned value with U+0000
store:     postgres
status:    running(runs=1)@1s -> running(runs=2)@4s -> running(runs=3)@7s -> running(runs=4)@10s
runs:      4
step body: 1 run(s)
error:     error: unsupported Unicode escape sequence  (logged errors: 4)

RESULT: REPRODUCED: all 3 bad case(s) on SQL stores re-ran a step or looped, and the controls completed in one run
```

The in-memory controls complete. The step in case (a) runs 3 times on both SQL
stores, and the run ends as `failed` with `runs: 4`. In case (b), the
instance is still `running` after 10 seconds and `runs` keeps growing. The
`error:` line of case (b) is the PostgreSQL error, which the engine logs once
for each run.

## Why it happens

Line numbers are from `nestjs/workflows` at `de469e54a2de3e8a56152df8f8d1906ebb3819ce`.

1. [`workflow-execution.service.ts:1344-1347`](https://github.com/nestjs/workflows/blob/de469e54a2de3e8a56152df8f8d1906ebb3819ce/lib/services/workflow-execution.service.ts#L1344-L1347)
   (`write()`) catches every error from `store.write()`, stores it and
   interrupts the run with `store-error`. It cannot tell a failure that will
   pass from one that will fail again.
2. [`workflow-worker.service.ts:444`](https://github.com/nestjs/workflows/blob/de469e54a2de3e8a56152df8f8d1906ebb3819ce/lib/services/workflow-worker.service.ts#L444)
   logs `Store failed while executing "<id>"; it is retried when its lease expires.`
   The lease expires, a new run starts, and it builds the same value.
3. Nothing checks the text before the write. The in-memory store keeps the
   text, so no test on the default store sees it.

## Versions

`@nestjs/workflows` 0.0.3 · `@nestjs/common` 12.1.2 · `@nestjs/core` 12.1.2 ·
`mysql2` 3.24.5 · `pg` 8.23.1 · MySQL 8.4.11 · PostgreSQL 18.6 ·
`tsx` 4.23.15 · Node 24.19.0

`tsx` does not emit decorator metadata. The workflow classes have no injected
dependencies, and the store factory lists its dependency in `inject`.
