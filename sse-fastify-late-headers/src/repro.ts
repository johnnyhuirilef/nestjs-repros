import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { AppModule, HEADERS } from './app';

/**
 * On an @Sse() route, a header that an interceptor or the handler sets on the
 * reply (with @Res({ passthrough: true })) should reach the client, as it does
 * on a normal route and on Express. On the Fastify adapter it does not: the SSE
 * response copies the reply headers once, before the interceptors run on
 * subscribe, and writes only that copy.
 *
 * The same app runs on Express and on Fastify. For each adapter and route, a
 * real HTTP client prints the headers it receives. For an SSE route it reads the
 * first event and then aborts. No broker is needed.
 *
 *   npm run repro
 */
const ADAPTERS = {
  express: () => new ExpressAdapter(),
  fastify: () => new FastifyAdapter(),
} as const;
const ROUTES = ['plain', 'sse'] as const;
const CHECKED = Object.values(HEADERS);

async function receivedHeaders(baseUrl: string, route: string) {
  const abort = new AbortController();
  const response = await fetch(`${baseUrl}/${route}`, { signal: abort.signal });
  await response.body!.getReader().read();
  abort.abort();
  return CHECKED.filter(name => response.headers.has(name));
}

async function runAdapter(name: keyof typeof ADAPTERS): Promise<number> {
  const app = await NestFactory.create(AppModule, ADAPTERS[name](), { logger: false });
  await app.listen(0, '127.0.0.1');
  const baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');

  let failed = 0;
  for (const route of ROUTES) {
    const received = await receivedHeaders(baseUrl, route);
    const missing = CHECKED.filter(header => !received.includes(header));
    console.log(`=== ${name}: ${route} route ===`);
    console.log(`  expected: ${CHECKED.join(', ')}`);
    console.log(`  received: ${received.join(', ') || '(none)'}`);
    console.log(`  outcome:  ${missing.length ? `missing ${missing.join(', ')}` : 'as expected'}`);
    console.log('');
    failed += missing.length ? 1 : 0;
  }

  await app.close();
  return failed;
}

async function main() {
  let failed = 0;
  for (const name of Object.keys(ADAPTERS) as (keyof typeof ADAPTERS)[]) {
    failed += await runAdapter(name);
  }
  const total = Object.keys(ADAPTERS).length * ROUTES.length;
  if (failed) {
    console.log(`RESULT: BUG: ${failed} of ${total} cases did not end as expected (headers set by an interceptor or a handler are dropped on an @Sse() route on Fastify).`);
    process.exit(1);
  }
  console.log(`RESULT: FIXED: all ${total} cases carry the decorator, interceptor and handler headers.`);
  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(2);
});
