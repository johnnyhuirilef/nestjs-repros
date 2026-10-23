# I18nValidationPipe shows the message of the wrong rule when a property has two decorators of the same type

In `@nestjs/i18n`, `i18nValidationMessage()` "points a single constraint at
a key of your choice" ([docs](https://github.com/nestjs/docs.nestjs.com/blob/16740e7b1020d7e14ba58718bb6e31ee7ace6c38/content/application/i18n.md?plain=1#L376)), and `I18nValidationPipe` is "a
drop-in replacement for Nest's `ValidationPipe`" ([docs](https://github.com/nestjs/docs.nestjs.com/blob/16740e7b1020d7e14ba58718bb6e31ee7ace6c38/content/application/i18n.md?plain=1#L338)).

When one property has two decorators of the same type, for example two
`@Matches` with different keys, `I18nValidationPipe` shows the same message
whichever rule failed. Nest's `ValidationPipe` shows the message of the rule
that failed.

## Run it

No network is needed. The script starts an Express app on a free port.

```bash
npm install
npm run repro
```

A `password` field has `@Matches(/\d/)` with the key
`users.passwordDigit`, and `@Matches(/[A-Z]/)` with the key
`users.passwordUppercase`. The script posts two passwords, each failing one
rule only:

- `Abcdefgh` has no digit.
- `abcdefg1` has no uppercase letter.

It runs both with `ValidationPipe` (the control) and with
`I18nValidationPipe`.

## What you should see

Output of `npm run repro`:

```
=== ValidationPipe (control) ===
  "Abcdefgh" -> 400 ["The password needs a digit."]
  "abcdefg1" -> 400 ["The password needs an uppercase letter."]

=== I18nValidationPipe ===
  "Abcdefgh" -> 400 ["The password needs a digit."]
  "abcdefg1" -> 400 ["The password needs a digit."]  <- wrong rule

RESULT: BUG: I18nValidationPipe shows the message of the other rule for 1 of 2 passwords.
```

The exit code of `npm run repro` is 1.

## Why it happens

`I18nValidationPipe` translates each entry of `error.constraints` again,
with the metadata of the decorator that has the same constraint name
([`validation-messages.ts:137-148`](https://github.com/nestjs/i18n/blob/259c0141db996b0332944ffdb430f40ae2ad155c/lib/validation/validation-messages.ts#L137-L148)). It keeps one decorator
for each name in a `Map`
([`:190-198`](https://github.com/nestjs/i18n/blob/259c0141db996b0332944ffdb430f40ae2ad155c/lib/validation/validation-messages.ts#L190-L198)), so for two `@Matches` it uses the same
one for both rules.

## Verifying a fix

With a fix, `I18nValidationPipe` gives the same messages as the control.
The last line is:

```
RESULT: FIXED: I18nValidationPipe shows the message of the rule that failed.
```

The exit code is 0. To test a local build, install the packed
`@nestjs/i18n` with `npm install ./path/to/package.tgz`.

## Versions

`@nestjs/i18n` 0.0.1 · `class-validator` 0.14.4 · `@nestjs/common` 12.2.0 ·
`@nestjs/core` 12.2.0 · `@nestjs/platform-express` 12.2.0 · Node 24
