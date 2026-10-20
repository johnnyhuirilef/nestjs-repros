import 'reflect-metadata';
import { request as httpRequest } from 'http';
import fastifyCors from '@fastify/cors';
import {
  Controller,
  Get,
  INestApplication,
  Injectable,
  MiddlewareConsumer,
  Module,
  NestMiddleware,
  NestModule,
  UnauthorizedException,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { FastifyAdapter } from '@nestjs/platform-fastify';

const ORIGIN = 'http://client.test';

@Injectable()
class ThrowingMiddleware implements NestMiddleware {
  use() {
    throw new UnauthorizedException();
  }
}

@Controller()
class AppController {
  @Get('ok')
  ok() {
    return { ok: true };
  }

  @Get('throw')
  throws() {
    return { ok: true };
  }

  @Get('next-error')
  nextError() {
    return { ok: true };
  }
}

@Module({ controllers: [AppController] })
class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ThrowingMiddleware).forRoutes('throw');
    // The same error, passed to next() instead of thrown.
    consumer
      .apply((_req: unknown, _res: unknown, next: (err?: unknown) => void) =>
        next(new UnauthorizedException()),
      )
      .forRoutes('next-error');
  }
}

const SETUPS: Record<string, () => Promise<INestApplication>> = {
  // The documented way: app.enableCors() in main.ts.
  'express (enableCors)': async () => {
    const app = await NestFactory.create(AppModule, new ExpressAdapter(), {
      logger: false,
    });
    app.enableCors({ origin: '*' });
    return app;
  },
  'fastify (enableCors)': async () => {
    const app = await NestFactory.create(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    app.enableCors({ origin: '*' });
    return app;
  },
  // @fastify/cors registered on the Fastify instance before
  // NestFactory.create(), so that its hook runs before Nest middleware.
  'fastify (cors before middleware)': async () => {
    const adapter = new FastifyAdapter();
    adapter.getInstance().register(fastifyCors, { origin: '*' });
    return NestFactory.create(AppModule, adapter, { logger: false });
  },
};

// The status and the Access-Control-Allow-Origin header that Express sends
// for each request.
const REQUESTS = {
  'GET /ok': { method: 'GET', path: '/ok', status: 200, allowOrigin: '*' },
  'GET /throw': { method: 'GET', path: '/throw', status: 401, allowOrigin: '*' },
  'GET /next-error': {
    method: 'GET',
    path: '/next-error',
    status: 401,
    allowOrigin: '*',
  },
  // A CORS preflight for the route whose middleware throws.
  'OPTIONS /throw': {
    method: 'OPTIONS',
    path: '/throw',
    status: 204,
    allowOrigin: '*',
  },
};

type RequestName = keyof typeof REQUESTS;

const CASES = Object.keys(SETUPS).flatMap(setup =>
  Object.keys(REQUESTS).map(name => ({ setup, name: name as RequestName })),
);

function send(url: string, method: string) {
  return new Promise<{ status: number; allowOrigin?: string; body: string }>(
    (resolve, reject) => {
      const req = httpRequest(
        url,
        {
          method,
          headers: {
            Origin: ORIGIN,
            ...(method === 'OPTIONS' && {
              'Access-Control-Request-Method': 'GET',
            }),
          },
        },
        response => {
          let body = '';
          response.on('data', chunk => (body += chunk));
          response.on('end', () =>
            resolve({
              status: response.statusCode ?? 0,
              allowOrigin: response.headers['access-control-allow-origin'] as
                | string
                | undefined,
              body,
            }),
          );
        },
      );
      req.on('error', reject);
      req.end();
    },
  );
}

async function runCase({ setup, name }: (typeof CASES)[number]) {
  const app = await SETUPS[setup]();
  await app.listen(0, '127.0.0.1');
  const { method, path, status, allowOrigin } = REQUESTS[name];
  const response = await send(`${await app.getUrl()}${path}`, method);
  await app.close();
  return {
    label: `${setup}: ${name}`,
    ...response,
    expected: { status, allowOrigin },
    ok: response.status === status && response.allowOrigin === allowOrigin,
  };
}

async function main() {
  const results = await CASES.reduce(
    async (done, testCase) => [...(await done), await runCase(testCase)],
    Promise.resolve([] as Awaited<ReturnType<typeof runCase>>[]),
  );
  results.forEach(({ label, status, allowOrigin, expected, body }) => {
    console.log(`=== ${label} ===`);
    console.log(`  status:                      HTTP ${status}`);
    console.log(
      `  access-control-allow-origin: ${JSON.stringify(allowOrigin)}`,
    );
    console.log(
      `  expected:                    HTTP ${expected.status}, ${JSON.stringify(expected.allowOrigin)}`,
    );
    console.log(`  body:                        ${body}\n`);
  });
  const failed = results.filter(({ ok }) => !ok).length;
  console.log(
    failed === 0
      ? `RESULT: FIXED: all ${results.length} responses match Express.`
      : `RESULT: BUG: ${failed} of ${results.length} responses do not match Express.`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
