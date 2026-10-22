# `@nestjs/workflows` result waits run past their timeout while a store read is in flight

`result()` and `startAndWait()` take a `timeout` and a `signal`. When the
store is slow to answer, both are ignored until the store read returns. With a
store read of 3 s, a wait with a limit of 200 ms rejects after about 3 s.

## Run it

```bash
npm install
npm run repro
```

No database is needed. The script registers a store that extends
`InMemoryWorkflowStore`, and its `get()` waits a set time before it answers.
A workflow sleeps for 1 hour, so a wait can end only by its `timeout` or its
`signal`. The module runs with `worker: false`. The process exits by itself.

Node used: v24.21.0

## What you should see

On `@nestjs/workflows` 0.0.3:

```
=== store.get() takes 0 ms ===
  result(), timeout 200 ms           rejected with WorkflowResultTimeoutError, after 202 ms
  result(), signal aborts at 200 ms  rejected with TimeoutError, after 204 ms
  startAndWait(), timeout 200 ms     rejected with WorkflowResultTimeoutError, after 203 ms

=== store.get() takes 3000 ms ===
  result(), timeout 200 ms           rejected with WorkflowResultTimeoutError, after 3002 ms
  result(), signal aborts at 200 ms  rejected with TimeoutError, after 3002 ms
  startAndWait(), timeout 200 ms     rejected with WorkflowResultTimeoutError, after 3001 ms

RESULT: BUG: 3 waits ended more than 1 s after their 200 ms limit.
```

The exit code is 1. With a fast store, every wait ends near 200 ms. With a
slow store, every wait ends when the read returns.
