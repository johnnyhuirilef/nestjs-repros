# A change to an endpoint during a worker batch does not apply to the rest of the batch

In `@nestjs/webhooks`, the worker sends a batch of deliveries for one
endpoint with the endpoint it read at the start of the batch. If the
endpoint changes while the batch runs, the later deliveries of the batch
do not see the change:

- After `update(id, { enabled: false })` or `delete(id)`, they are still
  sent. The [docs](https://github.com/nestjs/docs.nestjs.com/blob/16740e7b1020d7e14ba58718bb6e31ee7ace6c38/content/http/webhooks.md?plain=1#L785) say that pending deliveries "fail with the
  reason `endpoint-disabled` when their turn comes", and the JSDoc of
  `delete()` says the same for `endpoint-deleted`.
- After `update(id, { url })`, they go to the old URL.
- After `rotateSecret(id, { overlap: 0 })`, they are signed with the old
  secret only. The [docs](https://github.com/nestjs/docs.nestjs.com/blob/16740e7b1020d7e14ba58718bb6e31ee7ace6c38/content/http/webhooks.md?plain=1#L1224) say that `overlap: 0` "retires the
  old one at once, for a leaked secret".

## Run it

No database or network is needed. The script uses the in-memory outbox and
store, and a transport that records each request and answers `200`. It
runs the relay and the worker by hand.

```bash
npm install
npm run repro
```

The script dispatches 3 events for one endpoint, so one worker batch sends
3 requests. In each scenario, the transport makes one change to the
endpoint while it handles request 1. The first scenario makes no change.
It is the control.

## What you should see

Output of `npm run repro`:

```
=== No change (control) during request 1 ===
  request 1: https://old.example/hooks, signed with the old secret
  request 2: https://old.example/hooks, signed with the old secret
  request 3: https://old.example/hooks, signed with the old secret
  deliveries: succeeded, succeeded, succeeded

=== update(id, { enabled: false }) during request 1 ===
  request 1: https://old.example/hooks, signed with the old secret
  request 2: https://old.example/hooks, signed with the old secret
  request 3: https://old.example/hooks, signed with the old secret
  deliveries: succeeded, succeeded, succeeded

=== delete(id) during request 1 ===
  request 1: https://old.example/hooks, signed with the old secret
  request 2: https://old.example/hooks, signed with the old secret
  request 3: https://old.example/hooks, signed with the old secret
  deliveries: succeeded, succeeded, succeeded

=== update(id, { url }) during request 1 ===
  request 1: https://old.example/hooks, signed with the old secret
  request 2: https://old.example/hooks, signed with the old secret
  request 3: https://old.example/hooks, signed with the old secret
  deliveries: succeeded, succeeded, succeeded

=== rotateSecret(id, { overlap: 0 }) during request 1 ===
  request 1: https://old.example/hooks, signed with the old secret
  request 2: https://old.example/hooks, signed with the old secret
  request 3: https://old.example/hooks, signed with the old secret
  deliveries: succeeded, succeeded, succeeded

RESULT: BUG: in 4 of 4 scenarios, requests 2 and 3 ignore the change.
```

The exit code of `npm run repro` is 1.

## Why it happens

The worker reads the endpoint once for each group of deliveries
([`webhook-worker.service.ts:229`](https://github.com/nestjs/webhooks/blob/edb7929aed8da2d2bbbce4295e9c5187db4d1575/lib/services/webhook-worker.service.ts#L229)),
and gives that copy to each delivery of the group
([`:236`](https://github.com/nestjs/webhooks/blob/edb7929aed8da2d2bbbce4295e9c5187db4d1575/lib/services/webhook-worker.service.ts#L236)). The check for a disabled or
deleted endpoint ([`:281`](https://github.com/nestjs/webhooks/blob/edb7929aed8da2d2bbbce4295e9c5187db4d1575/lib/services/webhook-worker.service.ts#L281)) and the send, with its URL and
signing secrets ([`:299`](https://github.com/nestjs/webhooks/blob/edb7929aed8da2d2bbbce4295e9c5187db4d1575/lib/services/webhook-worker.service.ts#L299)), use that copy.

## Verifying a fix

With a fix, requests 2 and 3 follow the change in each scenario. The last
line is:

```
RESULT: FIXED: each change applies to the requests after it, in all 4 scenarios.
```

The exit code is 0. To test a local build, install the packed
`@nestjs/webhooks` with `npm install ./path/to/package.tgz`.

## Versions

`@nestjs/webhooks` 0.0.3 · `@nestjs/outbox` 0.1.3 · `@nestjs/common` 12.2.0 ·
`@nestjs/core` 12.2.0 · Node 24
