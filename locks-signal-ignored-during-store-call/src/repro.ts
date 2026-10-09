import 'reflect-metadata';
import { Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Locks, LocksModule, OnOneInstance, type Lock } from '@nestjs/locks';
import { SlowLockStore } from './slow-lock-store.js';

const OBSERVATION_CAP_MS = 1500;
const CLOSE_CAP_MS = 1500;
const ABORT_AFTER_MS = 200;
const LATE_STORE_DELAY_MS = 800;
const WAIT_OPTION_MS = 300;
const TICK_IN_FLIGHT_MS = 100;

@Injectable()
class ScheduledJob {
  // Calling the decorated method yourself takes the lock, like a scheduled tick.
  @OnOneInstance({ key: 'scheduled-job', ttl: 200 })
  async tick(): Promise<void> {}
}

@Module({
  imports: [LocksModule.forRoot({ ttl: '5s', allowInMemoryStorage: true })],
  providers: [SlowLockStore],
})
class AppModule {}

@Module({
  imports: [LocksModule.forRoot({ ttl: '5s', allowInMemoryStorage: true })],
  providers: [SlowLockStore, ScheduledJob],
})
class ScheduledAppModule {}

type CloseOutcome = { closed: true; elapsedMs: number } | { closed: false };

async function closeWithCap(app: { close(): Promise<void> }): Promise<CloseOutcome> {
  const startedAt = Date.now();
  let capTimer: NodeJS.Timeout | undefined;
  const capReached = new Promise<CloseOutcome>((resolve) => {
    capTimer = setTimeout(() => resolve({ closed: false }), CLOSE_CAP_MS);
  });
  const closed = app.close().then((): CloseOutcome => ({ closed: true, elapsedMs: Date.now() - startedAt }));
  const outcome = await Promise.race([closed, capReached]);
  clearTimeout(capTimer);
  return outcome;
}

function describeClose(outcome: CloseOutcome): string {
  return outcome.closed
    ? `app.close() finished after ${outcome.elapsedMs} ms`
    : `app.close() still pending after ${CLOSE_CAP_MS} ms`;
}

type Outcome =
  | { kind: 'resolved'; description: string }
  | { kind: 'rejected'; description: string }
  | { kind: 'pending' };

interface Observation {
  outcome: Outcome;
  elapsedMs: number;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function describeLock(lock: Lock | null): string {
  return lock === null ? 'null' : 'a Lock';
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

// A timer that is never cleared would keep the process alive, so the race
// clears its own timer.
async function observe<T>(
  operation: Promise<T>,
  describeValue: (value: T) => string,
): Promise<Observation> {
  const startedAt = Date.now();
  let capTimer: NodeJS.Timeout | undefined;
  const capReached = new Promise<Outcome>((resolve) => {
    capTimer = setTimeout(() => resolve({ kind: 'pending' }), OBSERVATION_CAP_MS);
  });
  const settled = operation.then(
    (value): Outcome => ({ kind: 'resolved', description: describeValue(value) }),
    (error: unknown): Outcome => ({ kind: 'rejected', description: describeError(error) }),
  );
  const outcome = await Promise.race([settled, capReached]);
  clearTimeout(capTimer);
  return { outcome, elapsedMs: Date.now() - startedAt };
}

function describeObservation({ outcome, elapsedMs }: Observation): string {
  switch (outcome.kind) {
    case 'pending':
      return `still pending after ${OBSERVATION_CAP_MS} ms`;
    case 'resolved':
      return `resolved with ${outcome.description} after ${elapsedMs} ms`;
    case 'rejected':
      return `rejected with ${outcome.description} after ${elapsedMs} ms`;
  }
}

function abortAfter(controller: AbortController, milliseconds: number): void {
  setTimeout(() => controller.abort(new Error('client went away')), milliseconds).unref();
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const locks = app.get(Locks);
  const store = app.get(SlowLockStore);

  store.behavior = { kind: 'normal' };
  const control = await observe(
    locks.acquire('control', { wait: `${WAIT_OPTION_MS}ms` }),
    describeLock,
  );
  console.log(`control      normal store, wait ${WAIT_OPTION_MS}ms: ${describeObservation(control)}`);

  store.behavior = { kind: 'hang' };
  const signalController = new AbortController();
  abortAfter(signalController, ABORT_AFTER_MS);
  const withSignal = await observe(
    locks.acquire('with-signal', { signal: signalController.signal }),
    describeLock,
  );
  console.log(
    `signal       hung store, abort at ${ABORT_AFTER_MS} ms: ${describeObservation(withSignal)}`,
  );

  const withWait = await observe(
    locks.acquire('with-wait', { wait: `${WAIT_OPTION_MS}ms` }),
    describeLock,
  );
  console.log(`wait         hung store, wait ${WAIT_OPTION_MS}ms: ${describeObservation(withWait)}`);

  store.behavior = { kind: 'late', delayMs: LATE_STORE_DELAY_MS };
  const lateController = new AbortController();
  abortAfter(lateController, ABORT_AFTER_MS);
  let functionRan = false;
  let abortedInsideFunction: boolean | undefined;
  const lateWithLock = await observe(
    locks.withLock(
      'late',
      async () => {
        functionRan = true;
        abortedInsideFunction = lateController.signal.aborted;
      },
      { signal: lateController.signal },
    ),
    () => 'the result of fn',
  );
  console.log(
    `withLock     store answers after ${LATE_STORE_DELAY_MS} ms, abort at ${ABORT_AFTER_MS} ms: ${describeObservation(lateWithLock)}`,
  );
  console.log(
    `             fn ran: ${functionRan}, signal.aborted inside fn: ${abortedInsideFunction}`,
  );

  const plainClose = await closeWithCap(app);
  console.log(`shutdown     hung store, plain acquire in flight: ${describeClose(plainClose)}`);

  const scheduledApp = await NestFactory.createApplicationContext(ScheduledAppModule, {
    logger: ['error'],
  });
  scheduledApp.get(SlowLockStore).behavior = { kind: 'hang' };
  // The tick never settles, so it is not awaited.
  void scheduledApp.get(ScheduledJob).tick();
  await wait(TICK_IN_FLIGHT_MS);
  const tickClose = await closeWithCap(scheduledApp);
  console.log(`shutdown     hung store, @OnOneInstance tick in flight: ${describeClose(tickClose)}`);

  const stillWaiting = (observation: Observation): boolean => observation.outcome.kind === 'pending';
  const controlResolvedFast = control.outcome.kind === 'resolved';
  const lateCallerIgnoredAbort = functionRan && abortedInsideFunction === true;
  const anyBug = stillWaiting(withSignal) || stillWaiting(withWait) || lateCallerIgnoredAbort;
  const anyStopped =
    withSignal.outcome.kind === 'rejected' &&
    withWait.outcome.kind !== 'pending' &&
    !lateCallerIgnoredAbort;

  console.log('');
  if (!controlResolvedFast) {
    console.log('RESULT: INCONCLUSIVE');
  } else if (anyBug) {
    // The shutdown case is an extra signal. It never decides the verdict alone.
    console.log(tickClose.closed ? 'RESULT: BUG' : 'RESULT: BUG (and shutdown hangs)');
  } else if (anyStopped) {
    console.log('RESULT: OK');
  } else {
    console.log('RESULT: INCONCLUSIVE');
  }
}

await main();
// WHY: the hung acquire calls never settle and may hold the shutdown open.
// An explicit exit makes sure the script always ends.
process.exit(0);
