import 'reflect-metadata';
import { get } from 'http';
import { Controller, Get, Module, Redirect } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { FastifyAdapter } from '@nestjs/platform-fastify';

@Controller()
class AppController {
  @Get('non-ascii')
  @Redirect('/文档')
  nonAscii() {}

  @Get('dynamic-non-ascii')
  @Redirect()
  dynamicNonAscii() {
    return { url: '/文档' };
  }

  @Get('space-and-query')
  @Redirect('/a b?q=ü')
  spaceAndQuery() {}

  // Already encoded: a fix must not encode the `%` a second time.
  @Get('already-encoded')
  @Redirect('/%E6%96%87%E6%A1%A3')
  alreadyEncoded() {}
}

@Module({ controllers: [AppController] })
class AppModule {}

const ADAPTERS = {
  express: () => new ExpressAdapter(),
  fastify: () => new FastifyAdapter(),
};

// The Location header that Express sends for each route.
const ROUTES = {
  'non-ascii': '/%E6%96%87%E6%A1%A3',
  'dynamic-non-ascii': '/%E6%96%87%E6%A1%A3',
  'space-and-query': '/a%20b?q=%C3%BC',
  'already-encoded': '/%E6%96%87%E6%A1%A3',
};

type AdapterName = keyof typeof ADAPTERS;
type RouteName = keyof typeof ROUTES;

const CASES = Object.keys(ADAPTERS).flatMap(adapter =>
  Object.keys(ROUTES).map(route => ({
    adapter: adapter as AdapterName,
    route: route as RouteName,
  })),
);

// A plain HTTP request does not follow the redirect, so it shows the status,
// the Location header and the body as the server sent them.
function request(url: string) {
  return new Promise<{ status: number; location?: string; body: string }>(
    (resolve, reject) => {
      get(url, response => {
        let body = '';
        response.on('data', chunk => (body += chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            location: response.headers.location,
            body,
          }),
        );
      }).on('error', reject);
    },
  );
}

async function runCase({ adapter, route }: (typeof CASES)[number]) {
  const app = await NestFactory.create(AppModule, ADAPTERS[adapter](), {
    logger: false,
  });
  await app.listen(0, '127.0.0.1');
  const response = await request(`${await app.getUrl()}/${route}`);
  await app.close();
  const expected = ROUTES[route];
  return {
    label: `${adapter}: ${route}`,
    ...response,
    expected,
    ok: response.status === 302 && response.location === expected,
  };
}

async function main() {
  const results = await CASES.reduce(
    async (done, testCase) => [...(await done), await runCase(testCase)],
    Promise.resolve([] as Awaited<ReturnType<typeof runCase>>[]),
  );
  results.forEach(({ label, status, location, expected, body }) => {
    console.log(`=== ${label} ===`);
    console.log(`  status:   HTTP ${status}`);
    console.log(`  location: ${JSON.stringify(location)}`);
    console.log(`  expected: ${JSON.stringify(expected)}`);
    console.log(status === 302 ? '' : `  body:     ${body}\n`);
  });
  const failed = results.filter(({ ok }) => !ok).length;
  console.log(
    failed === 0
      ? `RESULT: FIXED: all ${results.length} cases redirect with an encoded Location header.`
      : `RESULT: BUG: ${failed} of ${results.length} cases failed or sent an unencoded Location header.`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
