# `@nestjs/authentication` answers 403 after `reset()` has already changed the password

`PasswordResetService.reset(token, password, { signIn: true })` first changes
the password and spends the reset link. Only then does it sign the user in.
The sign-in step refuses a request from an origin that is not in
`session.trustedOrigins`. The client gets a 403, but the new password is
already stored and the link is already used. A retry with the same link
returns `null`.

The same request with `signIn: false` from the same untrusted origin gets a 200.
The Fastify adapter behaves the same way. This repro uses Express only.

## Run it

```bash
npm install
npm run repro
```

No network is needed after `npm install`. The script starts one Nest app on
`127.0.0.1` with a free port. It keeps one user and the reset mails in memory.
It sends three requests to `POST /reset`, each with a fresh reset link. The
process exits by itself with code 0.

Node used: v24.19.0

## What you should see

```
--- case 1: control, trusted origin, signIn true ---
POST /reset:   200 {"ok":true,"signedIn":true}

--- case 2: untrusted origin, signIn true ---
POST /reset:   403 {"message":"Cross-origin sign-in refused","error":"Forbidden","statusCode":403}
new password works: true
old password works: false
retry, trusted: 200 {"ok":false,"signedIn":false}
link spent:         true

--- case 3: untrusted origin, signIn false ---
POST /reset:   200 {"ok":true,"signedIn":false}

RESULT: BUG
```

`RESULT: OK` means the 403 did not come with a changed password and a spent
link.

## Why it happens

`reset()` does its work in this order. The code is in
`lib/account/password-reset.service.ts` at nestjs/authentication master
`ba8eb68`:

- line 105: `consumeEmailToken(...)` spends the link.
- line 125: `handler.updatePassword(...)` stores the new password.
- line 132: `this.signInService.signIn(...)` signs the user in.

`signIn()` checks the origin on its first lines
(`lib/session/sign-in.service.ts:47`, which calls `refuseCrossOrigin`). The
check throws `ForbiddenException('Cross-origin sign-in refused')` at
`lib/session/sign-in.service.ts:197`. By then the password and the link have
changed, so the 403 does not undo them.

`reset()` itself does not check the origin. `enableCsrfProtection()` refuses
cross-origin writes to every route. The repro does not enable it, so case 3
gets a 200.

`MagicLinkService.create()` has the right order. It calls
`this.signIn.refuseCrossOrigin(...)` at
`lib/magic-link/magic-link.service.ts:94`, before it stores or sends anything.
A refused request leaves no side effects.

The refusal itself is correct, because it prevents login CSRF (a foreign page
signing a victim in to an account the page controls). Only its timing is the
problem. `reset()` can run the same check before line 105 when `signIn` is
true.
