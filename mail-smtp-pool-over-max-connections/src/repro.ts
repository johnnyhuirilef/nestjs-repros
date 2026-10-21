import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MailModule, Mailer, SmtpTransport } from '@nestjs/mail';
import { startFakeSmtpServer } from './fake-smtp-server.js';

const QUEUED_SENDS = 4;

interface Outcome {
  peakConnections: number;
  peakMessagesInFlight: number;
  sent: number;
}

async function scenario(maxConnections: number, dropFirstConnection: boolean): Promise<Outcome> {
  const server = await startFakeSmtpServer({ dropFirstConnection });

  @Module({
    imports: [
      MailModule.forRoot({
        transport: new SmtpTransport({ host: '127.0.0.1', port: server.port, startTls: 'never', pool: { maxConnections } }),
        from: 'shop@example.com',
      }),
    ],
  })
  class AppModule {}

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const mailer = app.get(Mailer);

  // The first send leaves one connection idle in the pool.
  await mailer.send({ to: 'first@example.com', subject: 'Warm up', text: 'Hi' });
  server.resetPeaks();

  const sends = Array.from({ length: QUEUED_SENDS }, (_, index) =>
    mailer.send({ to: `customer${index}@example.com`, subject: 'Order shipped', text: 'Hi' }),
  );
  const results = await Promise.allSettled(sends);

  await app.close();
  await server.close();
  return {
    peakConnections: server.peakConnections,
    peakMessagesInFlight: server.peakMessagesInFlight,
    sent: results.filter((result) => result.status === 'fulfilled').length,
  };
}

function print(title: string, maxConnections: number, outcome: Outcome): void {
  console.log(`=== ${title} ===`);
  console.log(`  maxConnections:          ${maxConnections}`);
  console.log(`  peak open connections:   ${outcome.peakConnections}`);
  console.log(`  peak messages in flight: ${outcome.peakMessagesInFlight}`);
  console.log(`  sent:                    ${outcome.sent} of ${QUEUED_SENDS}`);
  console.log(`  expected:                at most ${maxConnections} open, ${QUEUED_SENDS} sent`);
  console.log('');
}

const control = await scenario(1, false);
print('the pooled connection stays up (control)', 1, control);

const dropped = await scenario(1, true);
print('the server drops the pooled connection, sends are waiting', 1, dropped);

const droppedTwo = await scenario(2, true);
print('the same with maxConnections 2', 2, droppedTwo);

const controlOk = control.peakConnections <= 1 && control.sent === QUEUED_SENDS;
const overCap = dropped.peakConnections > 1 || droppedTwo.peakConnections > 2;
if (!controlOk) {
  console.log('RESULT: INCONCLUSIVE: the control case did not stay within the cap.');
  process.exitCode = 2;
} else if (overCap) {
  console.log('RESULT: BUG: the pool opens more connections than maxConnections.');
  process.exitCode = 1;
} else {
  console.log('RESULT: FIXED');
}
