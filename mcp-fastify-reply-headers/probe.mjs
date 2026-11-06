// On Fastify, the MCP endpoint answers through `reply.hijack()` and writes the raw response with the SDK's headers
// only. Headers that the app set on the reply before (an interceptor, an `onRequest` hook, `@fastify/cors`) are not
// sent. The script sends `tools/list` to `/mcp` and a GET to a normal route, and prints the header each one has.
import 'reflect-metadata';
import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { McpModule, Tool } from '@nestjs/mcp';
import fastifyCors from '@fastify/cors';

const origin = 'https://support.catstore.example';

class Tools {
  add() {
    return 'ok';
  }
}
Tool({ description: 'Adds' })(Tools.prototype, 'add', Object.getOwnPropertyDescriptor(Tools.prototype, 'add'));
Injectable()(Tools);

class Health {
  ping() {
    return { ok: true };
  }
}
Get('ping')(Health.prototype, 'ping', Object.getOwnPropertyDescriptor(Health.prototype, 'ping'));
Controller()(Health);

class AppModule {}
Module({
  imports: [McpModule.forRoot({ name: 'shop', version: '1.0.0', http: { allowedOrigins: ['support.catstore.example'] } })],
  providers: [Tools],
  controllers: [Health],
})(AppModule);

/** Sets a request id on every response, as many apps do. */
class RequestIdInterceptor {
  intercept(context, next) {
    context.switchToHttp().getResponse().header('x-request-id', 'req-1');
    return next.handle();
  }
}

const cases = [
  ['express', 'a global interceptor sets x-request-id (control)', 'x-request-id', (app) => app.useGlobalInterceptors(new RequestIdInterceptor())],
  ['fastify', 'a global interceptor sets x-request-id', 'x-request-id', (app) => app.useGlobalInterceptors(new RequestIdInterceptor())],
  [
    'fastify',
    "an onRequest hook sets x-request-id with reply.header()",
    'x-request-id',
    (app) => app.getHttpAdapter().getInstance().addHook('onRequest', async (request, reply) => void reply.header('x-request-id', 'req-1')),
  ],
  ['fastify', 'app.register(@fastify/cors)', 'access-control-allow-origin', (app) => app.register(fastifyCors, { origin: [origin] })],
];

let lost = 0;
for (const [platform, setup, header, apply] of cases) {
  const app = await NestFactory.create(AppModule, platform === 'fastify' ? new FastifyAdapter() : new ExpressAdapter(), { logger: false });
  await apply(app);
  await app.listen(0, '127.0.0.1');
  const url = (await app.getUrl()).replace('[::1]', '127.0.0.1');

  const ping = await fetch(`${url}/ping`, { headers: { origin } });
  const mcp = await fetch(`${url}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
      origin,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const listed = (await mcp.text()).includes('"add"');
  console.log(`=== ${platform}: ${setup} ===`);
  console.log(`  GET /ping:  ${ping.status}, ${header}: ${ping.headers.get(header)}`);
  console.log(`  POST /mcp:  ${mcp.status}, ${header}: ${mcp.headers.get(header)}, tool listed: ${listed}`);
  console.log();
  if (ping.headers.get(header) && !mcp.headers.get(header)) lost++;
  await app.close();
}

if (lost > 0) {
  console.log(`RESULT: BUG: /mcp misses a header that the same app sends on its other routes, in ${lost} of ${cases.length} cases.`);
  process.exitCode = 1;
} else {
  console.log('RESULT: FIXED: /mcp has the same headers as the other routes.');
}
