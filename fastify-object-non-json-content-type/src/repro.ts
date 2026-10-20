import 'reflect-metadata';
import { get } from 'http';
import { Controller, Get, Header, Module, Res } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { FastifyAdapter } from '@nestjs/platform-fastify';

const BODY = { hello: 'world' };

@Controller()
class AppController {
  @Get('text-plain')
  @Header('Content-Type', 'text/plain')
  textPlain() {
    return BODY;
  }

  @Get('text-html')
  @Header('Content-Type', 'text/html')
  textHtml() {
    return BODY;
  }

  // The same object, with the Content-Type set on the response object.
  @Get('passthrough-header')
  passthroughHeader(@Res({ passthrough: true }) res: any) {
    res.header('Content-Type', 'text/plain');
    return BODY;
  }

  // Control: no Content-Type header, so the object is sent as JSON.
  @Get('no-header')
  noHeader() {
    return BODY;
  }
}

@Module({ controllers: [AppController] })
class AppModule {}

const ADAPTERS = {
  express: () => new ExpressAdapter(),
  fastify: () => new FastifyAdapter(),
};

// The media type that Express sends for each route. Express also sends
// `; charset=utf-8`, so only the part before the `;` is compared.
const ROUTES = {
  'text-plain': 'text/plain',
  'text-html': 'text/html',
  'passthrough-header': 'text/plain',
  'no-header': 'application/json',
};

const EXPECTED_BODY = JSON.stringify(BODY);

type AdapterName = keyof typeof ADAPTERS;
type RouteName = keyof typeof ROUTES;

const CASES = Object.keys(ADAPTERS).flatMap(adapter =>
  Object.keys(ROUTES).map(route => ({
    adapter: adapter as AdapterName,
    route: route as RouteName,
  })),
);

function request(url: string) {
  return new Promise<{ status: number; contentType?: string; body: string }>(
    (resolve, reject) => {
      get(url, response => {
        let body = '';
        response.on('data', chunk => (body += chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            contentType: response.headers['content-type'],
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
  const mediaType = response.contentType?.split(';')[0].trim();
  return {
    label: `${adapter}: ${route}`,
    ...response,
    expected,
    ok:
      response.status === 200 &&
      mediaType === expected &&
      response.body === EXPECTED_BODY,
  };
}

async function main() {
  const results = await CASES.reduce(
    async (done, testCase) => [...(await done), await runCase(testCase)],
    Promise.resolve([] as Awaited<ReturnType<typeof runCase>>[]),
  );
  results.forEach(({ label, status, contentType, expected, body }) => {
    console.log(`=== ${label} ===`);
    console.log(`  status:       HTTP ${status}`);
    console.log(`  content-type: ${JSON.stringify(contentType)}`);
    console.log(`  expected:     HTTP 200, ${JSON.stringify(expected)}`);
    console.log(`  body:         ${body}\n`);
  });
  const failed = results.filter(({ ok }) => !ok).length;
  console.log(
    failed === 0
      ? `RESULT: FIXED: all ${results.length} cases send the object with the Content-Type of the handler.`
      : `RESULT: BUG: ${failed} of ${results.length} cases did not send the object with the Content-Type of the handler.`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
