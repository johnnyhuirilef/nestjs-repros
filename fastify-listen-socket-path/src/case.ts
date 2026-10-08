import 'reflect-metadata';
import { request } from 'http';
import { tmpdir } from 'os';
import { join } from 'path';
import { rmSync } from 'fs';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { AppModule } from './app';

/**
 * Runs one case in this process and prints one line. The Fastify socket path
 * case throws on a later tick that nothing can catch, so repro.ts runs every
 * case in its own child process and reads the exit code and stderr.
 */
const socketPath = join(tmpdir(), `listen-socket-path-${process.pid}.sock`);

const CASES = {
  'express: listen(socketPath)': {
    adapter: () => new ExpressAdapter(),
    listen: (app: any) => app.listen(socketPath),
    over: 'socket',
  },
  'fastify: listen(socketPath)': {
    adapter: () => new FastifyAdapter(),
    listen: (app: any) => app.listen(socketPath),
    over: 'socket',
  },
  'fastify: listen(0)': {
    adapter: () => new FastifyAdapter(),
    listen: (app: any) => app.listen(0, '127.0.0.1'),
    over: 'port',
  },
  'fastify: listen({ path })': {
    adapter: () => new FastifyAdapter(),
    listen: (app: any) => app.listen({ path: socketPath } as any),
    over: 'socket',
  },
} as const;

function get(options: object): Promise<number> {
  return new Promise((resolve, reject) => {
    request({ ...options, path: '/' }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode!));
    })
      .on('error', reject)
      .end();
  });
}

async function main() {
  const name = process.argv[2] as keyof typeof CASES;
  const { adapter, listen, over } = CASES[name];
  const app = await NestFactory.create(AppModule, adapter(), { logger: false });
  await listen(app);
  const address = app.getHttpServer().address();
  const status = over === 'socket' ? await get({ socketPath }) : await get({ host: '127.0.0.1', port: address.port });
  console.log(`listening, GET / answered HTTP ${status}`);
  await app.close();
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 2;
  })
  .finally(() => rmSync(socketPath, { force: true }));
