import 'reflect-metadata';
import { Controller, Get, Inject, Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ResilienceModule, ResilienceService, Timeout } from '@nestjs/resilience';

// A carrier that never answers. It stops only when its signal aborts.
const hangingCarrier = (signal) =>
  new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));

class QuotesService {
  constructor(resilience) {
    // The preset as one policy object: a 300ms timeout and a breaker.
    this.policy = resilience.preset('carrier');
  }
  quote() {
    return this.policy.execute(({ signal }) => hangingCarrier(signal));
  }
}
Inject(ResilienceService)(QuotesService, undefined, 0);
Reflect.decorate([Injectable()], QuotesService);

async function run(name, routeTimeout) {
  class QuotesController {
    constructor(quotes) {
      this.quotes = quotes;
    }
    quote() {
      return this.quotes.quote();
    }
  }
  Inject(QuotesService)(QuotesController, undefined, 0);
  Reflect.decorate(
    [Get('quote'), Timeout(routeTimeout)],
    QuotesController.prototype,
    'quote',
    Object.getOwnPropertyDescriptor(QuotesController.prototype, 'quote'),
  );
  Reflect.decorate([Controller()], QuotesController);

  class AppModule {}
  Module({
    imports: [
      ResilienceModule.forRoot({
        presets: {
          carrier: {
            timeout: '300ms',
            circuitBreaker: { minimumCalls: 3, failureRateThreshold: 50 },
          },
        },
      }),
    ],
    controllers: [QuotesController],
    providers: [QuotesService],
  })(AppModule);

  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  await app.listen(0);
  const url = await app.getUrl();
  const statuses = [];
  for (let i = 0; i < 5; i++) {
    statuses.push((await fetch(`${url}/quote`)).status);
  }
  const breaker = app.get(ResilienceService).circuitBreaker('carrier');
  const result = { name, statuses, state: breaker.state, stats: breaker.stats };
  await app.close();
  return result;
}

const control = await run('Route @Timeout(1s), longer than the preset timeout (control)', '1s');
const bug = await run('Route @Timeout(100ms), shorter than the preset timeout', '100ms');

for (const r of [control, bug]) {
  console.log(`=== ${r.name} ===`);
  console.log(`  statuses of 5 requests: ${r.statuses.join(', ')}`);
  console.log(`  breaker "carrier": state=${r.state}, calls=${r.stats.total}, failures=${r.stats.failures}\n`);
}
const ok = bug.state === 'open';
console.log(
  ok
    ? 'RESULT: FIXED: the breaker opens in both cases.'
    : 'RESULT: BUG: with the shorter route timeout, the breaker counts no call and stays closed.',
);
process.exitCode = ok && control.state === 'open' ? 0 : 1;
