# A message whose publish kills the relay process is never dead-lettered

In `@nestjs/outbox` 0.1.4, the relay counts an attempt only when a publish returns an error. When the publish kills the process, for example with an OOM kill, the message stays at `attempts: 0`. Its lease expires and the next relay claims it again, so it is never dead-lettered, and the next message with the same `key` is never published.

The script stores two messages with the key `order-1` in a PGlite database on disk, with `PostgresOutboxStore`. Then it runs `OutboxRelay.runOnce()` five times, each in a new process, with `retry.attempts: 3` and a lease of 300 ms. The transport fails on the first message. In the control, it throws. In the second case, it calls `process.exit(137)`, which stands in for an OOM kill.

## Run

```bash
npm install
npm run repro
```

## Output

On Node 26.13.1, macOS:

```
Two messages with key "order-1", retry.attempts 3, 5 relay runs.

publish of "first" throws (control):
  relay run 1: exit 0, pending: first (attempts 1), second (attempts 0), dead letters: none
  relay run 2: exit 0, pending: first (attempts 2), second (attempts 0), dead letters: none
  relay run 3: exit 0, pending: none, dead letters: first
  relay run 4: exit 0, pending: none, dead letters: first
  relay run 5: exit 0, pending: none, dead letters: first

publish of "first" kills the process (exit 137):
  relay run 1: exit 137, pending: first (attempts 0), second (attempts 0), dead letters: none
  relay run 2: exit 137, pending: first (attempts 0), second (attempts 0), dead letters: none
  relay run 3: exit 137, pending: first (attempts 0), second (attempts 0), dead letters: none
  relay run 4: exit 137, pending: first (attempts 0), second (attempts 0), dead letters: none
  relay run 5: exit 137, pending: first (attempts 0), second (attempts 0), dead letters: none

RESULT: BUG: a message whose publish kills the process never uses up its attempts, is never dead-lettered, and "second" is never published.
```

The exit code is 1. When the bug is fixed, the second case dead-letters `first` like the control, the script prints `RESULT: FIXED` and exits with 0.
