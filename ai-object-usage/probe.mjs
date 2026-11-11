// Plain JavaScript, so the decorators are applied with Reflect.decorate().
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AiModule, AiService } from '@nestjs/ai';
import { FakeModel } from '@nestjs/ai/testing';
import * as z from 'zod';

const Invoice = z.object({ number: z.string(), total: z.number() });

// The model answers three times: a valid object, an object with a number where the schema wants a string, and text.
const model = new FakeModel([{ object: { number: 'INV-7', total: 4200 } }, { object: { number: 7, total: 4200 } }, 'Sure! Here it is.']);
const events = [];
class AppModule {}
Reflect.decorate([Module({
  imports: [AiModule.forRoot({ models: { default: model }, onUsage: (event) => void events.push(event) })],
})], AppModule);

const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
const ai = app.get(AiService);

const results = [];
for (const label of ['Valid object (control)', 'Object that does not match the schema', 'Answer that is not JSON']) {
  const before = events.length;
  const outcome = await ai.generateObject({ schema: Invoice, prompt: 'Extract the invoice' }).then(
    ({ usage }) => `answered, usage.totalTokens ${usage.totalTokens}`,
    (error) => `rejected (${error.name})`,
  );
  const emitted = events.slice(before);
  results.push(emitted.length);
  const tokens = emitted.map((event) => event.usage.totalTokens).join(', ');
  console.log(`${label.padEnd(40)} ${outcome}, onUsage called ${emitted.length} time(s)${tokens ? ` (totalTokens ${tokens})` : ''}`);
}
await app.close();

console.log(`\nModel calls: ${model.calls.length}. Usage events: ${events.length}.\n`);
const fixed = results.every((count) => count === 1);
console.log(fixed
  ? 'RESULT: FIXED'
  : 'RESULT: BUG: a generateObject() call that fails the schema check emits no usage event, although the model answered.');
process.exitCode = fixed ? 0 : 1;
