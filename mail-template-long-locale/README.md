# FileTemplateEngine accepts a very long locale

In `@nestjs/mail` 0.0.1, `FileTemplateEngine` checks the shape of each subtag of the locale, but not the length of the locale. A long locale such as `a-a-a-...` passes the check and reaches the file system. With 1001 characters, `send()` fails with `ENAMETOOLONG` instead of `MailTemplateError`. With 100,001 characters, it blocks the event loop for about 700 ms. Every file name that the engine tries stays in its cache, also when the file does not exist, so many different long locales grow the cache.

The script starts a `MailModule` with a `FileTemplateEngine` on `templates/` and an `InMemoryMailTransport`. It sends template mails with long locales, and prints the error, the longest gap between two ticks of a 1 ms timer, and the entries that the engine's private file cache gained.

## Run

```bash
npm install
npm run repro
```

## Output

On Node 24.21.0, macOS:

```
=== locale 'pl' (control) ===
  sent: <p>Czesc</p>

=== locale of 1001 characters ===
  Error (ENAMETOOLONG)
  the message has the absolute path of the templates directory: yes

=== locale of 100001 characters ===
  send() took 695 ms, longest event loop delay 675 ms

=== 3000 mails, each with its own locale of 241 characters ===
  cache entries added: 714001, heap growth after gc: 147.1 MB

=== 3000 mails, each with its own locale of 35 characters ===
  cache entries added: 96000, heap growth after gc: 15.2 MB

RESULT: BUG: a long locale that passes the check reaches the file system (raw ENAMETOOLONG, event loop blocked, cache grows).
```

The exit code is 1 while a long locale reaches the file system, and 0 when it is refused before any file lookup. The last case is printed for information: those locales have 35 characters, and they grow the cache too.
