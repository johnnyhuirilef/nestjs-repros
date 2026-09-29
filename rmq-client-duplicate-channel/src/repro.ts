import 'reflect-metadata';
import { execFileSync } from 'child_process';
import * as amqp from 'amqplib';
import { ClientRMQ } from '@nestjs/microservices';

/**
 * On the first connect, ClientRMQ creates its channel twice: once from the
 * CONNECT listener and once from the pipeline inside connect(). The second
 * channel replaces the first one, which stays open and is never used.
 *
 *   docker run --rm -d --name rmq-repro -p 5672:5672 rabbitmq:3.13
 *   npm run repro
 */
const CONTAINER = process.env.RMQ_CONTAINER ?? 'rmq-repro';
const REPLY_QUEUE = 'repro-reply';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function rabbitmqctl(...args: string[]): string[] {
  const output = execFileSync('docker', ['exec', CONTAINER, 'rabbitmqctl', '-q', ...args]);
  return output.toString().trim().split('\n').slice(1).filter(Boolean);
}

async function declareReplyQueue() {
  // ClientRMQ consumes a named reply queue but does not declare it.
  const connection = await amqp.connect('amqp://localhost:5672');
  const channel = await connection.createChannel();
  await channel.assertQueue(REPLY_QUEUE, { durable: false });
  await connection.close();
}

async function main() {
  await declareReplyQueue();
  const client = new ClientRMQ({
    urls: ['amqp://localhost:5672'],
    queue: 'repro-queue',
    replyQueue: REPLY_QUEUE,
    queueOptions: { durable: false },
  });
  await client.connect();
  await wait(1000);

  const channels = rabbitmqctl('list_channels', 'connection', 'number').length;
  const replyConsumers = rabbitmqctl('list_consumers', 'queue_name').filter(
    queue => queue === REPLY_QUEUE,
  ).length;

  console.log('=== 1 ClientRMQ, after await connect() ===');
  console.log(`  channels open on the broker: ${channels}`);
  console.log('  expected: 1');
  console.log(`  consumers on the reply queue "${REPLY_QUEUE}": ${replyConsumers}`);
  console.log('  expected: 1');
  console.log(
    channels === 1 && replyConsumers === 1
      ? '  FIXED: the client opened a single channel.'
      : `  BUG: ${channels} channels and ${replyConsumers} reply consumers for one client.`,
  );

  await client.close();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
