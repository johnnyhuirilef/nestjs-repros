// A tool with an `outputSchema` gets the returned value as `structuredContent` "validated against
// the schema", and as a JSON text block. The value is validated before it is turned into JSON,
// so a `Date`, or an object with `toJSON()`, fails although its JSON matches the schema.
import 'reflect-metadata';
import { Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { McpModule, Tool } from '@nestjs/mcp';
import { z } from 'zod';

class Money {
  constructor(cents) {
    this.cents = cents;
  }
  toJSON() {
    return `${(this.cents / 100).toFixed(2)} EUR`;
  }
}
class Order {
  constructor() {
    this.id = 'o1';
    this.placedAt = new Date('2026-11-04T10:00:00.000Z');
    this.total = new Money(1999);
  }
}

class OrdersTools {
  plain() {
    return { id: 'o1', placedAt: '2026-11-04T10:00:00.000Z', total: '19.99 EUR' };
  }
  entity() {
    return new Order();
  }
}
const outputSchema = z.object({ id: z.string(), placedAt: z.iso.datetime(), total: z.string() });
for (const name of ['plain', 'entity']) {
  Tool({ name: `order-${name}`, description: 'Find an order', outputSchema })(
    OrdersTools.prototype,
    name,
    Object.getOwnPropertyDescriptor(OrdersTools.prototype, name),
  );
}
Injectable()(OrdersTools);
class AppModule {}
Module({ imports: [McpModule.forRoot({ name: 'shop', version: '1.0.0' })], providers: [OrdersTools] })(AppModule);

const app = await NestFactory.create(AppModule, { logger: false });
await app.listen(0, '127.0.0.1');
const url = (await app.getUrl()).replace('[::1]', '127.0.0.1');

async function call(name) {
  const res = await fetch(`${url}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } }),
  });
  const text = await res.text();
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)).result;
}

console.log("=== returns { id, placedAt: '2026-11-04T10:00:00.000Z', total: '19.99 EUR' } (control) ===");
const plain = await call('order-plain');
console.log(`  isError: ${plain.isError ?? false}`);
console.log(`  structuredContent: ${JSON.stringify(plain.structuredContent)}`);
console.log();
console.log('=== returns new Order(): placedAt is a Date, total has toJSON() ===');
console.log(`  JSON.stringify(new Order()): ${JSON.stringify(new Order())}`);
console.log(`  matches outputSchema: ${outputSchema.safeParse(JSON.parse(JSON.stringify(new Order()))).success}`);
const entity = await call('order-entity');
console.log(`  isError: ${entity.isError ?? false}`);
console.log(`  text: ${entity.content[0].text}`);
console.log();
await app.close();

if (!plain.structuredContent) {
  console.log('RESULT: the control failed, so the script cannot tell.');
  process.exitCode = 2;
} else if (entity.isError) {
  console.log('RESULT: BUG: a value whose JSON matches the outputSchema fails the output validation.');
  process.exitCode = 1;
} else {
  console.log('RESULT: FIXED: the value is validated as the JSON that the client gets.');
}
