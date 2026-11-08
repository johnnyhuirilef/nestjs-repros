# An exception filter that returns an Observable gives the model `{}`

In `@nestjs/ai` 0.0.2, an agent function's exception filter can answer for it: what the filter returns is the function's result. When the filter returns an Observable, the model gets `{}` instead. This is the usual shape of a filter outside HTTP, for example `throwError(() => new ForbiddenException(...))`, or a filter that extends `BaseRpcExceptionFilter`. A filter that returns a plain object, or that throws, works.

The script registers five agent functions that throw, each with a different filter, and calls each one with `callTool()` from `@nestjs/ai/testing`. Then it runs `generateText()` with a fake model that calls the agent function with the `throwError()` filter, and prints what the model read.

## Run

```bash
npm install
npm run repro
```

## Output

On Node 26.13.0, macOS:

```
callTool() with each filter:
  ReturnsObject      resolves {"refunded":false,"reason":"Not your order"}   ok
  Rethrows           rejects Not your order                                  ok
  ReturnsThrowError  resolves {}                                             expected: rejects Not your order...
  RpcFilter          resolves {}                                             expected: rejects...
  ReturnsOf          resolves {}                                             expected: resolves {"refunded":false,"reason":"Not your order"}...

generateText() with the ReturnsThrowError filter:
  The model read: [{"toolName":"ReturnsThrowError","toolCallId":"call-1","output":{}}]

RESULT: BUG: 3 of 5 filters give a result that differs from what the filter answered.
```

The exit code is 1. When the bug is fixed, the script prints `RESULT: FIXED` and exits with 0.
