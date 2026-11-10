# A `@Can()` on a federation `@ResolveReference()` is not enforced, and startup does not report it

In `@nestjs/authorization` 0.1.3, the startup check fails when a `@Can()` sits on a `@ResolveField()` that GraphQL runs without guards. It does not do the same for a `@ResolveReference()`. GraphQL also runs a reference resolver without guards unless `fieldResolverEnhancers` includes `'guards'`. So the app starts, and an `_entities` query runs the reference resolver for a caller that the policy denies.

The script starts an Apollo federation subgraph with default GraphQL options. One resolver class has a `@Query()` and a `@ResolveReference()`, both with `@Can(UserPolicy, 'view')`. `UserPolicy.view` allows only admins, and the requests send no user. The `@Query()` is the control.

## Run

```bash
npm install
npm run repro
```

## Output

On Node 26.13.0, macOS:

```
No user is signed in. UserPolicy.view allows only admins. Both resolvers have @Can(UserPolicy, 'view').

Startup: no error.

@Query user (control)
  data: {"user":null}
  errors: ["Unauthorized (UNAUTHENTICATED)"]
  resolver ran: 0

@ResolveReference, through _entities
  data: {"_entities":[{"id":"7","secret":"secret of user 7"}]}
  errors: []
  resolver ran: 1

RESULT: BUG: the @Can() on the @ResolveReference() is not enforced, and startup does not report it.
```

The exit code is 1. When the startup check reports the `@Can()` on the `@ResolveReference()`, the script prints `RESULT: FIXED` and exits with 0.
