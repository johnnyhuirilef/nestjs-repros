import 'reflect-metadata';
import { ClientProxyFactory, Transport } from '@nestjs/microservices';

/**
 * ClientNats subscribes to a reply inbox and then publishes. When publish()
 * throws, the inbox subscription is never unsubscribed.
 *
 *   docker run --rm -d --name nats-repro -p 4222:4222 -p 8222:8222 nats -m 8222
 *   npm run repro
 */
const MONITOR_URL = 'http://localhost:8222/connz?subs=1';
const REQUESTS = 5;

async function inboxSubscriptionsOnServer(): Promise<number> {
  const response = await fetch(MONITOR_URL);
  const { connections } = (await response.json()) as {
    connections: { subscriptions_list?: string[] }[];
  };
  return connections
    .flatMap(connection => connection.subscriptions_list ?? [])
    .filter(subject => subject.startsWith('_INBOX.')).length;
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const client = ClientProxyFactory.create({
    transport: Transport.NATS,
    options: { servers: ['nats://localhost:4222'] },
  });
  await client.connect();

  const { max_payload } = (client as any).natsClient.info;
  const oversized = 'x'.repeat(max_payload + 1);
  console.log(`server max_payload: ${max_payload} bytes`);

  console.log(`\n=== send() ${REQUESTS} times with a ${oversized.length}-byte payload ===`);
  for (let i = 1; i <= REQUESTS; i++) {
    await new Promise<void>(resolve => {
      client.send('any.pattern', oversized).subscribe({
        error: err => {
          console.log(`  request ${i} rejected: ${err.message ?? err.code}`);
          resolve();
        },
      });
    });
  }
  await wait(300);

  const leaked = await inboxSubscriptionsOnServer();
  console.log('\n=== RESULT ===');
  console.log(`  requests that failed to publish: ${REQUESTS}`);
  console.log(`  reply-inbox subscriptions left on the server: ${leaked}`);
  console.log('  expected: 0');
  console.log(
    leaked === 0
      ? '  FIXED: every failed request released its inbox subscription.'
      : `  BUG: ${leaked} inbox subscriptions leaked.`,
  );

  await client.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
