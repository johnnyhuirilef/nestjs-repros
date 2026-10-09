# `@nestjs/observe` drops the extra members of a returned Promise

When you turn on `ObserveInstrument`, a provider method that returns a Promise
with extra members gives the caller a different Promise. The extra
members are gone. `got` returns a Promise with `.json()`, `.text()` and `.buffer()`.
`p-cancelable` returns a Promise with `.cancel()`. With instrumentation,
`await svc.fetchJson().json()` throws `TypeError: ... .json is not a function`
and `.cancel` is `undefined`. Without instrumentation both work.

## Run it

```bash
npm install
npm run repro
```

No network is needed after `npm install`. The script starts two servers on
`127.0.0.1`: a local collector for the Observe exporter and a small JSON server
that answers `{"a":1}`. It starts the app twice on a free port: first without
`instrument`, then with `ObserveInstrument`. Each time it requests `GET /data`
and `GET /cancel`. The process exits by itself with code 0.

Node used: v24.19.0

## What you should see

```
--- control: no instrument option ---
GET /data:     200 {"a":1}
GET /cancel:   200 {"cancelExists":true,"ending":"rejected: CancelError"}
logged errors: 0
first error:   none

--- with instrument: ObserveInstrument ---
GET /data:     500 {"statusCode":500,"message":"Internal server error"}
GET /cancel:   200 {"cancelExists":false,"ending":"finished"}
logged errors: 1
first error:   this.data.fetchJson(...).json is not a function

RESULT: BUG
```

`RESULT: OK` means both runs work. `RESULT: INCONCLUSIVE` means the control run
does not work.

## Why it happens

When a method returns a `Promise`, the instrumented wrapper returns a new
chain. It does not return the original Promise. The code is in
`src/instrument/create-instance-decorator.instrument.ts:148-150` at
nestjs/observe HEAD `028ee72`:

```ts
if (result instanceof Promise) {
  return result.then(onReturnValue).catch(onError);
}
```

`.then().catch()` always makes a new Promise. The extra members of the
original, such as `.json()` or `.cancel()`, stay on the original object.

This affects a Promise that carries its own members on the instance, like `got`
and `p-cancelable`. A plain `class X extends Promise` keeps its type, so this
repro does not claim that all Promise subclasses break. Thenables that are not
a `Promise` skip this branch, so they are not affected.

The same repository already solves this problem for outgoing calls.
`endWhenSettled` in `src/outgoing/outgoing-span.recorder.ts:104-127` ends the
span when the result settles and returns the original result. Its comment says:

> Ends `span` when `result` settles, and hands `result` back untouched - the
> caller's own chain must see the same value and the same rejection it
> would have without the span.

The instrument wrapper does not follow this rule for a returned `Promise`.

Until a release has the fix, `createObserveModule({ skipInstrumentation: (instance) => instance instanceof DataService })` keeps such a provider working.
