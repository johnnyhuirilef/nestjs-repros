// The docs of @nestjs/authorization say that "At startup, the module logs every handler it will deny this way"
// (a handler without @Can()). With @nestjs/mcp, set up as its docs say, a tool, a resource and a prompt without
// @Can() are denied at runtime, but the startup log leaves them out. The script starts the app, prints that log,
// then calls each handler over HTTP.
import 'reflect-metadata';
import { Controller, Get, Injectable, Module, ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { McpModule, Tool, Resource, Prompt } from '@nestjs/mcp';
import { AuthorizationModule, Policy, Can } from '@nestjs/authorization';
import { Public } from '@nestjs/authentication';

const logs = [];
class Capture extends ConsoleLogger {
  error(message, ...rest) { logs.push(String(message)); }
  warn(message, ...rest) { logs.push(String(message)); }
  log() {}
}

class StaffPolicy { manage(user) { return user?.role === 'staff'; } }
Policy()(StaffPolicy);

const dec = (proto, key, ...ds) => { const d = Object.getOwnPropertyDescriptor(proto, key); for (const f of ds) f(proto, key, d); };

class OrdersController { list() { return []; } forgottenRoute() { return []; } }
dec(OrdersController.prototype, 'list', Get(), Can(StaffPolicy, 'manage'));
dec(OrdersController.prototype, 'forgottenRoute', Get('forgotten'));
Controller('orders')(OrdersController);

class OrdersTools {
  refund() { return 'refunded'; }
  forgottenTool() { return 'ran'; }
  forgottenResource() { return { contents: [{ uri: 'orders://all', text: '[]' }] }; }
  forgottenPrompt() { return { messages: [] }; }
}
dec(OrdersTools.prototype, 'refund', Tool({ description: 'Refund an order' }), Can(StaffPolicy, 'manage'));
dec(OrdersTools.prototype, 'forgottenTool', Tool({ name: 'forgotten-tool', description: 'No @Can()' }));
dec(OrdersTools.prototype, 'forgottenResource', Resource({ uri: 'orders://all', name: 'orders' }));
dec(OrdersTools.prototype, 'forgottenPrompt', Prompt({ name: 'forgotten-prompt' }));
Injectable()(OrdersTools);

class AppModule {}
Module({
  imports: [AuthorizationModule.forRoot({ policies: [StaffPolicy] }), McpModule.forRoot({ name: 'shop', version: '1.0.0', decorators: [Public()] })],
  controllers: [OrdersController],
  providers: [OrdersTools],
})(AppModule);

const app = await NestFactory.create(AppModule, { logger: new Capture() });
await app.listen(0, '127.0.0.1');
const url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
async function rpc(method, params) {
  const res = await fetch(`${url}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const text = await res.text();
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
}
const calls = [
  ['tools/call forgotten-tool', await rpc('tools/call', { name: 'forgotten-tool', arguments: {} })],
  ['resources/read orders://all', await rpc('resources/read', { uri: 'orders://all' })],
  ['prompts/get forgotten-prompt', await rpc('prompts/get', { name: 'forgotten-prompt' })],
];
const routeStatus = (await fetch(`${url}/orders/forgotten`)).status;
await app.close();

const log = logs.find((l) => l.includes('forgottenRoute')) ?? '(no log names the handlers without @Can())';
console.log('=== the startup log about handlers without @Can() ===');
console.log(log);
console.log();
const named = (name) => log.includes(name);
for (const h of ['OrdersController.forgottenRoute', 'OrdersTools.forgottenTool', 'OrdersTools.forgottenResource', 'OrdersTools.forgottenPrompt']) {
  console.log(`  names ${h}: ${named(h)}`);
}
console.log();
console.log('=== the same handlers at runtime ===');
console.log(`  GET /orders/forgotten: ${routeStatus}`);
for (const [what, r] of calls) {
  console.log(`  ${what}: ${r.error ? `error ${r.error.message}` : r.result.isError ? `tool error ${r.result.content[0].text}` : 'allowed'}`);
}
console.log();
if (!named('OrdersController.forgottenRoute')) {
  console.log('RESULT: the control failed, so the script cannot tell.');
  process.exitCode = 2;
} else if (!named('OrdersTools.forgottenTool')) {
  console.log('RESULT: BUG: the startup log leaves out the MCP tool, resource and prompt without @Can().');
  process.exitCode = 1;
} else {
  console.log('RESULT: FIXED: the startup log names the MCP primitives without @Can().');
}
