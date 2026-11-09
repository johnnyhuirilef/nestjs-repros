# A call's timeout and retry are ignored when a resilience policy is set

In `@nestjs/ai` 0.0.2, a call can set `timeout` and `retry`, and the docs say that the call's settings win over the model's and the module's `defaults`. When the model or the `defaults` set a `resilience` policy, the call's `timeout` and `retry` are ignored with no error or warning.

The script makes each call with `timeout: '200ms'` and `retry: false`, against a model that takes 1.5s to answer. The control has no `resilience`. The other cases use a policy that an app shares with its other calls: a circuit breaker and its own retries from `@nestjs/resilience`.

## Run

```bash
npm install
npm run repro
```

## Output

On Node 26.13.0, macOS:

```
Each call sets timeout: '200ms' and retry: false. The model takes 1.5s.

generateText(), no resilience (control)                    rejected (AiModelError) after ~200 ms
generateText(), the model sets resilience                  resolved after ~1500 ms
generateText(), defaults set resilience                    resolved after ~1500 ms
embed(), embeddingDefaults set resilience                  resolved after ~1500 ms

RESULT: BUG: the call's timeout is ignored in 3 of 4 cases, whenever a resilience policy is set.
```

The exit code is 1. When the bug is fixed, the script prints `RESULT: FIXED` and exits with 0.
