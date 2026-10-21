# A step timeout longer than about 24.8 days fails every attempt at once

In `@nestjs/workflows`, a step can take a `timeout` and a `heartbeatTimeout`.
`parseDuration` accepts any non-negative duration
([`duration.ts:31`](https://github.com/nestjs/workflows/blob/25e82f42aa8fe081e60636f7d9b9af510f1dd74e/lib/core/time/duration.ts#L31)),
and both step timers pass it straight to `setTimeout`
([`workflow-execution.service.ts:1037`](https://github.com/nestjs/workflows/blob/25e82f42aa8fe081e60636f7d9b9af510f1dd74e/lib/services/workflow-execution.service.ts#L1037),
[`:1044`](https://github.com/nestjs/workflows/blob/25e82f42aa8fe081e60636f7d9b9af510f1dd74e/lib/services/workflow-execution.service.ts#L1044)).

Node runs a timer longer than 2^31 - 1 ms (about 24.8 days) after 1 ms
instead, and prints a `TimeoutOverflowWarning`. So a step with
`timeout: '30d'` or `heartbeatTimeout: '30d'` fails each attempt at once.

## Run it

```bash
npm install
npm run repro
```

No database or network is needed. The script uses the in-memory store and a
`ManualWorkflowClock`, and runs the worker by hand with `drain()`. It moves the
clock to each retry until the run ends.

In each scenario, one workflow runs one step that takes 200 ms:

- `timeout: '24d' (control)`: a timeout below the limit.
- `timeout: '30d'`: a timeout above the limit.
- `heartbeatTimeout: '30d'`: a heartbeat timeout above the limit.

## What you should see

Output of `npm run repro` with `@nestjs/workflows` 0.0.3:

```
=== timeout: '24d' (control) ===
  first attempt ended after: 208 ms
  outcome:                   completed after 1 run
  expected:                  completed after 1 run

=== timeout: '30d' ===
  first attempt ended after: 3 ms
  outcome:                   failed after 3 runs
  error:                     Step "build" failed after 3 attempt(s): StepTimeoutError: Step "build" timed out after 2592000000ms.
  warning:                   TimeoutOverflowWarning: 2592000000 does not fit into a 32-bit signed integer.
  expected:                  completed after 1 run

=== heartbeatTimeout: '30d' ===
  first attempt ended after: 2 ms
  outcome:                   failed after 3 runs
  error:                     Step "build" failed after 3 attempt(s): StepTimeoutError: Step "build" sent no heartbeat for 2592000000ms.
  warning:                   TimeoutOverflowWarning: 2592000000 does not fit into a 32-bit signed integer.
  expected:                  completed after 1 run

RESULT: BUG: 2 of 3 steps fail at once instead of running for 200 ms.
```

The step function runs once for each attempt of the default retry, so it runs
3 times. The error says that the step timed out after 30 days. The exit code
of `npm run repro` is 1.

With the step timers capped at 2^31 - 1 ms, every step completes:

```
=== timeout: '24d' (control) ===
  first attempt ended after: 209 ms
  outcome:                   completed after 1 run
  expected:                  completed after 1 run

=== timeout: '30d' ===
  first attempt ended after: 203 ms
  outcome:                   completed after 1 run
  expected:                  completed after 1 run

=== heartbeatTimeout: '30d' ===
  first attempt ended after: 202 ms
  outcome:                   completed after 1 run
  expected:                  completed after 1 run

RESULT: FIXED: every step completes.
```

## Versions

`@nestjs/workflows` 0.0.3 · `@nestjs/common` 12.2.0 · `@nestjs/core` 12.2.0 ·
Node 24
