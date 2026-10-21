import 'reflect-metadata';
import diagnostics_channel from 'node:diagnostics_channel';
import { Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { OnOutboxMessage, Outbox, OutboxEvents, OutboxModule, OutboxRelay, OutboxStorage } from '@nestjs/outbox';

// Where the throwing subscriber listens: 'events$' or 'channel'. 'control' does not throw.
const subscriber = process.argv[2];

class OrderHandler {
  handle() {}
}
Injectable()(OrderHandler);
const handle = Object.getOwnPropertyDescriptor(OrderHandler.prototype, 'handle');
OnOutboxMessage('order.placed', { consumer: 'shipping' })(OrderHandler.prototype, 'handle', handle);

class AppModule {}
Module({
  // The relay runs by hand (`runOnce()`), one batch per call.
  imports: [OutboxModule.forRoot({ relay: { enabled: false } })],
  providers: [OrderHandler],
})(AppModule);

// Prints what the relay logs as an error, to see whether its catch runs.
const logger = {
  log() {},
  warn() {},
  debug() {},
  verbose() {},
  error: (message) => console.log(`  relay logged:  ${message}`),
};

const app = await NestFactory.createApplicationContext(AppModule, { logger, abortOnError: false });
await app.init();

// A metrics subscriber with a bug: a published event has no `error`.
const metrics = (event) => {
  console.log(`  subscriber:    got ${event.type}`);
  if (subscriber !== 'control') console.log(`  subscriber:    reads ${event.error.message}`);
};
if (subscriber === 'channel') diagnostics_channel.subscribe('nestjs:outbox:published', metrics);
else app.get(OutboxEvents).events$.subscribe(metrics);

const store = app.get(OutboxStorage).messages;
const outbox = app.get(Outbox);
await store.transaction((tx) => outbox.add(tx, { topic: 'order.placed', payload: { id: 1 } }));

const result = await app.get(OutboxRelay).runOnce();
console.log(`  relay batch:   published=${result.published}`);

// rxjs and diagnostics_channel rethrow a subscriber's error on a later tick.
await new Promise((resolve) => setTimeout(resolve, 100));
console.log('  process:       still running');
await app.close();
