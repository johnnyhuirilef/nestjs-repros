import 'reflect-metadata';
import { Controller, Get, Module, Sse } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { connect } from 'node:http2';
import type { Http2Session } from 'node:http2';
import { interval, map, take } from 'rxjs';

/**
 * Does an ordinary request suffer because an @Sse() request ran earlier on the
 * same HTTP/2 connection?
 *
 *   npm run control  -> no SSE on the connection
 *   npm run sse      -> one SSE request first, on the same connection
 *
 * The victim is /plain, which never constructs an SseStream.
 */
const VISIT_SSE = process.argv[2] === 'sse';
const SESSION_TIMEOUT_MS = 800;

const startedAt = Date.now();
const log = (...args: unknown[]) =>
  console.log(`[+${String(Date.now() - startedAt).padStart(5)}ms]`, ...args);

@Controller()
class AppController {
  @Sse('events')
  events() {
    return interval(30).pipe(
      take(1),
      map(i => ({ data: { i } })),
    );
  }

  @Get('plain')
  plain() {
    return 'ok';
  }
}

@Module({ controllers: [AppController] })
class AppModule {}

async function main() {
  const adapter = new FastifyAdapter({
    http2: true,
    http2SessionTimeout: SESSION_TIMEOUT_MS,
  });
  const app = await NestFactory.create(AppModule, adapter, { logger: false });

  const server = app.getHttpAdapter().getInstance().server;
  // `timeout` is a runtime property of the session; it is not in the type.
  let session: (Http2Session & { timeout?: number }) | undefined;
  server.on('session', (s: Http2Session) => {
    session = s;
    s.on('timeout', () => log('>>> SESSION TIMEOUT FIRED'));
  });

  await app.listen(0, '127.0.0.1');
  const { port } = server.address();
  const client = connect(`http://127.0.0.1:${port}`);
  client.on('close', () => log('server closed the connection'));

  if (VISIT_SSE) {
    log('an @Sse() request runs first, on this connection');
    const sse = client.request({ ':path': '/events' });
    sse.resume();
    await new Promise(resolve => sse.on('close', resolve));
    log('SSE stream finished and closed');
  } else {
    log('control: no SSE request on this connection');
  }

  log('VICTIM: ordinary GET /plain on the same connection');
  const victim = client.request({ ':path': '/plain' });
  victim.resume();
  await new Promise(resolve => victim.on('close', resolve));
  log(`VICTIM: done. session.timeout = ${session?.timeout}`);

  log(`connection is now idle — is it still reclaimed after ${SESSION_TIMEOUT_MS}ms?`);
  setTimeout(() => {
    log(`3s later: connection reclaimed? ${client.destroyed}`);
    log(
      client.destroyed
        ? 'PROTECTED: the connection was reclaimed on schedule'
        : 'HARMED: the connection is pinned open indefinitely',
    );
    process.exit(0);
  }, 3000);
}

main();
