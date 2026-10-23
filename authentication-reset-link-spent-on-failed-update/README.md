# A password reset link is spent when reset() fails before the password is stored

In `@nestjs/authentication`, `PasswordResetService.reset()` consumes the
token before it runs four steps: `findUser()` and `updatePassword()` of
your `PasswordResetHandler`, `hasher.hash()` and `revokeSignIns()`. If one
of them throws, the password stays as it was, but the link is spent: a
retry with the same link returns `null`. The customer has to ask for a new
email.

## Run it

No database or network is needed. The script uses the in-memory stores,
and a handler whose `findUser()` or `updatePassword()` can throw once, as a
database that is briefly unavailable. It makes `hasher.hash()` and
`revokeSignIns()` throw once by replacing them on the instance.

```bash
npm install
npm run repro
```

The script asks for a reset link and uses it, first with a handler that
works (the control). Then it makes each step throw once. After each
failure, it tries the same link again.

## Output

With `@nestjs/authentication` 0.1.1:

```
=== The handler works (control) ===
  reset with the link:          result for u1
  password in the database:     new

=== findUser() fails once ===
  reset with the link:          throws: the database is briefly unavailable
  retry with the same link:     null
  password in the database:     old

=== hash() fails once ===
  reset with the link:          throws: hash() failed
  retry with the same link:     null
  password in the database:     old

=== revokeSignIns() fails once ===
  reset with the link:          throws: revokeSignIns() failed
  retry with the same link:     null
  password in the database:     old

=== updatePassword() fails once ===
  reset with the link:          throws: the database is briefly unavailable
  retry with the same link:     null
  password in the database:     old

RESULT: SPENT: in 4 of 4 cases, after one failed step, the same link no longer resets the password.
```

The exit code is 1. It is 0 when the retry with the same link sets the new
password.
