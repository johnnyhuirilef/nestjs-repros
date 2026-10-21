# A cross-origin magic link sign-in spends the link before it is refused

In `@nestjs/authentication`, `MagicLinkService.consume()` spends the link
first
([`magic-link.service.ts:196`](https://github.com/nestjs/authentication/blob/85fd249f334264f51794c7d768b9c198c4eaaf49/lib/magic-link/magic-link.service.ts#L196)).
Only then does it call `SignInService.signIn()`
([`:224`](https://github.com/nestjs/authentication/blob/85fd249f334264f51794c7d768b9c198c4eaaf49/lib/magic-link/magic-link.service.ts#L224)), which refuses a
request from another origin with `ForbiddenException('Cross-origin sign-in refused')`
([`sign-in.service.ts:47`](https://github.com/nestjs/authentication/blob/85fd249f334264f51794c7d768b9c198c4eaaf49/lib/session/sign-in.service.ts#L47)).

So the refusal comes after the link is gone. When the user opens the same
link again from the app, it does not sign in, and they must ask for a new one.
The repro sends the browser cookie again on each request, so the second open
answers `null`, which the controller turns into a 401.

The same order was fixed for password reset in
[nestjs/authentication#42](https://github.com/nestjs/authentication/pull/42).

## Run it

```bash
npm install
npm run repro
```

No network, database or container is needed. The script uses the in-memory
stores and Supertest. The browser cookie of the link (`bindToBrowser`, on by
default) is sent on every request.

- `the link is opened from the app (control)`: the request comes from
  `http://app.test`, the app's own origin.
- `the link is opened from an untrusted origin first`: the request comes from
  `http://admin.app.test`, for example an admin SPA that is missing from
  `session.trustedOrigins`. Then the same link is opened from the app.

## What you should see

Output of `npm run repro` on 0.1.1:

```
=== the link is opened from the app (control) ===
  open from http://app.test:         200 signed in
  expected:                          200 signed in

=== the link is opened from an untrusted origin first ===
  open from http://admin.app.test:   403 Cross-origin sign-in refused
  then open from http://app.test:    401 Unauthorized
  expected:                          403 first, then 200 signed in

RESULT: BUG: the refused request spent the link.
```

The exit code of `npm run repro` is 1.

With the fix, the second open signs in:

```
=== the link is opened from the app (control) ===
  open from http://app.test:         200 signed in
  expected:                          200 signed in

=== the link is opened from an untrusted origin first ===
  open from http://admin.app.test:   403 Cross-origin sign-in refused
  then open from http://app.test:    200 signed in
  expected:                          403 first, then 200 signed in

RESULT: FIXED
```

## Versions

`@nestjs/authentication` 0.1.1 · `@nestjs/common` 12.2.0 · `@nestjs/core`
12.2.0 · `@nestjs/platform-express` 12.2.0 · Node 24
