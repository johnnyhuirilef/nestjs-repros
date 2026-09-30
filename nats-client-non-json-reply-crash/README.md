# A non-JSON reply crashes the process that runs `ClientNats` and leaves the request pending

`ClientNats` deserializes every reply inside an `async` subscription callback:

```ts
// packages/microservices/client/client-nats.ts (simplified)
return async (error: Error | null, natsMsg: NatsMsg) => {
  ...
  const message = await this.deserializer.deserialize(natsMsg);
  ...
};
```

`@nats-io/nats-core` calls that callback without awaiting it and without a
`catch`. The default `NatsResponseJSONDeserializer` calls `msg.json()`, which
is `JSON.parse`, so a reply that is not valid JSON makes the callback reject.
Only zero-length replies are special-cased (`EmptyResponseException`).

A Nest server always replies with JSON, thus the trigger is a responder that
is not a Nest server (a plain NATS service, another language, a legacy
handler) answering a `ClientNats.send()` with anything else.

The rejection is unhandled, so Node exits with code 1. If the application
installs an `unhandledRejection` handler to survive it, the request never
settles: the observable stays pending, and the `routingMap` entry and the
inbox subscription stay behind.

The server side of the same class was fixed in #17785, which routes message
handler rejections to `handleError`.

## Run it

A real `nats-server` is needed. The script starts a plain NATS responder (not
Nest) that replies to a subject with a fixed payload, then runs a `ClientNats`
`send()` against it. The client runs in a child process, so the script can
report its exit code. It has no `unhandledRejection` handler on purpose. A
second case replies with valid JSON as the baseline:

```bash
docker run --rm -d --name nats-repro -p 4222:4222 -p 8222:8222 nats -m 8222
npm install
npm run repro
docker stop nats-repro
```

Set `NATS_URL` (default `nats://localhost:4222`) to use another server address.

## What you should see

Output of `NO_COLOR=1 npm run repro`:

```
=== reply is not JSON ("not json") ===
  expected: send() rejected with the parse error, process keeps running (exit code 0)
  stdout:      (nothing printed)
  stderr line: SyntaxError: Unexpected token 'o', "not json" is not valid JSON
  exit code:   1

=== reply is valid JSON (baseline) ===
  expected: send() resolves with "ok", process keeps running (exit code 0)
  stdout:      send() resolved with: "ok"
  stderr line: (none)
  exit code:   0

=== RESULT ===
  BUG: 1 of 2 cases ended without settling the request cleanly.
```

The baseline shows that the client and the responder work: only the reply that
cannot be parsed takes the process down. The exit code of `npm run repro`
itself is 1.

## Verifying a fix

The script reports the exit code of each child, thus it shows the result on
any version. With the deserialization error passed to the request instead of
escaping the callback:

```
=== reply is not JSON ("not json") ===
  expected: send() rejected with the parse error, process keeps running (exit code 0)
  stdout:      send() rejected with: SyntaxError: Unexpected token 'o', "not json" is not valid JSON
  stderr line: (none)
  exit code:   0
...
=== RESULT ===
  FIXED: the non-JSON reply failed the request and the process kept running.
```

## Other transports

A custom deserializer that throws on the TCP client crashes the same way. The
Redis, MQTT and RMQ clients route replies by an id that is inside the payload
that failed to parse, so their fix is different and is not shown here.

## Versions

`@nestjs/common` 12.1.2 · `@nestjs/core` 12.1.2 · `@nestjs/microservices` 12.1.2 ·
`@nats-io/transport-node` 3.4.0 · `nats-server` (docker `nats:latest`) · Node 24
