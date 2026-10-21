# Subclasses share the lock key of an inherited `@WithoutOverlapping()` method

In `@nestjs/locks`, the default key of a job is `ClassName.methodName`, and
"Two jobs with the same default key fail at startup"
([docs](https://docs.nestjs.com/reliability/locks)).

When `@WithoutOverlapping()` is on a method of a base class, every subclass
uses the key of the base class. Startup does not fail. When two subclasses run
at the same time, one run is skipped, and only a debug line says so.

## Run it

```bash
npm install
npm run repro
```

No network, database or container is needed. The script uses the in-memory
lock store. Each scenario starts its own application context and calls the
decorated methods at the same time, like two scheduled ticks.

- `two unrelated classes, run at the same time (control)`: `InvoiceSync` and
  `EmailSync` each have their own `@WithoutOverlapping()` method.
- `two classes with the same default key`: two separate classes are both
  named `Cleanup`, so both use the key `Cleanup.run`.
- `two subclasses of one base class, run at the same time`: `SalesReport` and
  `StockReport` extend `ReportJob`, whose `run()` has `@WithoutOverlapping()`.

## What you should see

Output of `npm run repro`:

```
=== two unrelated classes, run at the same time (control) ===
  startup:   ok
  runs:      ["InvoiceSync ran","EmailSync ran"]
  expected:  both run

=== two classes with the same default key ===
  startup:   fails: LocksModule: Cleanup.run and Cleanup.run both use the lock key "Cleanup.run". Two jobs share a key only when both set it on purpose (to exclude each other); set `key` on @WithoutOverlapping() to tell them apart.
  expected:  startup fails

=== two subclasses of one base class, run at the same time ===
  startup:   ok
  runs:      ["SalesReport ran",null]
  debug log: Skipped ReportJob.run: a run is still in progress
  expected:  both run, or startup fails as in the case above

RESULT: BUG: one subclass run is skipped, and startup does not fail.
```

The exit code of `npm run repro` is 1.

## Why it happens

The decorator builds one job definition when it wraps the method, and takes
the key from the class that declares the method
([`job-decorator.util.ts:63-68`](https://github.com/nestjs/locks/blob/ece85fc2fd4ec8f16b309ec64579d00d5708c242/lib/utils/job-decorator.util.ts#L63-L68)).
All subclasses share that definition.

At startup, the check for a shared key throws only when the two jobs have
different definitions
([`scheduled-jobs.service.ts:108-116`](https://github.com/nestjs/locks/blob/ece85fc2fd4ec8f16b309ec64579d00d5708c242/lib/services/scheduled-jobs.service.ts#L108-L116)).
The two subclasses have the same definition, so the check does not throw.

## Versions

`@nestjs/locks` 0.0.4 · `@nestjs/common` 12.2.0 · `@nestjs/core` 12.2.0 ·
Node 24
