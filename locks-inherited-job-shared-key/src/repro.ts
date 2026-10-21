import 'reflect-metadata';
import { Injectable, Module, type INestApplicationContext, type LoggerService, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { LocksModule, WithoutOverlapping } from '@nestjs/locks';

const RUN_MS = 200;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

abstract class ReportJob {
  @WithoutOverlapping()
  async run(): Promise<string> {
    await sleep(RUN_MS);
    return `${this.constructor.name} ran`;
  }
}

@Injectable()
class SalesReport extends ReportJob {}

@Injectable()
class StockReport extends ReportJob {}

@Injectable()
class InvoiceSync {
  @WithoutOverlapping()
  async run(): Promise<string> {
    await sleep(RUN_MS);
    return 'InvoiceSync ran';
  }
}

@Injectable()
class EmailSync {
  @WithoutOverlapping()
  async run(): Promise<string> {
    await sleep(RUN_MS);
    return 'EmailSync ran';
  }
}

// Two separate classes with the same name, so the same default key `Cleanup.run`.
const FirstCleanup = (() => {
  @Injectable()
  class Cleanup {
    @WithoutOverlapping()
    async run(): Promise<string> {
      return 'Cleanup ran';
    }
  }
  return Cleanup;
})();

const SecondCleanup = (() => {
  @Injectable()
  class Cleanup {
    @WithoutOverlapping()
    async run(): Promise<string> {
      return 'Cleanup ran';
    }
  }
  return Cleanup;
})();

interface Job {
  run(): Promise<string | undefined>;
}

// The package reports a skipped run only at debug level, so the repro captures it.
class CapturingLogger implements LoggerService {
  readonly messages: string[] = [];
  log() {}
  warn() {}
  error() {}
  verbose() {}
  debug(message: unknown) {
    this.messages.push(String(message));
  }
}

interface Result {
  startup: string;
  runs: (string | undefined)[];
  logs: string[];
}

async function scenario(providers: Type<Job>[]): Promise<Result> {
  @Module({
    imports: [LocksModule.forRoot({ allowInMemoryStorage: true })],
    providers,
  })
  class AppModule {}

  const logger = new CapturingLogger();
  let app: INestApplicationContext;
  try {
    app = await NestFactory.createApplicationContext(AppModule, { logger, abortOnError: false });
    await app.init();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { startup: `fails: ${message}`, runs: [], logs: [] };
  }
  const runs = await Promise.all(providers.map((provider) => app.get<Job>(provider).run()));
  await app.close();
  return { startup: 'ok', runs, logs: logger.messages.filter((message) => message.startsWith('Skipped')) };
}

function print(title: string, result: Result, expected: string): void {
  console.log(`=== ${title} ===`);
  console.log(`  startup:   ${result.startup}`);
  if (result.runs.length > 0) console.log(`  runs:      ${JSON.stringify(result.runs)}`);
  for (const message of result.logs) console.log(`  debug log: ${message}`);
  console.log(`  expected:  ${expected}`);
  console.log('');
}

const control = await scenario([InvoiceSync, EmailSync]);
print('two unrelated classes, run at the same time (control)', control, 'both run');

const sameName = await scenario([FirstCleanup, SecondCleanup]);
print('two classes with the same default key', sameName, 'startup fails');

const inherited = await scenario([SalesReport, StockReport]);
print(
  'two subclasses of one base class, run at the same time',
  inherited,
  'both run, or startup fails as in the case above',
);

const controlOk = control.runs.every((run) => run !== undefined);
const inheritedSkipped = inherited.startup === 'ok' && inherited.runs.some((run) => run === undefined);
if (!controlOk) {
  console.log('RESULT: INCONCLUSIVE: the control case skipped a run.');
  process.exitCode = 2;
} else if (inheritedSkipped) {
  console.log('RESULT: BUG: one subclass run is skipped, and startup does not fail.');
  process.exitCode = 1;
} else {
  console.log('RESULT: FIXED');
}
