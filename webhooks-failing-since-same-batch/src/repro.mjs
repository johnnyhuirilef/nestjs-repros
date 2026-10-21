import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { OutboxModule, OutboxRelay, OutboxStorage } from '@nestjs/outbox';
import {
  InMemoryWebhookTransport,
  WebhookEndpoints,
  WebhookWorker,
  Webhooks,
  WebhooksModule,
} from '@nestjs/webhooks';

const DAY = 24 * 60 * 60 * 1000;

// Moves Date.now() forward, so the script can skip the 5 days of the
// default `disableEndpointAfter` without waiting.
const realNow = Date.now.bind(Date);
let offset = 0;
Date.now = () => realNow() + offset;

async function createApp() {
  const transport = new InMemoryWebhookTransport();
  // The relay and the worker run by hand (`flush()`), one batch per call.
  class AppModule {}
  Module({
    imports: [
      OutboxModule.forRoot({ relay: { enabled: false } }),
      WebhooksModule.forRoot({ worker: { enabled: false }, transport }),
    ],
  })(AppModule);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const outbox = app.get(OutboxStorage).messages;
  const webhooks = app.get(Webhooks);
  return {
    app,
    transport,
    endpoints: app.get(WebhookEndpoints),
    dispatch: (data) =>
      outbox.transaction((tx) => webhooks.dispatch(tx, { type: 'invoice.paid', data })),
    // Publishes the committed messages, then runs one worker batch.
    async flush() {
      await app.get(OutboxRelay).runOnce();
      await app.get(WebhookWorker).runOnce();
    },
  };
}

// Each scenario: one delivery fails and one succeeds, then 6 days pass and
// one delivery fails. A success "resets the clock", so the endpoint must
// stay enabled.
const SCENARIOS = {
  'fail and success in the same batch': async (t) => {
    t.transport.respondWith(() => (t.transport.sent.length === 1 ? 500 : 200));
    await t.dispatch({ id: 1 });
    await t.dispatch({ id: 2 });
    await t.flush();
  },
  'fail and success in separate batches': async (t) => {
    t.transport.respondWith(500);
    await t.dispatch({ id: 1 });
    await t.flush();
    t.transport.respondWith(200);
    await t.dispatch({ id: 2 });
    await t.flush();
  },
};

async function run(name, scenario) {
  offset = 0;
  const t = await createApp();
  const { id } = await t.endpoints.create({ url: 'https://receiver.example/hooks', eventTypes: ['*'] });
  await scenario(t);
  const afterSuccess = await t.endpoints.get(id);
  offset += 6 * DAY;
  t.transport.respondWith(500);
  await t.dispatch({ id: 3 });
  await t.flush();
  const end = await t.endpoints.get(id);
  await t.app.close();
  return {
    name,
    sent: t.transport.sent.length,
    failingSince: afterSuccess.failingSince,
    enabled: end.enabled,
    disabledReason: end.disabledReason,
    ok: afterSuccess.failingSince === null && end.enabled === true,
  };
}

async function main() {
  const results = [];
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    results.push(await run(name, scenario));
  }
  for (const r of results) {
    console.log(`=== ${r.name} ===`);
    console.log(`  failingSince after the success:    ${JSON.stringify(r.failingSince)}`);
    console.log(`  after 6 days and one failure:      enabled=${r.enabled}, disabledReason=${JSON.stringify(r.disabledReason)}`);
    console.log(`  expected:                          failingSince=null, enabled=true\n`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(
    failed === 0
      ? `RESULT: FIXED: the endpoint stays enabled in all ${results.length} scenarios.`
      : `RESULT: BUG: the endpoint is disabled in ${failed} of ${results.length} scenarios.`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
