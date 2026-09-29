# `ClientNats` leaves the reply-inbox subscription behind when `publish()` throws

`ClientNats.publish` subscribes to a reply inbox first and publishes second:

```ts
// packages/microservices/client/client-nats.ts
try {
  const subscription = this.natsClient!.subscribe(inbox, { callback });

  const headers = this.mergeHeaders(serializedPacket.headers);
  this.natsClient!.publish(channel, serializedPacket.data, { reply: inbox, headers });

  return () => {
    cleanup();
    subscription.unsubscribe();
  };
} catch (err) {
  errorCallback(err);
  return () => {};
}
```

`@nats-io/nats-core` throws synchronously from `publish()` when the payload is
larger than the server's `max_payload`. The `catch` cleans the `routingMap` and
notifies the caller, but it returns a no-op teardown, thus
`subscription.unsubscribe()` never runs. Every failing request leaves one
`_INBOX.*` subscription alive on the client and on the server.

## Run it

A real `nats-server` is needed, because a mocked client cannot show what the
server keeps:

```bash
docker run --rm -d --name nats-repro -p 4222:4222 -p 8222:8222 nats -m 8222
npm install
npm run repro
docker stop nats-repro
```

The script sends five requests whose payload is one byte over `max_payload`,
then asks the server's monitoring endpoint (`/connz?subs=1`) how many
`_INBOX.*` subscriptions are still registered.

## What you should see

```
server max_payload: 1048576 bytes

=== send() 5 times with a 1048577-byte payload ===
  request 1 rejected: 'payload' max_payload size exceeded
  request 2 rejected: 'payload' max_payload size exceeded
  request 3 rejected: 'payload' max_payload size exceeded
  request 4 rejected: 'payload' max_payload size exceeded
  request 5 rejected: 'payload' max_payload size exceeded

=== RESULT ===
  requests that failed to publish: 5
  reply-inbox subscriptions left on the server: 5
  expected: 0
  BUG: 5 inbox subscriptions leaked.
```

Every request is rejected correctly, so nothing in the application signals a
problem, yet the subscriptions stay until the connection closes.

## Verifying a fix

The script counts the server's subscriptions itself, thus it shows the result
on any version. With the subscription released when `publish()` throws:

```
=== RESULT ===
  requests that failed to publish: 5
  reply-inbox subscriptions left on the server: 0
  expected: 0
  FIXED: every failed request released its inbox subscription.
```

## Other transports

| Transport | Failed send |
|---|---|
| TCP, Redis, MQTT | bookkeeping undone in #17822 |
| RabbitMQ | no leak: rxjs runs the returned teardown when the request rejects |
| **NATS** | **inbox subscription is never unsubscribed** |

## Versions

`@nestjs/common` 12.1.1 · `@nestjs/core` 12.1.1 · `@nestjs/microservices` 12.1.1 ·
`@nats-io/transport-node` 3.4.0 · `nats-server` (docker `nats:latest`) · Node 24
