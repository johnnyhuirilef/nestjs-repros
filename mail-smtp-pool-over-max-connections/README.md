# The SMTP pool opens more connections than `maxConnections`

In `@nestjs/mail`, `pool.maxConnections` caps the open SMTP connections:
"Sends beyond it wait for a free connection"
([`smtp-transport-options.interface.ts:63-64`](https://github.com/nestjs/mail/blob/be5327fa7473a782fe344fc28a5ad54d0a1fafb7/lib/interfaces/smtp-transport-options.interface.ts#L63-L64)).

When the server drops a pooled connection while it sits idle, the next send
on it fails on MAIL FROM, and the transport tries once more on a new
connection. If other sends are waiting at that moment, the pool goes over the
cap: one waiting send and the retry both open a connection.

## Run it

```bash
npm install
npm run repro
```

No network or real mail server is needed. `src/fake-smtp-server.ts` is a small
SMTP server on 127.0.0.1 that counts open connections and messages in flight.
Each message takes 150 ms, so messages sent at the same time overlap.

In each scenario, one send leaves a connection idle in the pool. Then 4 sends
start at the same time.

- `the pooled connection stays up (control)`: the server keeps the idle
  connection.
- `the server drops the pooled connection, sends are waiting`: the idle
  connection answers its next MAIL FROM with `421` and closes, as a server
  does after an idle timeout.
- `the same with maxConnections 2`.

## What you should see

Output of `npm run repro` on 0.0.1:

```
=== the pooled connection stays up (control) ===
  maxConnections:          1
  peak open connections:   1
  peak messages in flight: 1
  sent:                    4 of 4
  expected:                at most 1 open, 4 sent

=== the server drops the pooled connection, sends are waiting ===
  maxConnections:          1
  peak open connections:   2
  peak messages in flight: 2
  sent:                    4 of 4
  expected:                at most 1 open, 4 sent

=== the same with maxConnections 2 ===
  maxConnections:          2
  peak open connections:   3
  peak messages in flight: 3
  sent:                    4 of 4
  expected:                at most 2 open, 4 sent

RESULT: BUG: the pool opens more connections than maxConnections.
```

The exit code of `npm run repro` is 1.

With the fix, the pool stays within the cap:

```
=== the pooled connection stays up (control) ===
  maxConnections:          1
  peak open connections:   1
  peak messages in flight: 1
  sent:                    4 of 4
  expected:                at most 1 open, 4 sent

=== the server drops the pooled connection, sends are waiting ===
  maxConnections:          1
  peak open connections:   1
  peak messages in flight: 1
  sent:                    4 of 4
  expected:                at most 1 open, 4 sent

=== the same with maxConnections 2 ===
  maxConnections:          2
  peak open connections:   2
  peak messages in flight: 2
  sent:                    4 of 4
  expected:                at most 2 open, 4 sent

RESULT: FIXED
```

## Why it happens

On a stale connection, `recover()` frees its slot and wakes the first waiting
send, which opens a new connection
([`smtp.transport.ts:236-238`](https://github.com/nestjs/mail/blob/be5327fa7473a782fe344fc28a5ad54d0a1fafb7/lib/smtp/smtp.transport.ts#L236-L238)).
Then the retry calls `acquire(signal, true)`, and `if (this.pool && !fresh)`
skips the cap check
([`smtp.transport.ts:153`](https://github.com/nestjs/mail/blob/be5327fa7473a782fe344fc28a5ad54d0a1fafb7/lib/smtp/smtp.transport.ts#L153)), so it opens
one more connection.

## Versions

`@nestjs/mail` 0.0.1 · `@nestjs/common` 12.2.0 · `@nestjs/core` 12.2.0 ·
Node 24
