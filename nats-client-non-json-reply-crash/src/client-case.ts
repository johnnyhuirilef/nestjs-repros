import 'reflect-metadata';
import { ClientProxyFactory, Transport } from '@nestjs/microservices';
import { NATS_URL, SUBJECT } from './config';

const GIVE_UP_AFTER_MS = 3000;

async function main() {
  const client = ClientProxyFactory.create({
    transport: Transport.NATS,
    options: { servers: [NATS_URL] },
  });
  await client.connect();

  // Deliberately no process.on('unhandledRejection'): the point is what happens without one.
  const giveUp = setTimeout(() => {
    console.log(`send() still pending after ${GIVE_UP_AFTER_MS} ms`);
    process.exit(3);
  }, GIVE_UP_AFTER_MS);

  client.send(SUBJECT, { hello: 'world' }).subscribe({
    next: value => console.log('send() resolved with:', JSON.stringify(value)),
    error: err => {
      console.log(`send() rejected with: ${err.name}: ${err.message}`);
      process.exit(0);
    },
    complete: () => {
      clearTimeout(giveUp);
      process.exit(0);
    },
  });
}

main();
