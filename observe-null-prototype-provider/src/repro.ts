import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import {
  Controller,
  Get,
  Inject,
  Module,
  type INestApplication,
  type LoggerService,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createObserveModule } from '@nestjs/observe';
import * as greetings from './greetings.js';

const GREETINGS = 'GREETINGS';

interface Greetings {
  hello(name: string): string;
}

@Controller()
class GreetController {
  constructor(@Inject(GREETINGS) private readonly greetings: Greetings) {}

  @Get('greet')
  greet(): string {
    return this.greetings.hello('Ana');
  }
}

class ErrorCountingLogger implements LoggerService {
  readonly errors: string[] = [];

  log(): void {}
  warn(): void {}
  debug(): void {}
  verbose(): void {}
  fatal(): void {}

  error(message: unknown): void {
    this.errors.push(message instanceof Error ? message.message : String(message));
  }
}

// The exporter needs an endpoint. A local collector keeps the run offline.
async function startCollector(): Promise<{ server: Server; endpoint: string }> {
  const server = createServer((request, response) => {
    request.resume();
    request.on('end', () => response.end('{}'));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('The collector did not bind to a TCP port');
  }
  return { server, endpoint: `http://127.0.0.1:${address.port}` };
}

const { endpoint, server: collector } = await startCollector();
const { ObserveModule, ObserveInstrument } = createObserveModule();

function buildAppModule(instrumented: boolean) {
  @Module({
    imports: instrumented
      ? [
          ObserveModule.forRoot({
            appKey: 'repro-key',
            appSecret: 'repro-secret',
            serviceId: 'repro',
            endpoint,
            runtimeMetrics: false,
          }),
        ]
      : [],
    controllers: [GreetController],
    // An ESM namespace object has a null prototype, so it has no `constructor`.
    providers: [{ provide: GREETINGS, useValue: greetings }],
  })
  class AppModule {}
  return AppModule;
}

interface RunResult {
  status: number;
  body: string;
  firstErrorLine: string;
  loggedErrors: number;
}

async function runApp(instrumented: boolean): Promise<RunResult> {
  const logger = new ErrorCountingLogger();
  const app: INestApplication = await NestFactory.create(
    buildAppModule(instrumented),
    instrumented ? { logger, instrument: ObserveInstrument } : { logger },
  );
  try {
    await app.listen(0, '127.0.0.1');
    const response = await fetch(`${await app.getUrl()}/greet`);
    return {
      status: response.status,
      body: await response.text(),
      firstErrorLine: (logger.errors[0] ?? 'none').split('\n')[0],
      loggedErrors: logger.errors.length,
    };
  } finally {
    await app.close();
  }
}

function printRun(title: string, run: RunResult): void {
  console.log(`--- ${title} ---`);
  console.log(`HTTP status:   ${run.status}`);
  console.log(`HTTP body:     ${run.body}`);
  console.log(`logged errors: ${run.loggedErrors}`);
  console.log(`first error:   ${run.firstErrorLine}`);
  console.log('');
}

function judge(control: RunResult, instrumented: RunResult): string {
  if (control.status === 200 && instrumented.status === 500) return 'BUG';
  if (control.status === 200 && instrumented.status === 200) return 'OK';
  return 'INCONCLUSIVE';
}

const control = await runApp(false);
const instrumented = await runApp(true);
printRun('control: no instrument option', control);
printRun('with instrument: ObserveInstrument', instrumented);
console.log(`RESULT: ${judge(control, instrumented)}`);
await new Promise((resolve) => collector.close(resolve));
