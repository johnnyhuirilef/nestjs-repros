# A message header does not override a default header in another letter case

In `@nestjs/mail` 0.0.1, the `headers` option of `MailModule` says: "Headers added to every message (a message's own headers win)". That works when the message uses the same letter case as the default. With the default `X-Campaign` and a message header `x-campaign`, `send()` fails with "is set twice". The same happens with a mail class, when a `send()` header differs only in letter case from a `render()` header. The headers are merged with an object spread, which keeps both names, and the check after it compares them in lowercase.

The script starts a `MailModule` with `headers: { 'X-Campaign': 'default' }` and an `InMemoryMailTransport`. It sends three mails and prints the headers that the transport received, or the error.

## Run

```bash
npm install
npm run repro
```

## Output

On Node 24.21.0, macOS:

```
=== default 'X-Campaign', message 'X-Campaign' (control) ===
  sent with headers: {"X-Campaign":"spring"}

=== default 'X-Campaign', message 'x-campaign' ===
  MailMessageError: Invalid mail: headers.x-campaign is set twice (header names are case-insensitive)

=== mail class: render() 'X-Campaign', send() 'x-campaign' ===
  MailMessageError: Invalid mail: headers.x-campaign is set twice (header names are case-insensitive)

RESULT: BUG: a header that differs only in letter case does not win over the default (otherCase, mailClass).
```

The exit code is 1 while a header in another letter case fails, and 0 when the message header wins in every case.
