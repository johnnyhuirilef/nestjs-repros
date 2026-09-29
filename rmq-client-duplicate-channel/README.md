# `ClientRMQ` opens two channels on its first connect and orphans one

On the first `CONNECT` event of a fresh client, two places create the channel:

```ts
// packages/microservices/client/client-rmq.ts (simplified)

// 1. the pipeline inside connect()
this.connection$ = mergeDisconnectEvent(connect$, disconnect$).pipe(
  switchMap(() => this.createChannel()),
  // ...
);

// 2. the CONNECT listener registered in registerConnectListener()
if (this.isInitialConnect) {
  this.isInitialConnect = false;
  if (!this.channel) {
    this.connectionPromise = this.createChannel();
  }
}
```

The listener is registered first, so it runs first: it sees `this.channel` as
`null` and creates a channel. The pipeline's `switchMap` runs next and has no
guard, so it creates a second channel and overwrites `this.channel`. The first
channel is no longer referenced but stays open on the broker. The
`!this.channel` guard sits only on the side that always runs first, thus it
never prevents the duplicate.

Every fresh client therefore holds two channels instead of one. The orphan is set up
again on every broker reconnect, and with a named `replyQueue` there are two
consumers competing for the replies. Sends keep working, so nothing in the
application signals it. The impact is wasted broker resources (channels,
consumers) for the lifetime of the client.

## Run it

A real RabbitMQ is needed, because a mocked channel cannot show what the broker
keeps. The script counts channels and consumers with `rabbitmqctl` inside the
container, so the container must be named `rmq-repro` (or set `RMQ_CONTAINER`):

```bash
docker run --rm -d --name rmq-repro -p 5672:5672 rabbitmq:3.13
docker exec rmq-repro rabbitmqctl await_startup
npm install
npm run repro
docker stop rmq-repro
```

The script creates one `ClientRMQ` with a named `replyQueue`, awaits
`connect()`, and then asks the broker how many channels are open and how many
consumers the reply queue has. It is the only client on the broker, so every
channel belongs to it. The queue is declared by the script first, because
`ClientRMQ` consumes a named reply queue but does not declare it.

## What you should see

```
=== 1 ClientRMQ, after await connect() ===
  channels open on the broker: 2
  expected: 1
  consumers on the reply queue "repro-reply": 2
  expected: 1
  BUG: 2 channels and 2 reply consumers for one client.
```

Nest also logs `Successfully connected to RMQ broker` before this output.

## Verifying a fix

The script counts on the broker itself, thus it shows the result on any
version. With `connect()` as the only creator of the channel:

```
=== 1 ClientRMQ, after await connect() ===
  channels open on the broker: 1
  expected: 1
  consumers on the reply queue "repro-reply": 1
  expected: 1
  FIXED: the client opened a single channel.
```

## Versions

`@nestjs/common` 12.1.2 · `@nestjs/core` 12.1.2 · `@nestjs/microservices` 12.1.2 ·
`amqp-connection-manager` 5.0.0 · `amqplib` 2.2.0 · RabbitMQ 3.13 (docker
`rabbitmq:3.13`) · Node 24
