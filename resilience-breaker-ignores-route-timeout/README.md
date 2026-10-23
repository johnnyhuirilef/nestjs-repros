# A breaker in a service policy does not count the timeouts of a shorter route timeout

In `@nestjs/resilience`, a circuit breaker records "every error ... timeouts
included" ([docs](https://github.com/nestjs/docs.nestjs.com/blob/16740e7b1020d7e14ba58718bb6e31ee7ace6c38/content/reliability/resilience.md?plain=1#L220)). A policy object that runs inside a route
inherits the signal of the route's attempt ([docs](https://github.com/nestjs/docs.nestjs.com/blob/16740e7b1020d7e14ba58718bb6e31ee7ace6c38/content/reliability/resilience.md?plain=1#L216)).

When the route's `@Timeout()` is shorter than the timeout of the policy, the
route's timeout aborts the signal first. The breaker of the policy then
records the call as "ignored", as for a caller that went away. A dependency
that never answers does not open the breaker.

## Run it

No network is needed. The script starts an Express app on a free port.

```bash
npm install
npm run repro
```

A preset `carrier` has a `300ms` timeout and a breaker that opens after 3
calls with 50% failures. A service runs `resilience.preset('carrier')`
around a carrier call that never answers. A route with `@Timeout()` calls
the service. The script sends 5 requests in each scenario:

- Route `@Timeout('1s')`, longer than the preset timeout. This is the
  control.
- Route `@Timeout('100ms')`, shorter than the preset timeout.

## What you should see

Output of `npm run repro`:

```
=== Route @Timeout(1s), longer than the preset timeout (control) ===
  statuses of 5 requests: 504, 504, 504, 503, 503
  breaker "carrier": state=open, calls=3, failures=3

=== Route @Timeout(100ms), shorter than the preset timeout ===
  statuses of 5 requests: 504, 504, 504, 504, 504
  breaker "carrier": state=closed, calls=0, failures=0

RESULT: BUG: with the shorter route timeout, the breaker counts no call and stays closed.
```

The exit code of `npm run repro` is 1.

## Why it happens

The breaker ignores an error when the signal of its execution is aborted
([`circuit-breaker.policy.ts:199-202`](https://github.com/nestjs/resilience/blob/69967728994ff2883de4e18a455c65d7c5e0593b/lib/policies/circuit-breaker.policy.ts#L199-L202)).
That is right when the caller aborts. But the route's timeout aborts the same
signal, with a `ResilienceTimeoutError` as its reason.

## Verifying a fix

With a fix, the breaker opens in both scenarios. The last line is:

```
RESULT: FIXED: the breaker opens in both cases.
```

The exit code is 0. To test a local build, install the packed
`@nestjs/resilience` with `npm install ./path/to/package.tgz`.

## Versions

`@nestjs/resilience` 0.0.2 · `@nestjs/common` 12.2.0 · `@nestjs/core` 12.2.0 ·
`@nestjs/platform-express` 12.2.0 · Node 24
