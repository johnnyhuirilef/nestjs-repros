import { Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ClientProxyFactory, Transport } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import { PORT, REPLY_TIMEOUT_MS, TCP_PORT } from './config';
import {
  DefaultDenyGuard,
  globalGuardModule,
  PingMessageController,
  RequestScopedDenyGuard,
  routeGuardModule,
  trace,
  TransientDenyGuard,
} from './app';

/**
 * A global APP_GUARD whose class has `scope: Scope.TRANSIENT` is attached to the
 * controllers, but a controller that depends on nothing request-scoped is built
 * once, as a static host. The static path never reads the transient globals, so
 * the guard is created and `canActivate()` is never called.
 *
 *   npm run repro
 */
type Outcome = { client: string };

async function sendHttp(module: Type<unknown>): Promise<Outcome> {
  const app = await NestFactory.create(module, { logger: ['error'] });
  await app.listen(PORT);
  try {
    const response = await fetch(`http://localhost:${PORT}/ping`);
    return { client: `HTTP ${response.status}` };
  } finally {
    await app.close();
  }
}

async function sendTcp(module: Type<unknown>): Promise<Outcome> {
  const options = { host: '127.0.0.1', port: TCP_PORT };
  const app = await NestFactory.createMicroservice(module, {
    transport: Transport.TCP,
    options,
    logger: ['error'],
  });
  await app.listen();
  const client = ClientProxyFactory.create({ transport: Transport.TCP, options });
  try {
    const reply = await firstValueFrom(
      client.send('ping', {}).pipe(timeout(REPLY_TIMEOUT_MS)),
    ).catch(error => `error ${JSON.stringify(error)}`);
    return { client: typeof reply === 'string' ? reply : JSON.stringify(reply) };
  } finally {
    client.close();
    await app.close();
  }
}

const CASES = [
  {
    name: 'HTTP route + transient global guard that denies',
    send: () => sendHttp(globalGuardModule(TransientDenyGuard)),
  },
  {
    name: 'HTTP route + default global guard that denies (baseline)',
    send: () => sendHttp(globalGuardModule(DefaultDenyGuard)),
  },
  {
    name: 'HTTP route + request-scoped global guard that denies (baseline)',
    send: () => sendHttp(globalGuardModule(RequestScopedDenyGuard)),
  },
  {
    name: 'HTTP route + @UseGuards(TransientDenyGuard) (baseline)',
    send: () => sendHttp(routeGuardModule()),
  },
  {
    name: 'TCP message + transient global guard that denies',
    send: () =>
      sendTcp(globalGuardModule(TransientDenyGuard, PingMessageController)),
  },
];

async function runCase({ send }: (typeof CASES)[number]) {
  trace.constructed = 0;
  trace.guardRan = false;
  trace.handlerRan = false;
  const { client } = await send();
  return { ...trace, client };
}

async function main() {
  let failed = 0;
  for (const testCase of CASES) {
    const { constructed, guardRan, handlerRan, client } = await runCase(testCase);
    const blocked = guardRan && !handlerRan;
    console.log(`=== ${testCase.name} ===`);
    console.log('  expected: the guard runs, the handler does not run');
    console.log(`  guard created: ${constructed}`);
    console.log(`  guard ran:     ${guardRan}`);
    console.log(`  handler ran:   ${handlerRan}`);
    console.log(`  client got:    ${client}`);
    console.log('');
    failed += blocked ? 0 : 1;
  }

  console.log(
    failed === 0
      ? 'RESULT: FIXED: the guard denied the request in every case.'
      : `RESULT: BUG: ${failed} of ${CASES.length} cases ran the handler without the guard.`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
