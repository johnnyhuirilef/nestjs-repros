# A GraphQL error with `httpStatus: 504` is stored and replayed

In `@nestjs/idempotency` 0.0.4, a `GraphQLError` with a 5xx in `extensions.httpStatus` is stored as a 400. A retry with the same key gets the stored error, and the mutation does not run again. `@nestjs/resilience` sends its timeout, circuit and bulkhead errors in this shape. Over HTTP, the same 504 releases the key.

The script starts a Nest app with a payment as `POST /pay` and as a `pay` mutation, both with `@Idempotent()` and `@Timeout(50)`. The dependency takes 300 ms on the first call and answers at once after that. `POST /pay` is the control.

## Run

```bash
npm install
npm run repro
```

## Output

On Node 26.13.1, macOS:

```
A payment with @Idempotent() and @Timeout(50). The first call times out, then the dependency is healthy.

POST /pay (control), 1st call            HTTP 504  The operation timed out
mutation pay, 1st call                   error: TIMEOUT (httpStatus 504)
POST /pay (control), retry, same key     HTTP 201  paid
mutation pay, retry, same key            error: TIMEOUT (httpStatus 504)

Handler runs: POST /pay 2, mutation pay 1

RESULT: BUG: the GraphQL TIMEOUT (504) is stored and replayed, so the retry with the same key does not run the mutation.
```

The exit code is 1. When the bug is fixed, the last mutation line answers `data: paid`, the script prints `RESULT: FIXED` and exits with 0.
