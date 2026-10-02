# A custom deserializer that rejects a reply crashes the process that runs the client

`ClientTCP`, `ClientRedis`, `ClientMqtt` and `ClientRMQ` await
`this.deserializer.deserialize(...)` inside a listener that nobody awaits:

```ts
// packages/microservices/client/client-redis.ts (simplified)
return async (channel: string, buffer: string) => {
  ...
  const { err, response, isDisposed, id } = await this.deserializer.deserialize(packet);
  ...
};
```

The listener is registered on a socket, a broker library or an `EventEmitter`.
None of them awaits it or catches its rejection. The default
`IncomingResponseDeserializer` never throws, but the `deserializer` option
accepts a custom one, and a custom one can throw on a reply it does not expect:

```ts
{ deserialize: (value) => ({ id: value.meta.id, response: value.body, isDisposed: true }) }
```

The rejection is unhandled, so Node exits with code 1. If the application
installs an `unhandledRejection` handler to survive it, the request never
settles: the observable stays pending and the `routingMap` entry stays behind.

A Nest server always replies with the shape the default deserializer reads, thus
the trigger is any other publisher on the reply topic or queue: a non-Nest
responder, a service that skews in version, or anyone who can publish to a shared
Redis or MQTT broker.

`ClientNats` has the same pattern. It was fixed in #17959 by failing the
request with the deserialization error.

## Run it

Real brokers are needed for Redis, MQTT and RabbitMQ. TCP needs none. The
script runs a plain responder (not Nest) in this process. For each transport
it runs a `ClientProxy` `send()` in a child process, so one crash does not stop
the other cases. The responder answers once with a payload that has no `meta`
object (the custom deserializer throws on it), and once with a well-formed
payload as the baseline. The client has no `unhandledRejection` handler on
purpose.

```bash
docker run --rm -d --name redis-repro -p 16379:6379 redis:7-alpine
docker run --rm -d --name mqtt-repro -p 11883:1883 eclipse-mosquitto:2 mosquitto -c /mosquitto-no-auth.conf
docker run --rm -d --name rmq-repro -p 15672:5672 rabbitmq:3.13
docker exec rmq-repro rabbitmqctl await_startup
npm install
npm run repro
docker stop redis-repro mqtt-repro rmq-repro
```

Set `TCP_PORT` (default `19001`), `REDIS_PORT` (default `16379`), `MQTT_URL`
(default `mqtt://localhost:11883`) and `RMQ_URL` (default
`amqp://localhost:15672`) to use other addresses. The script deletes its RMQ
queue when it is done.

## What you should see

Output of `NO_COLOR=1 npm run repro`, shortened to the rogue-reply cases (each
transport also prints a baseline case that resolves with `"ok"`):

```
=== TCP: reply the deserializer rejects ===
  expected:    still pending (the packet is dropped and the process keeps running)
  outcome:     crashed (process exit code 1)
  exit code:   1
  caller got:  (none)
  stderr line: TypeError: Cannot read properties of undefined (reading 'id')

=== REDIS: reply the deserializer rejects ===
  ... same, outcome: crashed (process exit code 1)

=== MQTT: reply the deserializer rejects ===
  ... same, outcome: crashed (process exit code 1)

=== RMQ: reply the deserializer rejects ===
  expected:    rejected (the request fails with the deserializer error)
  outcome:     crashed (process exit code 1)
  ...

RESULT: BUG: 4 of 8 cases did not end as expected (a crashed client exits with code 1).
```

The baselines show that the clients and the responders work: only the reply
that the deserializer rejects takes the process down. The exit code of
`npm run repro` is 1.

## Verifying a fix

The script reports the exit code of each child, thus it shows the result on
any version. With the error caught inside the listener:

- TCP, Redis and MQTT cannot know which request the reply belongs to when
  `deserialize` throws, so the packet is dropped, the process keeps running
  and the request stays pending (outcome `still pending`).
- RMQ knows the request, so it fails with the deserializer error (outcome
  `rejected`, `caller got: send() rejected with: TypeError: ...`).

The last line is:

```
RESULT: FIXED: no client crashed, and RMQ failed the request with the deserializer error.
```

The exit code is 0. To test a local build, install the packed
`@nestjs/microservices` (and `@nestjs/common` and `@nestjs/core` if they
changed) with `npm install ./path/to/package.tgz`.

## Versions

`@nestjs/common` 12.1.2 · `@nestjs/core` 12.1.2 · `@nestjs/microservices` 12.1.2 ·
`ioredis` 6.0.0 · `mqtt` 5.16.0 · `amqplib` 2.2.0 · `amqp-connection-manager` 5.0.0 ·
Node 24 · `redis:7-alpine` · `eclipse-mosquitto:2` · `rabbitmq:3.13`
