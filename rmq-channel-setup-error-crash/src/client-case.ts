import 'reflect-metadata';
import { ClientRMQ } from '@nestjs/microservices';
import { CONFLICTING_QUEUE_OPTIONS, QUEUE, RMQ_URL } from './config';

async function main() {
  const client = new ClientRMQ({
    urls: [RMQ_URL],
    queue: QUEUE,
    queueOptions: CONFLICTING_QUEUE_OPTIONS,
  });
  const outcome = await Promise.race([
    client.connect().then(
      () => 'resolved',
      error => `rejected with: ${error.message}`,
    ),
    new Promise(resolve => setTimeout(() => resolve('still pending'), 3000)),
  ]);
  console.log(`connect() ${outcome}`);
  await client.close();
}

main();
