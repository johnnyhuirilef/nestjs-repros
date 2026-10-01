import { NestFactory } from '@nestjs/core';
import { io } from 'socket.io-client';
import { ACK_TIMEOUT_MS, PORT } from './config';
import {
  appModuleWith,
  RequestScopedDenyGuard,
  StaticDenyGuard,
  trace,
} from './app';

/**
 * A global APP_GUARD whose class has `scope: Scope.REQUEST` is attached only to
 * controllers and "entry providers". Gateways are neither, so the guard is never
 * created for a gateway handler: the handler runs and nothing is logged.
 *
 *   npm run repro
 */
const CASES = [
  {
    name: 'WebSocket gateway + request-scoped global guard that denies',
    guard: RequestScopedDenyGuard,
    transport: 'ws',
  },
  {
    name: 'WebSocket gateway + static global guard that denies (baseline)',
    guard: StaticDenyGuard,
    transport: 'ws',
  },
  {
    name: 'HTTP route + request-scoped global guard that denies (baseline)',
    guard: RequestScopedDenyGuard,
    transport: 'http',
  },
] as const;

async function emitPing(): Promise<string> {
  const socket = io(`http://localhost:${PORT}`, { transports: ['websocket'] });
  const events: string[] = [];
  socket.on('exception', error => events.push(`exception ${JSON.stringify(error)}`));
  socket.on('pong', data => events.push(`pong ${JSON.stringify(data)}`));
  await new Promise<void>(resolve => socket.on('connect', () => resolve()));
  socket.emit('ping', {});
  await new Promise(resolve => setTimeout(resolve, ACK_TIMEOUT_MS));
  socket.close();
  return events.join(', ') || '(nothing)';
}

async function fetchPing(): Promise<string> {
  const response = await fetch(`http://localhost:${PORT}/ping`);
  return `HTTP ${response.status}`;
}

async function runCase({ guard, transport }: (typeof CASES)[number]) {
  trace.guardRan = false;
  trace.handlerRan = false;
  const app = await NestFactory.create(appModuleWith(guard, transport), {
    logger: ['error'],
  });
  await app.listen(PORT);
  try {
    const client = await (transport === 'ws' ? emitPing() : fetchPing());
    return { ...trace, client };
  } finally {
    await app.close();
  }
}

async function main() {
  let failed = 0;
  for (const testCase of CASES) {
    const { guardRan, handlerRan, client } = await runCase(testCase);
    const blocked = guardRan && !handlerRan;
    console.log(`=== ${testCase.name} ===`);
    console.log('  expected: the guard runs, the handler does not run');
    console.log(`  guard ran:   ${guardRan}`);
    console.log(`  handler ran: ${handlerRan}`);
    console.log(`  client got:  ${client}`);
    console.log('');
    failed += blocked ? 0 : 1;
  }

  console.log('=== RESULT ===');
  console.log(
    failed === 0
      ? '  FIXED: the guard denied the request in every case.'
      : `  BUG: ${failed} of ${CASES.length} cases ran the handler without the guard.`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
