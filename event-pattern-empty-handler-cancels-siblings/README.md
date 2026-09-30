# An `@EventPattern` handler that completes without emitting cancels the other handlers of the same pattern

The docs say that several event handlers can share one pattern and that Nest
"triggers all of them in parallel". Nest chains such handlers and joins their
results with `forkJoin`:

```ts
// packages/microservices/listeners-controller.ts
return forkJoin({
  current: this.transformToObservable(currentReturnValue),
  next: this.transformToObservable(returnedValueWrapper),
});
```

`forkJoin` completes without emitting as soon as one of its sources completes
without a value, and it unsubscribes from the sources that are still running.
A handler that returns an Observable which completes empty (`EMPTY`, `of()`,
`ignoreElements()`, or a `filter` that drops the value) therefore cancels every
other handler of that pattern that has not finished yet. There is no log and no
error.

A handler that returns a cold Observable is the one that gets cancelled: it
only starts when the join subscribes, and the join is gone before its timer
fires. `async` handlers are not affected, because Nest starts them eagerly.

## Run it

No broker is needed, the transport is TCP. The script registers two handlers
for `order.created`:

- `notifyPriorityDesk` filters out orders that are not `priority`, so it
  completes empty for those.
- `reserveStock` returns `timer(50).pipe(tap(...))`, a cold Observable that
  records a side effect when the timer fires.

It emits one non-priority order (the first handler completes empty) and one
priority order (baseline, the first handler emits), and prints whether
`reserveStock` ran for each:

```bash
npm install
npm run repro
```

Set `PORT` (default `3010`) to use another port.

## What you should see

Output of `NO_COLOR=1 npm run repro`, with the pid and timestamps removed:

```
[Nest] LOG [NestFactory] Starting Nest application...
[Nest] LOG [InstanceLoader] AppModule dependencies initialized
[Nest] LOG [NestMicroservice] Nest microservice successfully started
=== order 1 (first handler completes empty) ===
  expected: reserveStock runs its side effect
  actual:   side effect never ran

=== order 2 (baseline, first handler emits) ===
  expected: reserveStock runs its side effect
  actual:   side effect ran

=== RESULT ===
  BUG: reserveStock was cancelled for 1 of 2 orders.
```

The baseline shows that both handlers work and that the client delivers the
event: only the order for which the first handler completes empty loses the
second handler's work. The exit code of `npm run repro` is 1.

## Verifying a fix

The script reports the outcome itself, thus it shows the result on any
version. With an empty handler no longer ending the join early:

```
=== order 1 (first handler completes empty) ===
  expected: reserveStock runs its side effect
  actual:   side effect ran
...
=== RESULT ===
  FIXED: every handler ran, whether or not another handler emitted.
```

## Versions

`@nestjs/common` 12.1.2 · `@nestjs/core` 12.1.2 · `@nestjs/microservices` 12.1.2 ·
`rxjs` 7.8.2 · Node 24
