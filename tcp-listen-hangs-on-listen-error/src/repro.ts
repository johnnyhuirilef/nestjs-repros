import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Transport } from '@nestjs/microservices';
import type { MicroserviceOptions } from '@nestjs/microservices';

/**
 * ServerTCP only passes EADDRINUSE and ECONNREFUSED to the listen callback.
 * Any other listen error is logged, and `await app.listen()` never settles.
 *
 *   npm install && npm run repro
 */
const SETTLE_TIMEOUT_MS = 3000;

// 203.0.113.0/24 is TEST-NET-3: no local interface owns it, thus bind fails
// with EADDRNOTAVAIL. Port 80 on loopback fails with EACCES for a non-root
// user, unless the kernel lowered net.ipv4.ip_unprivileged_port_start.
const SCENARIOS = [
  { name: 'EADDRNOTAVAIL', host: '203.0.113.1', port: 3001 },
  { name: 'EACCES', host: '127.0.0.1', port: 80 },
];

@Module({})
class AppModule {}

type Outcome = 'resolved' | 'rejected' | 'hung';

async function attemptListen(host: string, port: number): Promise<Outcome> {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    { transport: Transport.TCP, options: { host, port } },
  );

  const outcome = await Promise.race([
    app.listen().then(
      () => 'resolved' as const,
      (err: NodeJS.ErrnoException) => {
        console.log(`  listen() rejected with ${err.code}`);
        return 'rejected' as const;
      },
    ),
    new Promise<'hung'>(resolve =>
      setTimeout(() => resolve('hung'), SETTLE_TIMEOUT_MS),
    ),
  ]);
  return outcome;
}

async function main() {
  const results: { name: string; outcome: Outcome }[] = [];

  for (const { name, host, port } of SCENARIOS) {
    console.log(`\n=== listen on ${host}:${port} (expect ${name}) ===`);
    const outcome = await attemptListen(host, port);
    console.log(`  outcome after ${SETTLE_TIMEOUT_MS}ms: ${outcome}`);
    results.push({ name, outcome });
  }

  console.log('\n=== RESULT ===');
  results.forEach(({ name, outcome }) =>
    console.log(`  ${name}: listen() ${outcome}`),
  );
  const hung = results.filter(({ outcome }) => outcome === 'hung');
  console.log(
    hung.length
      ? `  BUG: listen() never settled for ${hung.map(r => r.name).join(', ')}, though Nest logged the error.`
      : '  FIXED: listen() rejected for every listen error.',
  );
  process.exit(hung.length ? 1 : 0);
}

main();
