# `@nestjs/workflows` MySQL store: a name over the column limit makes the instance re-run forever

On the MySQL store, the store refuses a name that is too long during a run.
The engine treats this as a transient store error. The instance stays `running`
(or `compensating`) and runs again each time its lease expires. The run never
fails, and compensations never run. PostgreSQL finishes the same workflows.

There are three ways to hit it:

1. A child id over 255 characters. The engine builds it as
   `<parent id>/<workflow>#<n>`, so a parent id of 249 characters is enough
   with the workflow `leaf`.
2. A `$compensate:<step>` name over 512 characters. A step name of 501
   characters with a `compensate` function is enough.
3. Any step name over 512 characters.

`client.start()` refuses a user id over 255 characters up front. The
three names above are built or used inside a run, so nothing refuses them
before the run.

## Run it

You need Docker, Node and npm.

```bash
npm install
docker compose up -d --wait
npm run repro
docker compose down -v
```

The `compose.yaml` file starts `mysql:8.4.11` on `127.0.0.1:53307` and
`postgres:18.6` on `127.0.0.1:55437` (the control). The script reads
`MYSQL_URL` and `POSTGRES_URL`. The defaults match the compose file. Each
case creates its own database (MySQL) or schema (PostgreSQL), so the script
does not clean up after itself. Run `docker compose down -v` to remove the
containers and the data.

The script sets `leaseDuration` to `3s`, so the loop shows within 10
seconds. It watches each case for 10 seconds and prints the status each time it
changes, the `runs` counter, and the first `RangeError` that the engine
logged. The whole run takes about 40 seconds.

Node used: v24.19.0
MySQL used: 8.4.11
PostgreSQL used: 18.6

## Output

```
case:    control: short names
db:      mysql
status:  completed@1s
runs:    1  (logged errors: 0)
error:   -

case:    child id 256 chars
db:      mysql
status:  running@1s -> running@4s -> running@7s -> running@10s
runs:    4  (logged errors: 4)
error:   RangeError: MySqlWorkflowStore: an instance id holds at most 255 characters on MySQL, and "pppppppppppppppppppppppppppppppppppppppp…" has 256. The sto...

case:    $compensate: name 513 chars
db:      mysql
status:  compensating@1s -> compensating@4s -> compensating@7s -> compensating@10s
runs:    4  (logged errors: 4)
error:   RangeError: MySqlWorkflowStore: a journal entry's name (a step's, a wait's, or the engine's, such as $child: and a child's id) holds at most 512 chara...

case:    step name 513 chars
db:      mysql
status:  running@1s -> running@4s -> running@7s -> running@10s
runs:    4  (logged errors: 4)
error:   RangeError: MySqlWorkflowStore: a journal entry's name (a step's, a wait's, or the engine's, such as $child: and a child's id) holds at most 512 chara...

case:    child id 256 chars
db:      postgres
status:  completed@1s
runs:    2  (logged errors: 0)
error:   -

case:    $compensate: name 513 chars
db:      postgres
status:  failed@1s
runs:    1  (logged errors: 0)
error:   -

case:    step name 513 chars
db:      postgres
status:  completed@1s
runs:    1  (logged errors: 0)
error:   -

RESULT: BUG: 3 MySQL case(s) re-run until the lease expires again, and the same workflows finish on PostgreSQL
```

The MySQL control with short names completes. The three long names keep the
instance in `running` or `compensating`, and `runs` grows by one every 3
seconds. The engine logs one error for each run. PostgreSQL finishes the same
workflows in one second. The compensating workflow ends as `failed` on
PostgreSQL, which is the `boom` error that the workflow throws.

`client.terminate(id)` frees a stuck instance. It was tested on the child and the
compensation cases. `client.cancel(id)` frees the parent of the child case. On
the compensating instance, `cancel()` returns `accepted: false` and the instance
keeps re-running.

## Why it happens

Line numbers are from `nestjs/workflows` at `c859719445dc00bb22d48aeb291ea305b92e0e75` (version 0.0.2).

1. [`workflow-execution.service.ts:592`](https://github.com/nestjs/workflows/blob/c859719445dc00bb22d48aeb291ea305b92e0e75/lib/services/workflow-execution.service.ts#L592)
   builds the child id as `<parent id>/<workflow>#<n>`. The engine also builds
   the `$compensate:<step>` name
   ([`:418`](https://github.com/nestjs/workflows/blob/c859719445dc00bb22d48aeb291ea305b92e0e75/lib/services/workflow-execution.service.ts#L418)).
2. The MySQL store checks the length of each name before it runs SQL.
   [`key-limits.ts:40`](https://github.com/nestjs/workflows/blob/c859719445dc00bb22d48aeb291ea305b92e0e75/lib/mysql/key-limits.ts#L40) throws a `RangeError`
   that names the field, as the docs say.
3. [`workflow-execution.service.ts:643-647`](https://github.com/nestjs/workflows/blob/c859719445dc00bb22d48aeb291ea305b92e0e75/lib/services/workflow-execution.service.ts#L643-L647)
   (`createChild`) catches every error except `WorkflowIdConflictError`, and
   [`:1311-1314`](https://github.com/nestjs/workflows/blob/c859719445dc00bb22d48aeb291ea305b92e0e75/lib/services/workflow-execution.service.ts#L1311-L1314)
   (`store.write`) catches every error. Both store it and interrupt the run with
   `store-error`.
4. [`workflow-worker.service.ts:442-448`](https://github.com/nestjs/workflows/blob/c859719445dc00bb22d48aeb291ea305b92e0e75/lib/services/workflow-worker.service.ts#L442-L448)
   logs `Store failed while executing "<id>"; it is retried when its lease expires.`
   and returns. The lease expires, another run starts, and the same name fails again.

## Versions

`@nestjs/workflows` 0.0.2 · `@nestjs/common` 12.1.2 · `@nestjs/core` 12.1.2 ·
`mysql2` 3.24.5 · `pg` 8.23.1 · MySQL 8.4.11 · PostgreSQL 18.6 ·
`tsx` 4.23.15 · Node 24

`tsx` does not emit decorator metadata. The workflow classes have no injected
dependencies, and the store factory lists its dependency in `inject`.
