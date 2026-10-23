import 'reflect-metadata';
import multipart from '@fastify/multipart';
import { Body, ConsoleLogger, Controller, type INestApplication, Module, Post, Req, UseInterceptors } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IdempotencyModule, Idempotent } from '@nestjs/idempotency';
import { FileInterceptor } from '@nestjs/platform-express';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Request } from 'express';
import type { FastifyRequest } from 'fastify';

let runs = 0;

// Counts the warnings that Nest logs after startup.
class WarningLogger extends ConsoleLogger {
  static started = false;
  static warnings: string[] = [];
  override log() {}
  override warn(message: unknown) {
    if (WarningLogger.started) WarningLogger.warnings.push(String(message));
  }
}

@Controller('express')
class ExpressController {
  @Post('upload')
  @Idempotent()
  @UseInterceptors(FileInterceptor('file'))
  upload(@Req() req: Request) {
    runs++;
    return { note: req.body.note, file: req.file?.buffer.toString() };
  }

  @Post('json')
  @Idempotent()
  json(@Body() body: unknown) {
    runs++;
    return { body };
  }
}

@Controller('fastify')
class FastifyController {
  // Reads the parts in the handler, as the @fastify/multipart README shows.
  @Post('upload')
  @Idempotent()
  async upload(@Req() req: FastifyRequest) {
    runs++;
    const fields: Record<string, string> = {};
    if (!req.body) {
      for await (const part of req.parts()) {
        fields[part.fieldname] = part.type === 'file' ? (await part.toBuffer()).toString() : String(part.value);
      }
    } else {
      // attachFieldsToBody: the fields are on req.body before the interceptor runs.
      for (const [name, value] of Object.entries(req.body as Record<string, unknown>)) {
        fields[name] = Buffer.isBuffer(value) ? value.toString() : String(value);
      }
    }
    return fields;
  }
}

@Module({ imports: [IdempotencyModule.forRoot()], controllers: [ExpressController] })
class ExpressModule {}

@Module({ imports: [IdempotencyModule.forRoot()], controllers: [FastifyController] })
class FastifyModule {}

const form = (note: string, file: string) => {
  const body = new FormData();
  body.append('note', note);
  body.append('file', new Blob([file]), 'receipt.txt');
  return body;
};

// Sends two requests with the same Idempotency-Key, and prints both answers.
const pair = async (app: INestApplication, label: string, path: string, first: BodyInit, second: BodyInit, json = false) => {
  const url = (await app.getUrl()) + path;
  const key = `key-${label.replace(/\W+/g, '-')}`;
  const headers: Record<string, string> = { 'Idempotency-Key': key, ...(json ? { 'content-type': 'application/json' } : {}) };
  console.log(`  ${label}`);
  const runsBefore = runs;
  for (const [name, body] of [['first ', first], ['second', second]] as const) {
    const response = await fetch(url, { method: 'POST', headers, body });
    console.log(`    ${name} ${response.status} ${(await response.text()).slice(0, 90)}`);
  }
  console.log(`    handler runs: ${runs - runsBefore}`);
  return runs - runsBefore;
};

const replays: string[] = [];
const check = (label: string, handlerRuns: number) => {
  if (handlerRuns === 1) replays.push(label);
};

const start = async (app: INestApplication) => {
  await app.listen(0, '127.0.0.1');
  WarningLogger.started = true;
};

console.log('=== Express, FileInterceptor ===');
WarningLogger.started = false;
const express = await NestFactory.create(ExpressModule, { logger: new WarningLogger() });
await start(express);
check('Express, other text field', await pair(express, 'other text field', '/express/upload', form('first', 'same file'), form('second', 'same file')));
check('Express, other file', await pair(express, 'other file', '/express/upload', form('same', 'file one'), form('same', 'file two')));
await pair(express, 'JSON body (control)', '/express/json', JSON.stringify({ a: 1 }), JSON.stringify({ a: 2 }), true);
await express.close();

console.log('\n=== Fastify, req.parts() in the handler ===');
WarningLogger.started = false;
const fastify = await NestFactory.create<NestFastifyApplication>(FastifyModule, new FastifyAdapter(), { logger: new WarningLogger() });
await fastify.register(multipart);
await start(fastify);
check('Fastify, other text field', await pair(fastify, 'other text field', '/fastify/upload', form('first', 'same file'), form('second', 'same file')));
check('Fastify, other file', await pair(fastify, 'other file', '/fastify/upload', form('same', 'file one'), form('same', 'file two')));
await fastify.close();

console.log("\n=== Fastify, attachFieldsToBody: 'keyValues' (control) ===");
WarningLogger.started = false;
const attached = await NestFactory.create<NestFastifyApplication>(FastifyModule, new FastifyAdapter(), { logger: new WarningLogger() });
await attached.register(multipart, {
  attachFieldsToBody: 'keyValues',
  onFile: async (part) => {
    (part as unknown as { value: Buffer }).value = await part.toBuffer();
  },
});
await start(attached);
await pair(attached, 'other text field', '/fastify/upload', form('first', 'same file'), form('second', 'same file'));
await attached.close();

console.log(`\nwarnings logged while the apps ran: ${WarningLogger.warnings.length}`);
for (const warning of WarningLogger.warnings) console.log(`  ${warning}`);

const silent = replays.length > 0 && WarningLogger.warnings.length === 0;
console.log(
  silent
    ? `\nRESULT: BUG: ${replays.length} multipart retries with other content got the first answer, and nothing was logged.`
    : `\nRESULT: ${replays.length} multipart retries got the first answer, and ${WarningLogger.warnings.length} warnings were logged.`,
);
process.exitCode = silent ? 1 : 0;
