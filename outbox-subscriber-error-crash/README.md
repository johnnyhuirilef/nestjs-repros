# An OutboxEvents subscriber that throws crashes the process

In `@nestjs/outbox`, the relay wraps each event in a try/catch, so an error in
a subscriber is logged as "Outbox event subscriber threw" and delivery goes
on
([`outbox-relay.service.ts:469-475`](https://github.com/nestjs/outbox/blob/bc84a1902e87cc3e8d3f17975f5a83cd4f640356/lib/services/outbox-relay.service.ts#L469-L475)).
The test
[`keeps delivering when an event subscriber throws`](https://github.com/nestjs/outbox/blob/bc84a1902e87cc3e8d3f17975f5a83cd4f640356/tests/relay-behaviour.spec.ts#L483)
checks that.

With a real subscriber, the catch never runs. The error comes back later as
an uncaught exception, and the process exits with code 1.

## Run it

No database or network is needed. The script uses the in-memory store and an
`@OnOutboxMessage()` handler, and runs the relay by hand, one batch for each
`runOnce()`.

```bash
npm install
npm run repro
```

Each scenario runs `src/scenario.mjs` in its own process, because a crash
ends the process. In each, one message is added and the relay publishes it.
A metrics subscriber then reads `event.error.message` on the `published`
event, which has no `error`.

- `a subscriber that does not throw (control)`: the subscriber only counts
  the event.
- `an events$ subscriber that throws`: the subscriber listens on
  `OutboxEvents.events$`.
- `a diagnostics_channel subscriber that throws`: the subscriber listens on
  the `nestjs:outbox:published` channel.

## What you should see

Output of `npm run repro`:

```
=== a subscriber that does not throw (control) ===
  subscriber:    got published
  relay batch:   published=1
  process:       still running
  exit code:     0
  expected:      exit code 0

=== an events$ subscriber that throws ===
  subscriber:    got published
  relay batch:   published=1
  uncaught:      TypeError: Cannot read properties of undefined (reading 'message')
  exit code:     1
  expected:      the relay logs "Outbox event subscriber threw", exit code 0

=== a diagnostics_channel subscriber that throws ===
  subscriber:    got published
  relay batch:   published=1
  uncaught:      TypeError: Cannot read properties of undefined (reading 'message')
  exit code:     1
  expected:      the relay logs "Outbox event subscriber threw", exit code 0

RESULT: BUG: the process crashes in 2 of 3 scenarios.
```

The relay never logs "Outbox event subscriber threw". The relay marks the
message as published before it emits the event
([`outbox-relay.service.ts:340-352`](https://github.com/nestjs/outbox/blob/bc84a1902e87cc3e8d3f17975f5a83cd4f640356/lib/services/outbox-relay.service.ts#L340-L352)),
so the message is still marked as published. The exit code
of `npm run repro` is 1.

## Why it happens

`OutboxEvents.emit()` publishes the event on a `diagnostics_channel` channel
and then calls `next()` on an rxjs `Subject`
([`outbox-events.service.ts:16-22`](https://github.com/nestjs/outbox/blob/bc84a1902e87cc3e8d3f17975f5a83cd4f640356/lib/events/outbox-events.service.ts#L16-L22)).
Neither one throws a subscriber's error to its caller:

- rxjs 7 reports it with `reportUnhandledError()`, which throws it again in
  a `setTimeout()`.
- `diagnostics_channel` throws it again in `process.nextTick()`.

So the try/catch in the relay has nothing to catch. The test passes because
it replaces `OutboxEvents` with an object whose `emit()` throws at once.

`@nestjs/webhooks` uses the same two mechanisms and documents this on its
`emit()`: "Catch errors inside your subscribers"
([`webhooks-events.service.ts:14-17`](https://github.com/nestjs/webhooks/blob/2ae465bccc38409c134c46b7426a336c085aeab0/lib/events/webhooks-events.service.ts#L14-L17)).

## Versions

`@nestjs/outbox` 0.1.2 · `@nestjs/common` 12.2.0 · `@nestjs/core` 12.2.0 ·
`rxjs` 7.8.2 · Node 24
