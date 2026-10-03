# A record that a message handler returns is not unwrapped in the reply

`ServerMqtt`, `ServerNats` and `ServerRMQ` build a reply packet as
`{ response, isDisposed, id }`. Code that handles transport records looks at
`packet.data` and at `response.data`, so it never sees a record that a handler
returns in `response`:

```ts
// packages/microservices/server/server-mqtt.ts (simplified)
const options =
  isObject(response?.data) && response.data instanceof MqttRecord
    ? response.data.options
    : {};
```

```ts
// packages/microservices/serializers/mqtt-record.serializer.ts (simplified)
if (isObject(packet?.data) && packet.data instanceof MqttRecord) { ... }
```

A handler can return a record with the same builders a client uses to send one
(`MqttRecordBuilder`, `NatsRecordBuilder`, `RmqRecordBuilder`). The result:

- The client gets the whole record (`{ data, options }` or `{ data, headers }`)
  instead of the data.
- The record options are dropped. An MQTT reply goes out at QoS 0 with no
  properties, a NATS reply has no headers, an RMQ reply has no priority and no
  headers.

A handler that returns a plain object works. Only the record case is wrong.

## Run it

Real brokers are needed. For each transport the script runs a Nest microservice
with two `@MessagePattern()` handlers: one returns a plain object (the
baseline), one returns a record. A Nest client calls `send()` and prints what it
resolves with. A raw client (not Nest) sends the same request and prints the
reply options it sees: the QoS and the user properties on MQTT (MQTT v5), the
headers on NATS, the priority and the headers on RMQ.

```bash
docker run --rm -d --name mqtt-repro -p 11883:1883 eclipse-mosquitto:2 mosquitto -c /mosquitto-no-auth.conf
docker run --rm -d --name nats-repro -p 14222:4222 nats:2
docker run --rm -d --name rmq-repro -p 15672:5672 rabbitmq:3.13
docker exec rmq-repro rabbitmqctl await_startup
npm install
npm run repro
docker stop mqtt-repro nats-repro rmq-repro
```

Set `MQTT_URL` (default `mqtt://localhost:11883`), `NATS_URL` (default
`nats://localhost:14222`) and `RMQ_URL` (default `amqp://localhost:15672`) to
use other addresses.

## What you should see

Output of `NO_COLOR=1 npm run repro`, shortened to the record cases (each
transport also prints a baseline case that resolves with the data):

```
=== MQTT: handler returns a record ===
  expected:       send() resolves with {"message":"hello"} and the record options reach the reply
  send() got:     {"data":{"message":"hello"},"options":{"qos":1,"properties":{"userProperties":{"x-repro":"record"}}}}
  raw reply body: {"data":{"message":"hello"},"options":{"qos":1,"properties":{"userProperties":{"x-repro":"record"}}}}
  reply options:  qos 0, userProperties null
  outcome:        wrong

=== NATS: handler returns a record ===
  send() got:     {"data":{"message":"hello"},"headers":{"_code":0,"headers":{},"_description":""}}
  reply options:  headers null
  outcome:        wrong

=== RMQ: handler returns a record ===
  send() got:     {"data":{"message":"hello"},"options":{"priority":5,"headers":{"x-repro":"record"}}}
  reply options:  priority undefined, headers {}
  outcome:        wrong

RESULT: BUG: 3 of 6 cases did not end as expected (the record is not unwrapped, and its options are dropped).
```

The baselines resolve with `{"message":"hello"}` and show that the servers and
clients work. The exit code of `npm run repro` is 1.

## Verifying a fix

With the fix, `send()` resolves with `{"message":"hello"}` for the record case,
and the raw client sees the record options: `qos 1` with the `x-repro` user
property on MQTT, the `x-repro` header on NATS, and `priority 5` with the
`x-repro` header on RMQ. The last line is:

```
RESULT: FIXED: every reply carries the record data, and the record options apply on MQTT, NATS and RMQ.
```

The exit code is 0. To test a local build, install the packed
`@nestjs/microservices` (and `@nestjs/common` and `@nestjs/core` if they
changed) with `npm install ./path/to/package.tgz`.

## Versions

`@nestjs/common` 12.1.2 · `@nestjs/core` 12.1.2 · `@nestjs/microservices` 12.1.2 ·
`mqtt` 5.16.0 · `@nats-io/transport-node` 3.4.0 · `amqplib` 2.2.0 ·
`amqp-connection-manager` 5.0.0 · Node 24 · `eclipse-mosquitto:2` · `nats:2` ·
`rabbitmq:3.13`
