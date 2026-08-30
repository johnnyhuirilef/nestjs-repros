import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import {
  SubscribeMessage,
  WebSocketGateway,
  WsResponse,
} from '@nestjs/websockets';
import { createServer, Server } from 'node:http';
import { WebSocket } from 'ws';

/**
 * `WsAdapter.dispose()` does not remove the `'upgrade'` listener it adds to a
 * caller-supplied HTTP server.
 *
 *   npm run leak          -> listener count grows with every create/close cycle
 *   npm run interference  -> a closed app's listener destroys the next app's sockets
 */
const MODE = process.argv[2] === 'interference' ? 'interference' : 'leak';

@WebSocketGateway({ path: '/live' })
class LiveGateway {
  @SubscribeMessage('ping')
  ping(): WsResponse<string> {
    return { event: 'ping', data: 'hello from live gateway' };
  }
}

@Module({ providers: [LiveGateway] })
class LiveModule {}

// A gateway on a different path, so the first app's listener does not match it.
@WebSocketGateway({ path: '/other' })
class OtherGateway {
  @SubscribeMessage('ping')
  ping(): WsResponse<string> {
    return { event: 'ping', data: 'hello from other gateway' };
  }
}

@Module({ providers: [OtherGateway] })
class OtherModule {}

const upgradeListeners = (server: Server) => server.listenerCount('upgrade');

async function runApp(module: any, server: Server) {
  const app = await NestFactory.create(module, { logger: false });
  app.useWebSocketAdapter(new WsAdapter(server));
  await app.init();
  return app;
}

async function leak(server: Server) {
  console.log(`before any app        upgrade listeners: ${upgradeListeners(server)}`);

  for (let i = 1; i <= 3; i++) {
    const app = await runApp(LiveModule, server);
    await app.close();
    console.log(`after create + close #${i}  upgrade listeners: ${upgradeListeners(server)}`);
  }

  console.log(
    upgradeListeners(server) === 0
      ? '\nOK: every listener was removed'
      : '\nLEAK: listeners survived app.close()',
  );
}

async function interference(server: Server, port: number) {
  // One app is created and closed. Its 'upgrade' listener stays behind.
  const first = await runApp(OtherModule, server);
  await first.close();
  console.log(`closed app left        upgrade listeners: ${upgradeListeners(server)}`);

  // A second, live app registers its own gateway on /live.
  const second = await runApp(LiveModule, server);
  console.log(`with the live app      upgrade listeners: ${upgradeListeners(server)}`);

  const reply = await new Promise<string>(resolve => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/live`);
    ws.on('open', () => ws.send(JSON.stringify({ event: 'ping', data: {} })));
    ws.on('message', raw => {
      ws.close();
      resolve(`replied: ${JSON.parse(raw.toString()).data}`);
    });
    ws.on('error', err => resolve(`ERROR: ${err.message}`));
  });

  console.log(`\nclient asked the live gateway -> ${reply}`);
  console.log(
    reply.startsWith('replied')
      ? 'OK: the live gateway answered'
      : "BROKEN: the closed app's listener destroyed the socket",
  );
  await second.close();
}

async function main() {
  const server = createServer();
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };

  if (MODE === 'leak') {
    await leak(server);
  } else {
    await interference(server, port);
  }

  server.close();
  process.exit(0);
}

main();
