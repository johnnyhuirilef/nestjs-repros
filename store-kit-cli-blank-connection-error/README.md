# The store CLI prints an empty line when it cannot connect to localhost

In `@nestjs/store-kit` 0.1.1, `runStoreCli()` prints `error?.message ?? error` when `migrate` or `status` fails. A connection to `localhost` that fails on both `::1` and `127.0.0.1` rejects with an `AggregateError` whose `message` is empty, so the command prints only an empty line.

The script runs the real `nest-outbox` command of `@nestjs/outbox` 0.1.3 (which calls `runStoreCli()`) against port 1, where nothing listens: first with `127.0.0.1` as the control, then with `localhost`.

## Run

```bash
npm install
npm run repro
```

## Output

On Node 24.21.0, macOS:

```
=== 127.0.0.1, nothing listens (control) ===
  npx @nestjs/outbox status --url postgres://user:pass@127.0.0.1:1/app
  exit code: 1
  stderr:    "connect ECONNREFUSED 127.0.0.1:1\n"

=== localhost, nothing listens ===
  npx @nestjs/outbox status --url postgres://user:pass@localhost:1/app
  exit code: 1
  stderr:    "\n"

RESULT: BUG: with localhost, the CLI exits 1 and prints an empty line instead of the connection error.
```

The exit code is 1 while the bug is present, and 0 when the CLI prints the connection error for `localhost` too.
