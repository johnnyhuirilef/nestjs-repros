# `ServerMqtt` runs the `listen()` callback again on every broker reconnect

`ServerMqtt.listen` binds the bootstrap callback with `on`, not `once`:

```ts
// packages/microservices/server/server-mqtt.ts
this.mqttClient.on(MqttEventsMap.CONNECT, () => callback());
```

`mqtt.js` reconnects on the **same** client object and emits `connect` again,
thus Nest runs the callback again each time the broker comes back.

`NestMicroservice.listen` puts `flushLogs()` and the "Nest microservice
successfully started" line in that callback, so a broker restart looks like a
fresh start in the logs.

## Run it

```bash
npm install
npm run repro
```

The broker runs in-process (`aedes`), thus no external broker is needed. The
script starts the service, stops and restarts the broker twice, and counts how
many times Nest runs the callback.

## What you should see

```
=== start ===
  -> listen() callback ran (total: 1)

=== broker restart 1 ===
  -> listen() callback ran (total: 2)

=== broker restart 2 ===
  -> listen() callback ran (total: 3)

=== RESULT ===
  started once, reconnected twice
  listen() callback ran: 3
  BUG: the callback ran 3 times.
```

## Verifying a fix

The script counts the callback itself, thus it shows the result on any version.
With `on` changed to `once`:

```
=== RESULT ===
  started once, reconnected twice
  listen() callback ran: 1
  FIXED: the callback ran once.
```

## The other transports

MQTT is the only one that binds this callback with `on`:

| Transport | How it runs the `listen()` callback |
|---|---|
| TCP | `server.listen(port, host, callback)` — Node runs it once |
| RabbitMQ | `.once(RmqEventsMap.CONNECT, ...)` |
| Redis | called inline, once |
| NATS | called inline, once |
| Kafka | called inline, once |
| **MQTT** | **`.on(MqttEventsMap.CONNECT, ...)`** |

## Versions

`@nestjs/core` 12.0.1 · `@nestjs/microservices` 12.0.1 · `mqtt` 5.15.2 · Node 24
