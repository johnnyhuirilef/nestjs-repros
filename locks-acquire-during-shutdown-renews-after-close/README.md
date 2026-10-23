# `@nestjs/locks` gives out a lock during shutdown, and it renews after the store closes

When the app shuts down while an `acquire()` waits for a lock, the release in
`beforeApplicationShutdown()` lets that `acquire()` take the lock. The new
lock keeps renewing after `onApplicationShutdown()`, where the app closes the
store's connection, so each renewal fails and the package logs an error.

## Run it

```bash
npm install
npm run repro
```

No database is needed. The script registers a store that extends
`InMemoryLockStore`. It closes in `onApplicationShutdown()`, and after that
every call fails with `Connection is closed.`, as a call on a closed Redis
client does. The process exits by itself.

Node used: v24.21.0

## What you should see

On `@nestjs/locks` 0.0.4:

```
=== No acquire() waiting (control) ===
  [+   4 ms] a request holds the lock "report"
  [+ 105 ms] app.close()
  [+ 106 ms] the store closes its connection (onApplicationShutdown)
  [+ 106 ms] app.close() resolved
  [+1107 ms] store calls after the close: none

=== An acquire() waiting for the lock ===
  [+   6 ms] a request holds the lock "report"
  [+ 108 ms] app.close()
  [+ 109 ms] the waiting acquire() resolves with a Lock
  [+ 110 ms] the store closes its connection (onApplicationShutdown)
  [+ 110 ms] app.close() resolved
  [+ 313 ms] ERROR logged: Could not renew the lock "report"
  [+ 512 ms] ERROR logged: Could not renew the lock "report"
  [+ 710 ms] WARN logged: Lost the lock "report" (fencing token 2): no renewal reached the store before it expired. Stop writing on its behalf, and fence what it guards with its token.
  [+1111 ms] store calls after the close: renew, renew

RESULT: BUG: after onApplicationShutdown(), the package called the closed store 2 times and logged 2 errors (control: 0 calls, 0 errors).
```

The exit code is 1. Without a waiting `acquire()`, the package does not call
the store after the close.
