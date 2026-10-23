import 'reflect-metadata';
import { createHmac } from 'node:crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { OutboxModule, OutboxRelay, OutboxStorage } from '@nestjs/outbox';
import {
  WebhookDeliveries,
  WebhookEndpoints,
  WebhookTransport,
  WebhookWorker,
  Webhooks,
  WebhooksModule,
} from '@nestjs/webhooks';

const OLD_URL = 'https://old.example/hooks';
const NEW_URL = 'https://new.example/hooks';

// Standard Webhooks signature: HMAC-SHA256 of "id.timestamp.body" with the
// base64 key after "whsec_".
function signedWith(secret, request) {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const content = `${request.headers['webhook-id']}.${request.headers['webhook-timestamp']}.${request.body}`;
  const expected = 'v1,' + createHmac('sha256', key).update(content).digest('base64');
  return request.headers['webhook-signature'].split(' ').includes(expected);
}

async function run(name, change) {
  const sent = [];
  const state = {};
  // Answers 200 to every request. During the first request, it runs the
  // change, as an admin action that happens while the batch runs.
  class RecordingTransport extends WebhookTransport {
    async send(request) {
      sent.push(request);
      if (sent.length === 1 && change) {
        await change(state);
      }
      return { statusCode: 200, headers: {}, body: '' };
    }
  }
  class AppModule {}
  Module({
    imports: [
      OutboxModule.forRoot({ relay: { enabled: false } }),
      WebhooksModule.forRoot({ worker: { enabled: false }, transport: new RecordingTransport() }),
    ],
  })(AppModule);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  await app.init();

  const endpoints = app.get(WebhookEndpoints);
  const webhooks = app.get(Webhooks);
  const outbox = app.get(OutboxStorage).messages;
  const created = await endpoints.create({ url: OLD_URL, eventTypes: ['*'] });
  Object.assign(state, { endpoints, id: created.id, oldSecret: created.secret });

  // Three events for the same endpoint. The worker claims them in one batch.
  for (let i = 1; i <= 3; i++) {
    await outbox.transaction((tx) => webhooks.dispatch(tx, { type: 'invoice.paid', data: { i } }));
  }
  await app.get(OutboxRelay).runOnce();
  await app.get(WebhookWorker).runOnce();

  const deliveries = await app.get(WebhookDeliveries).list({});
  await app.close();

  const lines = sent.map((request, i) => {
    const secrets = [
      signedWith(state.oldSecret, request) ? 'old' : null,
      state.newSecret && signedWith(state.newSecret, request) ? 'new' : null,
    ].filter(Boolean);
    return `  request ${i + 1}: ${request.url}, signed with the ${secrets.join(' and ')} secret`;
  });
  const statuses = deliveries.map((d) => d.status + (d.failureReason ? ` (${d.failureReason})` : ''));
  return { name, lines, statuses, ok: state.expect ? state.expect(sent, statuses) : true };
}

const SCENARIOS = {
  'No change (control)': null,
  'update(id, { enabled: false })': async (s) => {
    await s.endpoints.update(s.id, { enabled: false });
    s.expect = (sent) => sent.length === 1;
  },
  'delete(id)': async (s) => {
    await s.endpoints.delete(s.id);
    s.expect = (sent) => sent.length === 1;
  },
  'update(id, { url })': async (s) => {
    await s.endpoints.update(s.id, { url: NEW_URL });
    s.expect = (sent) => sent.slice(1).every((r) => r.url === NEW_URL);
  },
  'rotateSecret(id, { overlap: 0 })': async (s) => {
    s.newSecret = await s.endpoints.rotateSecret(s.id, { overlap: 0 });
    s.expect = (sent) => sent.slice(1).every((r) => !signedWith(s.oldSecret, r));
  },
};

const results = [];
for (const [name, change] of Object.entries(SCENARIOS)) {
  results.push(await run(name, change));
}
for (const r of results) {
  console.log(`=== ${r.name} during request 1 ===`);
  console.log(r.lines.join('\n'));
  console.log(`  deliveries: ${r.statuses.join(', ')}\n`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(
  failed === 0
    ? `RESULT: FIXED: each change applies to the requests after it, in all ${results.length - 1} scenarios.`
    : `RESULT: BUG: in ${failed} of ${results.length - 1} scenarios, requests 2 and 3 ignore the change.`,
);
process.exitCode = failed === 0 ? 0 : 1;
