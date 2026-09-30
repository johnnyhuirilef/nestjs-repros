# An RMQ channel setup error crashes the process instead of failing `connect()` and `listen()`

`amqp-connection-manager` documents that a `ChannelWrapper` emits an `'error'`
event when its setup function throws ("Setup functions should, ideally, not
throw errors, but if they do then the ChannelWrapper will emit an 'error'
event"). Nest creates the wrapper in `ClientRMQ.createChannel()` and in
`ServerRMQ.start()` and never listens to that event:

```ts
// packages/microservices/client/client-rmq.ts (simplified)
this.channel = this.client!.createChannel({
  json: false,
  setup: (channel: Channel) => this.setupChannel(channel, resolve),
});
```

An `EventEmitter` that emits `'error'` with no listener throws. Here the throw
happens inside the library's async connect handler, so it becomes an unhandled
rejection, and Node exits with code 1.

Any setup failure after the connection is up triggers it. The easiest one to
hit is a queue that already exists with other arguments (`406
PRECONDITION_FAILED`), for example after `durable` or a `x-*` argument changed
in the code but not on the broker. A named `replyQueue` that was never declared
fails the same way.

The impact is a process that dies at boot with a stack trace from inside
`amqplib`, on a misconfiguration that has an obvious fix. `await
client.connect()` cannot be wrapped in a `try`/`catch`, and `listen()` has no
error to react to. A lazy `client.send()` from a request handler takes the
whole server down.

## Run it

A real RabbitMQ is needed, because the error comes from the broker. The script
declares the queue as durable, then runs a `ClientRMQ` and a `ServerRMQ` (via
`createMicroservice`) that ask for the same queue as non-durable. Each one runs
in a child process, so the script can report its exit code:

```bash
docker run --rm -d --name rmq-repro -p 5672:5672 rabbitmq:3.13
docker exec rmq-repro rabbitmqctl await_startup
npm install
npm run repro
docker stop rmq-repro
```

Set `RMQ_URL` (default `amqp://localhost:5672`) to use another broker address.
The script deletes the queue when it is done.

## What you should see

Output of `NO_COLOR=1 npm run repro`, with the pid and the timestamp removed:

```
=== ClientRMQ: await client.connect() (queue declared durable, requested non-durable) ===
  expected: rejected with the 406 error, process keeps running (exit code 0)
  stdout:      [Nest] LOG [ClientProxy] Successfully connected to RMQ broker
  stderr line: Error: Operation failed: QueueDeclare; 406 (PRECONDITION-FAILED) with message "PRECONDITION_FAILED - inequivalent arg 'durable' for queue 'repro-conflict' in vhost '/': received 'false' but current is 'true'"
  exit code:   1

=== ServerRMQ: await app.listen() (queue declared durable, requested non-durable) ===
  expected: rejected with the 406 error, process keeps running (exit code 0)
  stdout:      (nothing printed)
  stderr line: Error: Operation failed: QueueDeclare; 406 (PRECONDITION-FAILED) with message "PRECONDITION_FAILED - inequivalent arg 'durable' for queue 'repro-conflict' in vhost '/': received 'false' but current is 'true'"
  exit code:   1

=== RESULT ===
  BUG: 2 of 2 cases crashed the process instead of rejecting.
```

The `Successfully connected to RMQ broker` line is the connection, which is
fine: only the channel fails. The exit code of `npm run repro` itself is 1.

## Verifying a fix

The script reports the exit code of each child, thus it shows the result on any
version. With the setup error passed to `connect()` and to the listen callback:

```
=== ClientRMQ: await client.connect() (queue declared durable, requested non-durable) ===
  expected: rejected with the 406 error, process keeps running (exit code 0)
  stdout:      [Nest] LOG [ClientProxy] Successfully connected to RMQ broker
               connect() rejected with: Operation failed: QueueDeclare; 406 (PRECONDITION-FAILED) with message "PRECONDITION_FAILED - inequivalent arg 'durable' for queue 'repro-conflict' in vhost '/': received 'false' but current is 'true'"
  stderr line: (none)
  exit code:   0

=== ServerRMQ: await app.listen() (queue declared durable, requested non-durable) ===
  expected: rejected with the 406 error, process keeps running (exit code 0)
  stdout:      listen() rejected with: Operation failed: QueueDeclare; 406 (PRECONDITION-FAILED) with message "PRECONDITION_FAILED - inequivalent arg 'durable' for queue 'repro-conflict' in vhost '/': received 'false' but current is 'true'"
  stderr line: (none)
  exit code:   0

=== RESULT ===
  FIXED: both cases rejected with the 406 error and the process kept running.
```

## Versions

`@nestjs/common` 12.1.2 · `@nestjs/core` 12.1.2 · `@nestjs/microservices` 12.1.2 ·
`amqp-connection-manager` 5.0.0 · `amqplib` 2.2.0 · RabbitMQ 3.13 (docker
`rabbitmq:3.13`) · Node 24
