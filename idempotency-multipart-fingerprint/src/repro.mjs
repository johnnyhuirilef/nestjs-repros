import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { Body, Controller, Module, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FileInterceptor } from '@nestjs/platform-express';
import { IdempotencyModule, Idempotent } from '@nestjs/idempotency';

const calls = { payments: 0, uploads: 0, digestUploads: 0 };
const sha256 = (data) => createHash('sha256').update(data).digest('hex').slice(0, 12);

// Plain ESM has no decorator syntax, so the decorators are applied by hand.
function route(Target, method, decorators, params = []) {
  const descriptor = Object.getOwnPropertyDescriptor(Target.prototype, method);
  for (const decorate of decorators) decorate(Target.prototype, method, descriptor);
  params.forEach((decorate, index) => decorate(Target.prototype, method, index));
}

class PaymentsController {
  pay(body) {
    calls.payments++;
    return { amount: body.amount };
  }
}
route(PaymentsController, 'pay', [Post(), Idempotent()], [Body()]);
Controller('payments')(PaymentsController);

class UploadsController {
  upload(file) {
    calls.uploads++;
    return { file: sha256(file.buffer) };
  }
}
route(UploadsController, 'upload', [Post(), Idempotent(), UseInterceptors(FileInterceptor('file'))], [UploadedFile()]);
Controller('uploads')(UploadsController);

class DigestUploadsController {
  upload(file) {
    calls.digestUploads++;
    return { file: sha256(file.buffer) };
  }
}
route(
  DigestUploadsController,
  'upload',
  [
    Post(),
    Idempotent({ fingerprint: (_body, context) => context.switchToHttp().getRequest().headers['content-digest'] }),
    UseInterceptors(FileInterceptor('file')),
  ],
  [UploadedFile()],
);
Controller('digest-uploads')(DigestUploadsController);

class AppModule {}
Module({
  imports: [IdempotencyModule.forRoot()],
  controllers: [PaymentsController, UploadsController, DigestUploadsController],
})(AppModule);

const contentDigest = (text) => `sha-256=:${createHash('sha256').update(text).digest('base64')}:`;

function json(key, amount) {
  return {
    headers: { 'idempotency-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ amount }),
  };
}

function multipart(key, text, withDigest) {
  const body = new FormData();
  body.append('file', new Blob([text]), 'invoice.txt');
  const headers = { 'idempotency-key': key };
  if (withDigest) headers['content-digest'] = contentDigest(text);
  return { headers, body };
}

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  await app.listen(0);
  const base = await app.getUrl();

  const send = async (path, init) => {
    const res = await fetch(`${base}${path}`, { method: 'POST', ...init });
    const replayed = res.headers.get('idempotent-replayed') === 'true';
    const text = await res.text();
    // The full 422 body is long, and its code is all the comparison needs.
    const body = JSON.parse(text).code ?? text;
    return { status: res.status, replayed, body };
  };

  const scenarios = [
    {
      name: 'JSON body, same key, different amount (control)',
      path: '/payments',
      first: json('key-1', 10),
      second: json('key-1', 99),
      counter: 'payments',
    },
    {
      name: 'multipart upload, same key, different file',
      path: '/uploads',
      first: multipart('key-2', 'first file', false),
      second: multipart('key-2', 'second file', false),
      counter: 'uploads',
    },
    {
      name: 'multipart upload with a Content-Digest fingerprint, same key, different file',
      path: '/digest-uploads',
      first: multipart('key-3', 'first file', true),
      second: multipart('key-3', 'second file', true),
      counter: 'digestUploads',
    },
  ];

  let failed = 0;
  for (const s of scenarios) {
    const first = await send(s.path, s.first);
    const second = await send(s.path, s.second);
    const ok = second.status === 422 && calls[s.counter] === 1;
    if (!ok) failed++;
    console.log(`=== ${s.name} ===`);
    console.log(`  first request:   ${first.status} ${first.body}`);
    console.log(`  second request:  ${second.status}${second.replayed ? ' (Idempotent-Replayed: true)' : ''} ${second.body}`);
    console.log(`  handler calls:   ${calls[s.counter]}`);
    console.log(`  expected:        second request 422 IDEMPOTENCY_KEY_REUSED\n`);
  }

  await app.close();
  console.log(
    failed === 0
      ? `RESULT: FIXED: a different body gets a 422 in all ${scenarios.length} scenarios.`
      : `RESULT: BUG: a different body is replayed in ${failed} of ${scenarios.length} scenarios.`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
