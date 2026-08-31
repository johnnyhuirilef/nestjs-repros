import 'reflect-metadata';
import { createServer, Server } from 'net';
import Aedes from 'aedes';
import { Controller, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { EventPattern, Transport } from '@nestjs/microservices';
import type { MicroserviceOptions } from '@nestjs/microservices';
import { ServerMqtt } from '@nestjs/microservices';

/**
 * `ServerMqtt.listen` binds the bootstrap callback with `on`, not `once`.
 * mqtt.js reconnects on the same client object and emits `connect` again,
 * thus Nest runs the callback again on every reconnect.
 *
 *   npm install && npm run repro
 */
const PORT = 18831;

@Controller()
class AppController {
  @EventPattern('noop')
  noop() {}
}

@Module({ controllers: [AppController] })
class AppModule {}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

type Broker = { aedes: any; server: Server; sockets: Set<any> };

function startBroker(): Promise<Broker> {
  const aedes = new (Aedes as any)();
  const sockets = new Set<any>();
  const server = createServer(stream => {
    sockets.add(stream);
    stream.on('close', () => sockets.delete(stream));
    aedes.handle(stream);
  });
  return new Promise(resolve =>
    server.listen(PORT, () => resolve({ aedes, server, sockets })),
  );
}

// Drop every live connection first, otherwise closing hangs while the
// client is still attached.
function stopBroker(b: Broker): Promise<void> {
  b.sockets.forEach(s => s.destroy());
  b.sockets.clear();
  return new Promise(resolve => b.server.close(() => resolve()));
}

async function main() {
  let broker: Broker = await startBroker();

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.MQTT,
      options: { url: `mqtt://localhost:${PORT}`, reconnectPeriod: 300 },
      logger: false,
    },
  );

  // Count how many times Nest runs the bootstrap callback. This is the
  // callback that logs "Nest microservice successfully started".
  let callbackRuns = 0;
  const server: ServerMqtt = (app as any).serverInstance;
  const realListen = server.listen.bind(server);
  server.listen = (cb: (...a: any[]) => void) =>
    realListen((...args: any[]) => {
      callbackRuns++;
      console.log(`  -> listen() callback ran (total: ${callbackRuns})`);
      cb(...args);
    });

  console.log('\n=== start ===');
  await app.listen();
  await wait(500);

  for (const n of [1, 2]) {
    console.log(`\n=== broker restart ${n} ===`);
    await stopBroker(broker);
    await wait(500);
    broker = await startBroker();
    await wait(1200);
  }

  console.log('\n=== RESULT ===');
  console.log('  started once, reconnected twice');
  console.log(`  listen() callback ran: ${callbackRuns}`);
  console.log(
    callbackRuns === 1
      ? '  FIXED: the callback ran once.'
      : `  BUG: the callback ran ${callbackRuns} times.`,
  );

  await app.close();
  await stopBroker(broker);
  process.exit(0);
}

main();
