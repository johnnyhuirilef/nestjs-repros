import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import { Module, type LoggerService } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createObserveModule } from '@nestjs/observe';
import { DataController } from './data.controller.js';
import { DATA_URL, DataService } from './data.service.js';

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

interface LocalServer {
  server: Server;
  url: string;
}

async function listenOnLoopback(server: Server): Promise<LocalServer> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('The server did not bind to a TCP port');
  }
  return { server, url: `http://127.0.0.1:${address.port}` };
}

// The exporter needs an endpoint. A local collector keeps the run offline.
function startCollector(): Promise<LocalServer> {
  return listenOnLoopback(
    createServer((request, response) => {
      request.resume();
      request.on('end', () => response.end('{}'));
    }),
  );
}

function startJsonServer(): Promise<LocalServer> {
  return listenOnLoopback(
    createServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end('{"a":1}');
    }),
  );
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
}

const collector = await startCollector();
const jsonServer = await startJsonServer();
const { ObserveModule, ObserveInstrument } = createObserveModule();

function buildAppModule(instrumented: boolean) {
  @Module({
    imports: instrumented
      ? [
          ObserveModule.forRoot({
            appKey: 'repro-key',
            appSecret: 'repro-secret',
            serviceId: 'repro',
            endpoint: collector.url,
            runtimeMetrics: false,
          }),
        ]
      : [],
    controllers: [DataController],
    providers: [{ provide: DATA_URL, useValue: jsonServer.url }, DataService],
  })
  class AppModule {}
  return AppModule;
}

interface RouteResult {
  status: number;
  body: string;
}

interface RunResult {
  data: RouteResult;
  cancel: RouteResult;
  loggedErrors: number;
  firstErrorLine: string;
}

async function requestRoute(baseUrl: string, path: string): Promise<RouteResult> {
  const response = await fetch(`${baseUrl}${path}`);
  return { status: response.status, body: await response.text() };
}

async function runApp(instrumented: boolean): Promise<RunResult> {
  const logger = new ErrorCountingLogger();
  const app = await NestFactory.create(
    buildAppModule(instrumented),
    instrumented ? { logger, instrument: ObserveInstrument } : { logger },
  );
  try {
    await app.listen(0, '127.0.0.1');
    const baseUrl = await app.getUrl();
    const data = await requestRoute(baseUrl, '/data');
    const cancel = await requestRoute(baseUrl, '/cancel');
    return {
      data,
      cancel,
      loggedErrors: logger.errors.length,
      firstErrorLine: (logger.errors[0] ?? 'none').split('\n')[0],
    };
  } finally {
    await app.close();
  }
}

function printRun(title: string, run: RunResult): void {
  console.log(`--- ${title} ---`);
  console.log(`GET /data:     ${run.data.status} ${run.data.body}`);
  console.log(`GET /cancel:   ${run.cancel.status} ${run.cancel.body}`);
  console.log(`logged errors: ${run.loggedErrors}`);
  console.log(`first error:   ${run.firstErrorLine}`);
  console.log('');
}

function dataWorks(run: RouteResult): boolean {
  return run.status === 200 && run.body === '{"a":1}';
}

function cancelWorks(run: RouteResult): boolean {
  return run.status === 200 && run.body.includes('"cancelExists":true');
}

function judge(control: RunResult, instrumented: RunResult): string {
  const controlWorks = dataWorks(control.data) && cancelWorks(control.cancel);
  const instrumentedWorks = dataWorks(instrumented.data) && cancelWorks(instrumented.cancel);
  if (controlWorks && instrumentedWorks) return 'OK';
  if (controlWorks) return 'BUG';
  return 'INCONCLUSIVE';
}

try {
  const control = await runApp(false);
  const instrumented = await runApp(true);
  printRun('control: no instrument option', control);
  printRun('with instrument: ObserveInstrument', instrumented);
  console.log(`RESULT: ${judge(control, instrumented)}`);
} finally {
  await closeServer(collector.server);
  await closeServer(jsonServer.server);
}
