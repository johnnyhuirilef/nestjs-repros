import 'reflect-metadata';
import { Controller, Get, Module, Res } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { FastifyAdapter } from '@nestjs/platform-fastify';

@Controller()
class AppController {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  // A middleware already wrote `session=abc` on the raw response.
  @Get('after-middleware-cookie')
  afterMiddlewareCookie(@Res({ passthrough: true }) res: unknown) {
    this.adapterHost.httpAdapter.setCookie(res, 'theme', 'dark');
    return {};
  }

  // A middleware already called the helpers on the raw response.
  @Get('from-middleware')
  fromMiddleware() {
    return {};
  }
}

@Module({ controllers: [AppController] })
class AppModule {}

const ADAPTERS = {
  express: () => new ExpressAdapter(),
  fastify: () => new FastifyAdapter(),
};

const ROUTES = {
  'after-middleware-cookie': ['session=abc', 'theme=dark; Path=/'],
  'from-middleware': ['c=d; Path=/'],
};

type AdapterName = keyof typeof ADAPTERS;
type RouteName = keyof typeof ROUTES;

const CASES = Object.keys(ADAPTERS).flatMap(adapter =>
  Object.keys(ROUTES).map(route => ({
    adapter: adapter as AdapterName,
    route: route as RouteName,
  })),
);

async function createApp(adapter: AdapterName) {
  const app = await NestFactory.create(AppModule, ADAPTERS[adapter](), {
    logger: false,
  });
  const { httpAdapter } = app.get(HttpAdapterHost);
  app.use((req: { url: string }, res: unknown, next: () => void) => {
    if (req.url === '/after-middleware-cookie') {
      (res as { setHeader(name: string, value: string): void }).setHeader(
        'Set-Cookie',
        'session=abc',
      );
    }
    if (req.url === '/from-middleware') {
      httpAdapter.setCookie(res, 'c', 'd');
    }
    next();
  });
  await app.listen(0, '127.0.0.1');
  return app;
}

async function runCase({ adapter, route }: (typeof CASES)[number]) {
  const app = await createApp(adapter);
  const response = await fetch(`${await app.getUrl()}/${route}`);
  await app.close();
  const cookies = response.headers.getSetCookie();
  const expected = ROUTES[route];
  return {
    label: `${adapter}: ${route}`,
    status: response.status,
    cookies,
    ok:
      response.status === 200 &&
      JSON.stringify(cookies) === JSON.stringify(expected),
    expected,
  };
}

async function main() {
  const results = await CASES.reduce(
    async (done, testCase) => [...(await done), await runCase(testCase)],
    Promise.resolve([] as Awaited<ReturnType<typeof runCase>>[]),
  );
  results.forEach(({ label, status, cookies, expected }) => {
    console.log(`=== ${label} ===`);
    console.log(`  status:     HTTP ${status}`);
    console.log(`  set-cookie: ${JSON.stringify(cookies)}`);
    console.log(`  expected:   ${JSON.stringify(expected)}\n`);
  });
  const failed = results.filter(({ ok }) => !ok).length;
  console.log(
    failed === 0
      ? `RESULT: FIXED: all ${results.length} cases send every cookie.`
      : `RESULT: BUG: ${failed} of ${results.length} cases lost a cookie or failed.`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
