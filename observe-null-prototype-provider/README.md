# `@nestjs/observe` throws on a provider that has no `constructor`

When you turn on `ObserveInstrument`, a method call on a provider without a
`constructor` throws `TypeError: Cannot read properties of undefined (reading
'name')`. An ESM module namespace (`import * as greetings from './greetings.js'`)
is such a provider. The same call works without instrumentation. In a route, the
error becomes an HTTP 500.

## Run it

```bash
npm install
npm run repro
```

No network is needed after `npm install`. The script starts a local HTTP collector on `127.0.0.1`
for the Observe exporter. It starts the app twice on a free port: first without
`instrument`, then with `ObserveInstrument`. Each time it requests `GET /greet`.
The process exits by itself.

Node used: v24.19.0

## What you should see

```
--- control: no instrument option ---
HTTP status:   200
HTTP body:     Hello, Ana!
logged errors: 0
first error:   none

--- with instrument: ObserveInstrument ---
HTTP status:   500
HTTP body:     {"statusCode":500,"message":"Internal server error"}
logged errors: 1
first error:   Cannot read properties of undefined (reading 'name')

RESULT: BUG
```

`RESULT: OK` means both runs answered 200. `RESULT: INCONCLUSIVE` means the
control run did not answer 200.

## Why it happens

An ESM namespace object has a null prototype, so it has no `constructor`.
The Proxy get trap in `@nestjs/observe` reads `target.constructor.name` for every
method call. That line is `src/instrument/create-instance-decorator.instrument.ts:271`
at nestjs/observe HEAD `028ee72`. The helper `generateSpanId` reads
`instance.constructor.name` in the same way, at line 570 of the same file.
`constructor` is `undefined`, so `.name` throws.

## Workaround

Tell Observe to skip that provider. This option is in `createObserveModule`:

```ts
createObserveModule({
  skipInstrumentation: (instance) => instance === greetings,
});
```

I ran the repro with this option. Both runs answered 200 and the result was `OK`.
