# `@nestjs/locks` ignores `signal` and `wait` while the store call is pending

`Locks.acquire()` and `Locks.withLock()` check `signal` only before the first
store call and between retries. They do not stop a store call that is already
running. If the store never answers, `acquire()` stays pending after the signal
aborts and after `wait` ends. If the store answers late, `withLock()` still runs
`fn` after the signal aborted.

A store call can be slow when the connection pool is exhausted, when a Redis
client keeps commands in an offline queue, or during a database failover
(nestjs/locks#14 and nestjs/idempotency#17 describe these cases). The
package ships only `InMemoryLockStore`, which answers at once. This repro uses a
fake store that delegates to it and delays or never answers `acquire`.

## Run it

```bash
npm install
npm run repro
```

No network, database, or container is needed. Each case stops waiting after
1500 ms, so the script always ends. It calls `process.exit(0)` at the end
because the hung calls never settle.

Node used: v24.19.0

## What you should see

Timings vary slightly from run to run. The shape is the same.

```
control      normal store, wait 300ms: resolved with a Lock after 0 ms
signal       hung store, abort at 200 ms: still pending after 1500 ms
wait         hung store, wait 300ms: still pending after 1500 ms
withLock     store answers after 800 ms, abort at 200 ms: resolved with the result of fn after 803 ms
             fn ran: true, signal.aborted inside fn: true
shutdown     hung store, plain acquire in flight: app.close() finished after 1 ms
shutdown     hung store, @OnOneInstance tick in flight: app.close() still pending after 1500 ms

RESULT: BUG (and shutdown hangs)
```

The last two cases use the hung store. The tick case runs in its own
application context. It calls a method with `@OnOneInstance()` by hand, waits
100 ms, then closes the app.

`RESULT: OK` means `acquire()` rejected on abort and did not wait past `wait`,
and `fn` did not run after the abort. `RESULT: INCONCLUSIVE` means the control
case did not resolve.

## Why it happens

At nestjs/locks master `3e610cb`, in `lib/locks.service.ts`:

- Line 78 calls `signal?.throwIfAborted()` once, before the first attempt.
- Line 92 calls it again, between attempts.
- Line 158 is `const result = await store.acquire(key, owner, ttl);`. Nothing
  races this await against `signal` or against `wait`.

So an abort during the store call has no effect until the store answers. If the
store never answers, `acquire()` never settles. `withLock()` calls `acquire()`
and then runs `fn`, so a late answer starts `fn` with an aborted signal.

Shutdown has the same problem for jobs. The scheduled-jobs service waits for
every running job in `onModuleDestroy`, at `lib/services/scheduled-jobs.service.ts:131`
(`await Promise.allSettled(this.pending);`). A job that waits on a hung store
never settles, so `app.close()` never ends.

The option is documented as stopping the wait. `lib/interfaces/lock-options.interface.ts:16`:

```ts
/** Stops waiting: `acquire()` rejects with the signal's reason. */
signal?: AbortSignal;
```

The docs say the same: "`signal` stops the waiting"
(https://docs.nestjs.com/reliability/locks).
