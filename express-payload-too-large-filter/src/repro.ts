import 'reflect-metadata';
import { request as httpRequest } from 'http';
import {
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  INestApplication,
  Module,
  Post,
} from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { FastifyAdapter } from '@nestjs/platform-fastify';

// The "Catch everything" filter of the docs
// (https://docs.nestjs.com/exception-filters#catch-everything). It also sets
// `x-filter`, so that the script can see that the filter answered, and
// reports what it received.
@Catch()
class CatchEverythingFilter implements ExceptionFilter {
  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const { httpAdapter } = this.httpAdapterHost;
    const response = host.switchToHttp().getResponse();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    httpAdapter.setHeader(response, 'x-filter', 'catch-everything');
    httpAdapter.reply(response, { statusCode: status, received: name(exception) }, status);
  }
}

@Catch(HttpException)
class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: HttpException, host: ArgumentsHost) {
    const { httpAdapter } = this.httpAdapterHost;
    const response = host.switchToHttp().getResponse();
    const status = exception.getStatus();
    httpAdapter.setHeader(response, 'x-filter', 'http-exception');
    httpAdapter.reply(response, { statusCode: status, received: name(exception) }, status);
  }
}

function name(exception: unknown) {
  return (exception as object)?.constructor?.name;
}

@Controller()
class AppController {
  @Post('items')
  create(@Body() body: unknown) {
    return { ok: true, body };
  }
}

@Module({ controllers: [AppController] })
class AppModule {}

const ADAPTERS = {
  express: () => new ExpressAdapter(),
  fastify: () => new FastifyAdapter(),
};

const FILTERS = {
  'catch-everything': CatchEverythingFilter,
  'http-exception': HttpExceptionFilter,
};

type AdapterName = keyof typeof ADAPTERS;
type FilterName = keyof typeof FILTERS;

// Both adapters limit a JSON body to 1 MB or less by default.
const TOO_LARGE = JSON.stringify({ data: 'x'.repeat(2 * 1024 * 1024) });

const REQUESTS = {
  // The body is larger than the default limit.
  'too-large JSON': { body: TOO_LARGE, status: 413 },
  // Control: a body that is not valid JSON.
  'malformed JSON': { body: '{"a":', status: 400 },
};

type RequestName = keyof typeof REQUESTS;

const CASES = (Object.keys(ADAPTERS) as AdapterName[]).flatMap(adapter =>
  (Object.keys(FILTERS) as FilterName[]).flatMap(filter =>
    (Object.keys(REQUESTS) as RequestName[]).map(name => ({
      adapter,
      filter,
      name,
    })),
  ),
);

function send(url: string, body: string) {
  return new Promise<{ status: number; filter?: string; body: string }>(
    (resolve, reject) => {
      const req = httpRequest(
        url,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
        response => {
          let text = '';
          response.on('data', chunk => (text += chunk));
          response.on('end', () =>
            resolve({
              status: response.statusCode ?? 0,
              filter: response.headers['x-filter'] as string | undefined,
              body: text,
            }),
          );
        },
      );
      req.on('error', reject);
      req.end(body);
    },
  );
}

async function runCase({ adapter, filter, name }: (typeof CASES)[number]) {
  const app: INestApplication = await NestFactory.create(
    AppModule,
    ADAPTERS[adapter](),
    { logger: false },
  );
  app.useGlobalFilters(new FILTERS[filter](app.get(HttpAdapterHost)));
  await app.listen(0, '127.0.0.1');
  const { body, status } = REQUESTS[name];
  const response = await send(`${await app.getUrl()}/items`, body);
  await app.close();
  return {
    label: `${adapter}, ${filter} filter: ${name}`,
    ...response,
    expected: { status, filter },
    ok: response.status === status && response.filter === filter,
  };
}

async function main() {
  const results = await CASES.reduce(
    async (done, testCase) => [...(await done), await runCase(testCase)],
    Promise.resolve([] as Awaited<ReturnType<typeof runCase>>[]),
  );
  results.forEach(({ label, status, filter, expected, body }) => {
    console.log(`=== ${label} ===`);
    console.log(`  status:     HTTP ${status}`);
    console.log(`  x-filter:   ${JSON.stringify(filter)}`);
    console.log(
      `  expected:   HTTP ${expected.status}, ${JSON.stringify(expected.filter)}`,
    );
    console.log(`  body:       ${body}\n`);
  });
  const failed = results.filter(({ ok }) => !ok).length;
  console.log(
    failed === 0
      ? `RESULT: FIXED: all ${results.length} responses come from the filter with the right status.`
      : `RESULT: BUG: ${failed} of ${results.length} responses do not come from the filter with the right status.`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
