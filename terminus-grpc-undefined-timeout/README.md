# A gRPC health check with `timeout: undefined` answers 500

In `@nestjs/terminus` 12.2.0, `grpc.checkService(key, service, { timeout: undefined })` throws `Timeout: Invalid duration "undefined"`, so the health endpoint answers 500 instead of a health report. This happens when an app reads the timeout from a configuration value that is not set. In 12.1.0, the same call used the default timeout and the endpoint answered 200.

The script starts a gRPC health server that answers `SERVING` and a Nest app with three health routes. Each route calls `grpc.checkService` with other options. The controls pass no options and `{ timeout: 1000 }`.

## Run

```bash
npm install
npm run repro
```

## Output

On Node 26.13.1, macOS:

```
GET /health with a gRPC health check against a server that answers SERVING.

grpc.checkService(..., {}) (control)                     HTTP 200  up
grpc.checkService(..., { timeout: 1000 }) (control)      HTTP 200  up
grpc.checkService(..., { timeout: undefined })           HTTP 500  Internal server error

RESULT: BUG: with { timeout: undefined }, the health endpoint answers 500 instead of using the default timeout.
```

The exit code is 1. With `@nestjs/terminus` 12.1.0, or when the bug is fixed, the last line answers `HTTP 200  up`, the script prints `RESULT: FIXED` and exits with 0.
