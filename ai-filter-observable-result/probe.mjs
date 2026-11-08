// Plain JavaScript, so the decorators are applied with Reflect.decorate().
import 'reflect-metadata';
import { Catch, ForbiddenException, Injectable, Module, UseFilters } from '@nestjs/common';
import { BaseRpcExceptionFilter } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { AgentFunction, AiModule, AiService } from '@nestjs/ai';
import { FakeModel, callTool } from '@nestjs/ai/testing';

// Five filters, each on one agent function that throws.
class ReturnsObject { catch() { return { refunded: false, reason: 'Not your order' }; } }
class Rethrows { catch() { throw new ForbiddenException('Not your order'); } }
class ReturnsThrowError { catch() { return throwError(() => new ForbiddenException('Not your order')); } }
class RpcFilter extends BaseRpcExceptionFilter {}
class ReturnsOf { catch() { return of({ refunded: false, reason: 'Not your order' }); } }
const filters = { ReturnsObject, Rethrows, ReturnsThrowError, RpcFilter, ReturnsOf };
const expected = {
  ReturnsObject: 'resolves {"refunded":false,"reason":"Not your order"}',
  Rethrows: 'rejects Not your order',
  ReturnsThrowError: 'rejects Not your order',
  RpcFilter: 'rejects',
  ReturnsOf: 'resolves {"refunded":false,"reason":"Not your order"}',
};

class Tools {}
for (const [name, filter] of Object.entries(filters)) {
  Reflect.decorate([Catch()], filter);
  Tools.prototype[name] = function () { throw new Error('The order belongs to another customer'); };
  const descriptor = Object.getOwnPropertyDescriptor(Tools.prototype, name);
  Reflect.decorate([AgentFunction({ name, description: `Refund, with the ${name} filter` }), UseFilters(filter)], Tools.prototype, name, descriptor);
}
Reflect.decorate([Injectable()], Tools);

const model = new FakeModel([
  { toolCalls: [{ name: 'ReturnsThrowError' }] },
  (call) => 'The model read: ' + JSON.stringify(call.toolResults),
]);
class AppModule {}
Reflect.decorate([Module({ imports: [AiModule.forRoot({ models: { default: model } })], providers: [Tools] })], AppModule);

const app = await Test.createTestingModule({ imports: [AppModule] }).compile();
app.useLogger(false);

let wrong = 0;
console.log('callTool() with each filter:');
for (const name of Object.keys(filters)) {
  let got;
  try { got = `resolves ${JSON.stringify(await callTool(app, name))}`; } catch (error) { got = `rejects ${error.message}`; }
  const ok = got.startsWith(expected[name]);
  if (!ok) wrong++;
  console.log(`  ${name.padEnd(18)} ${got.padEnd(55)} ${ok ? 'ok' : `expected: ${expected[name]}...`}`);
}

console.log('\ngenerateText() with the ReturnsThrowError filter:');
const { text } = await app.get(AiService).generateText({ prompt: 'Refund order 42', tools: ['ReturnsThrowError'] });
console.log(`  ${text}`);
await app.close();

console.log(wrong ? `\nRESULT: BUG: ${wrong} of 5 filters give a result that differs from what the filter answered.` : '\nRESULT: FIXED');
process.exitCode = wrong ? 1 : 0;
