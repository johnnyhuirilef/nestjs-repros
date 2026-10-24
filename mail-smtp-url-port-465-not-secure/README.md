# An smtp:// URL on port 465 does not turn on implicit TLS

In `@nestjs/mail` 0.0.1, the JSDoc of the `secure` option of `SmtpTransport` says: "Default: `true` when the port is 465". With `{ host, port: 465 }` the transport starts with TLS. With `url: 'smtp://host:465'`, or with `url: 'smtp://host'` and `port: 465`, it does not: `parseUrl()` returns `secure: false` for every `smtp://` URL, and that value comes before the default for the port. The client then waits for an SMTP greeting, and a server on port 465 waits for a TLS handshake.

The script starts a TCP server on port 465 that never answers. It only records what the client sends first: a TLS ClientHello (first byte `0x16`), or nothing. Every `verify()` call ends with `MailTimeoutError`, because the server never answers. The timeouts are 1 second here, so the script ends quickly.

## Run

```bash
npm install
npm run repro
```

macOS lets a normal user listen on a port under 1024 only on the wildcard address, so the server listens on `0.0.0.0:465` while the script runs. On Linux, run it as root.

## Output

On Node 24.21.0, macOS:

```
=== { host: '127.0.0.1', port: 465 } (control) ===
  the client sends first: TLS ClientHello (implicit TLS)
  verify(): MailTimeoutError

=== url 'smtps://127.0.0.1:465' (control) ===
  the client sends first: TLS ClientHello (implicit TLS)
  verify(): MailTimeoutError

=== url 'smtp://127.0.0.1:465' ===
  the client sends first: nothing: waits for the SMTP greeting
  verify(): MailTimeoutError

=== url 'smtp://127.0.0.1' with port: 465 ===
  the client sends first: nothing: waits for the SMTP greeting
  verify(): MailTimeoutError

RESULT: BUG: with a url, port 465 does not turn on implicit TLS (smtpUrl, urlAndPort).
```

The exit code is 1 while a URL on port 465 does not start with TLS, and 0 when it does.
