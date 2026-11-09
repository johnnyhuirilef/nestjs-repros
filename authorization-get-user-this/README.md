# A getUser method that uses `this` fails with 500 when the options come from a useClass factory

In `@nestjs/authorization` 0.1.3, the guard calls `getUser` without its object. A `forRootAsync({ useClass })` factory that returns itself, with a `getUser` method that uses `this`, then fails with `TypeError: Cannot read properties of undefined`, and every route with `@Can()` answers 500.

The script starts an Express app with one `@Can(PostPolicy, 'create')` route, twice. Both cases give the user `alice`, who is a writer, and `PostPolicy.create` allows writers. The control returns a `getUser` arrow function from a `useFactory`. The other case uses a `useClass` that returns itself, with a `getUser` method that reads `this.user`.

## Run

```bash
npm install
npm run repro
```

## Output

On Node 26.13.0, macOS:

```
Both cases give the user alice (a writer). PostPolicy.create allows writers.

getUser arrow function, useFactory (control)         GET /posts -> 200 ["ok"]
getUser method, useClass that returns this           GET /posts -> 500 {"statusCode":500,"message":"Internal server error"}
  error: TypeError: Cannot read properties of undefined (reading 'user')

RESULT: BUG: the guard calls getUser without its object, so a getUser method that uses `this` fails with 500.
```

The exit code is 1. When the bug is fixed, the script prints `RESULT: FIXED` and exits with 0.
