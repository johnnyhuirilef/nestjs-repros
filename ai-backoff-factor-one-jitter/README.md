# A retry backoff with factor 1 still waits a random time

In `@nestjs/ai` 0.0.2, the `retry` setting of a call takes its options "as `@nestjs/resilience`'s `RetryPolicy` takes them". In `@nestjs/resilience`, the default `jitter` is `full`, or `none` when `factor` is 1, so `factor: 1` waits the same time before each retry. In `@nestjs/ai`, the default `jitter` is always `full`, so `factor: 1` waits a random time between 0 and `delay`.

The script makes a call that fails 3 times with a 503, then answers, with `backoff: { delay: '300ms', factor: 1 }`. It prints the waits between the attempts. The controls are a `RetryPolicy` of `@nestjs/resilience` with the same backoff, and `@nestjs/ai` with `jitter: 'none'` set.

## Run

```bash
npm install
npm run repro
```

## Output

On Node 26.13.1, macOS:

```
A call that fails 3 times with a 503, then answers. backoff: { delay: '300ms', factor: 1 }.

@nestjs/resilience RetryPolicy, factor 1 (control)             waits: 301 ms, 301 ms, 301 ms
@nestjs/ai, factor 1 and jitter: 'none' (control)              waits: 303 ms, 303 ms, 303 ms
@nestjs/ai, factor 1                                           waits: 7 ms, 140 ms, 271 ms

RESULT: BUG: with factor 1, @nestjs/ai waits a random time below 300 ms, while @nestjs/resilience waits 300 ms each time.
```

The waits of the last line change on each run. The exit code is 1. When the bug is fixed, the script prints `RESULT: FIXED` and exits with 0.
