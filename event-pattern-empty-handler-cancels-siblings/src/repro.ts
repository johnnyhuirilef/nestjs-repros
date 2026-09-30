import 'reflect-metadata';
import { Controller, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  ClientProxyFactory,
  EventPattern,
  Payload,
  Transport,
} from '@nestjs/microservices';
import { filter, of, tap, timer } from 'rxjs';

const PORT = Number(process.env.PORT ?? 3010);
const SETTLE_MS = 500;

interface Order {
  id: number;
  priority: boolean;
}

const sideEffects: string[] = [];

/**
 * Two handlers for the same pattern. Nest runs both for every event (documented
 * in "Microservices > Basics": "Nest triggers all of them in parallel").
 *
 * - `notifyPriorityDesk` only cares about priority orders, so it filters the
 *   others out. For a non-priority order its stream completes without a value.
 * - `reserveStock` returns a cold Observable: its side effect runs once
 *   something subscribes and the timer fires.
 */
@Controller()
class OrdersController {
  @EventPattern('order.created')
  notifyPriorityDesk(@Payload() order: Order) {
    return of(order).pipe(filter(({ priority }) => priority));
  }

  @EventPattern('order.created')
  reserveStock(@Payload() order: Order) {
    return timer(50).pipe(
      tap(() => sideEffects.push(`stock reserved for order ${order.id}`)),
    );
  }
}

@Module({ controllers: [OrdersController] })
class AppModule {}

const ORDERS: Array<{ order: Order; note: string }> = [
  { order: { id: 1, priority: false }, note: 'first handler completes empty' },
  { order: { id: 2, priority: true }, note: 'baseline, first handler emits' },
];

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const app = await NestFactory.createMicroservice(AppModule, {
    transport: Transport.TCP,
    options: { port: PORT },
  });
  await app.listen();

  const client = ClientProxyFactory.create({
    transport: Transport.TCP,
    options: { port: PORT },
  });
  await client.connect();

  let failed = 0;
  for (const { order, note } of ORDERS) {
    client.emit('order.created', order).subscribe();
    await sleep(SETTLE_MS);

    const ran = sideEffects.includes(`stock reserved for order ${order.id}`);
    console.log(`=== order ${order.id} (${note}) ===`);
    console.log('  expected: reserveStock runs its side effect');
    console.log(`  actual:   ${ran ? 'side effect ran' : 'side effect never ran'}`);
    console.log('');
    failed += ran ? 0 : 1;
  }

  await client.close();
  await app.close();

  console.log('=== RESULT ===');
  console.log(
    failed === 0
      ? '  FIXED: every handler ran, whether or not another handler emitted.'
      : `  BUG: reserveStock was cancelled for ${failed} of ${ORDERS.length} orders.`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
