# A success does not reset the failure clock of an endpoint when a failure came first in the same batch

In `@nestjs/webhooks`, a successful delivery must reset the failure clock of
its endpoint. The
[docs](https://github.com/nestjs/docs.nestjs.com/blob/de141305c6da0e932e35dd63aee183ca6628ec81/content/http/webhooks.md?plain=1#L785)
say: "A success at any point resets the clock".

When one worker batch has a failed delivery and then a successful delivery
to the same endpoint, the clock is not reset. If the endpoint gets no other
success for `disableEndpointAfter` (5 days by default), one more failure
disables it with the reason `failing`, although it answered with a success.

## Run it

No database or network is needed. The script uses the in-memory outbox and
store, and `InMemoryWebhookTransport` as the endpoint. It runs the relay and
the worker by hand, one batch for each `flush()`. It moves `Date.now()`
forward to skip the 5 days.

```bash
npm install
npm run repro
```

The script runs two scenarios. In each, one delivery fails with `500` and
one delivery succeeds with `200`. Then 6 days pass and one more delivery
fails.

- `fail and success in the same batch`: both deliveries are in one batch.
- `fail and success in separate batches`: each delivery has its own batch.
  This is the control.

## What you should see

Output of `npm run repro`:

```
=== fail and success in the same batch ===
  failingSince after the success:    1792585227295
  after 6 days and one failure:      enabled=false, disabledReason="failing"
  expected:                          failingSince=null, enabled=true

=== fail and success in separate batches ===
  failingSince after the success:    null
  after 6 days and one failure:      enabled=true, disabledReason=null
  expected:                          failingSince=null, enabled=true

RESULT: BUG: the endpoint is disabled in 1 of 2 scenarios.
```

The value of `failingSince` changes on each run. The exit code of
`npm run repro` is 1.

## Why it happens

The worker groups a batch by endpoint
([`webhook-worker.service.ts:205`](https://github.com/nestjs/webhooks/blob/0a88bb4ce00b19fb879f0e035e31291755e93ae1/lib/services/webhook-worker.service.ts#L205)).
It reads the endpoint once for each group
([`:229`](https://github.com/nestjs/webhooks/blob/0a88bb4ce00b19fb879f0e035e31291755e93ae1/lib/services/webhook-worker.service.ts#L229))
and gives that copy to every delivery of the group.

- A failed delivery records the failure in the store, and the store sets
  `failingSince`. The copy of the group keeps `failingSince: null`. The
  worker updates the copy only for `enabled: false`
  ([`:248`](https://github.com/nestjs/webhooks/blob/0a88bb4ce00b19fb879f0e035e31291755e93ae1/lib/services/webhook-worker.service.ts#L248)).
- A successful delivery calls `recordEndpointSuccess()` only when the copy
  has a `failingSince`
  ([`:318-320`](https://github.com/nestjs/webhooks/blob/0a88bb4ce00b19fb879f0e035e31291755e93ae1/lib/services/webhook-worker.service.ts#L318-L320)).
  The copy has none, so the store keeps `failingSince` from the failure.

## Verifying a fix

With a fix, the endpoint stays enabled in both scenarios. The last line is:

```
RESULT: FIXED: the endpoint stays enabled in all 2 scenarios.
```

The exit code is 0. To test a local build, install the packed
`@nestjs/webhooks` with `npm install ./path/to/package.tgz`.

## Versions

`@nestjs/webhooks` 0.0.2 · `@nestjs/outbox` 0.1.2 · `@nestjs/common` 12.2.0 ·
`@nestjs/core` 12.2.0 · Node 24
