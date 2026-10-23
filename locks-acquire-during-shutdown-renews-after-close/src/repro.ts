import 'reflect-metadata';
import { ConsoleLogger, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { InMemoryLockStore, Locks, LocksModule, LocksStorage } from '@nestjs/locks';

let startedAt = Date.now();
const log = (message: string) => console.log(`  [+${String(Date.now() - startedAt).padStart(4)} ms] ${message}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The in-memory store, closed in onApplicationShutdown(), where the docs close a Redis client.
// After that, every call fails, as a call on a closed Redis client does.
@Injectable()
class ClosableStore extends InMemoryLockStore implements OnApplicationShutdown {
  closed = false;
  callsAfterClose: string[] = [];

  constructor(@Inject(LocksStorage) storage: LocksStorage) {
    super();
    storage.registerSource(this);
  }

  onApplicationShutdown() {
    this.closed = true;
    log('the store closes its connection (onApplicationShutdown)');
  }

  private check(method: string) {
    if (this.closed) {
      this.callsAfterClose.push(method);
      throw new Error('Connection is closed.');
    }
  }

  override async acquire(...args: Parameters<InMemoryLockStore['acquire']>) {
    this.check('acquire');
    return super.acquire(...args);
  }

  override async renew(...args: Parameters<InMemoryLockStore['renew']>) {
    this.check('renew');
    return super.renew(...args);
  }

  override async release(...args: Parameters<InMemoryLockStore['release']>) {
    this.check('release');
    return super.release(...args);
  }
}

@Module({
  imports: [LocksModule.forRoot({ ttl: '600ms' })],
  providers: [ClosableStore],
})
class AppModule {}

// Counts the errors that Nest logs, and prints the errors and warnings in one line each.
class CountingLogger extends ConsoleLogger {
  static errors = 0;
  override log() {}
  override error(message: unknown) {
    CountingLogger.errors++;
    log(`ERROR logged: ${String(message)}`);
  }
  override warn(message: unknown) {
    log(`WARN logged: ${String(message)}`);
  }
}

const scenario = async (title: string, withWaiter: boolean) => {
  console.log(`\n=== ${title} ===`);
  CountingLogger.errors = 0;
  startedAt = Date.now();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: new CountingLogger() });
  const locks = app.get(Locks);
  const store = app.get(ClosableStore);

  await locks.acquire('report');
  log('a request holds the lock "report"');
  if (withWaiter) {
    // A second request waits for the same lock, as a request does while the app shuts down.
    void locks.acquire('report', { wait: '60s' }).then((lock) => log(`the waiting acquire() resolves with ${lock ? 'a Lock' : lock}`));
  }
  await sleep(100);
  log('app.close()');
  await app.close();
  log('app.close() resolved');
  await sleep(1000);
  log(`store calls after the close: ${store.callsAfterClose.length ? store.callsAfterClose.join(', ') : 'none'}`);
  return { calls: store.callsAfterClose.length, errors: CountingLogger.errors };
};

const control = await scenario('No acquire() waiting (control)', false);
const waiting = await scenario('An acquire() waiting for the lock', true);

const bug = waiting.calls > 0 || waiting.errors > 0;
console.log(
  bug
    ? `\nRESULT: BUG: after onApplicationShutdown(), the package called the closed store ${waiting.calls} times and logged ${waiting.errors} errors (control: ${control.calls} calls, ${control.errors} errors).`
    : '\nRESULT: OK: the package did not use the store after onApplicationShutdown().',
);
process.exitCode = bug ? 1 : 0;
