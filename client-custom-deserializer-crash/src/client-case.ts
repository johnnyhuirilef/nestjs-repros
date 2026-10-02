import 'reflect-metadata';
import { ClientProxyFactory, Transport } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { MQTT_URL, PATTERN, REDIS_PORT, RMQ_QUEUE, RMQ_URL, TCP_PORT } from './config';

const GIVE_UP_AFTER_MS = 3000;
const STILL_PENDING_EXIT_CODE = 3;

// Throws a TypeError on any reply that has no `meta` object.
const deserializer = {
  deserialize: (value: any) => ({ id: value.meta.id, response: value.body, isDisposed: true }),
};

const CLIENT_OPTIONS = {
  tcp: { transport: Transport.TCP, options: { port: TCP_PORT, deserializer } },
  redis: {
    transport: Transport.REDIS,
    options: { port: REDIS_PORT, deserializer },
  },
  mqtt: { transport: Transport.MQTT, options: { url: MQTT_URL, deserializer } },
  rmq: {
    transport: Transport.RMQ,
    options: { urls: [RMQ_URL], queue: RMQ_QUEUE, deserializer },
  },
};

async function main() {
  const client = ClientProxyFactory.create(CLIENT_OPTIONS[process.argv[2]]);
  await client.connect();

  // Deliberately no process.on('unhandledRejection'): the point is what happens without one.
  setTimeout(() => {
    console.log(`send() still pending after ${GIVE_UP_AFTER_MS} ms`);
    process.exit(STILL_PENDING_EXIT_CODE);
  }, GIVE_UP_AFTER_MS);

  try {
    console.log('send() resolved with:', JSON.stringify(await lastValueFrom(client.send(PATTERN, { hello: 'world' }))));
  } catch (err) {
    console.log(`send() rejected with: ${err.name}: ${err.message}`);
  }
  process.exit(0);
}

main();
