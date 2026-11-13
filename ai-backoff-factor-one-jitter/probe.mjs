import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { RetryPolicy } from '@nestjs/resilience';
import { AiModule, AiService } from '@nestjs/ai';
import { FakeModel, providerError } from '@nestjs/ai/testing';

const DELAY = 300;
const FAILURES = 3;

// The waits between the attempts of a call that fails FAILURES times with a 503, then answers.
function failingThenOk() {
  const times = [];
  const answer = () => {
    times.push(Date.now());
    return times.length <= FAILURES ? providerError(503) : { text: 'ok' };
  };
  const waits = () => times.slice(1).map((time, i) => time - times[i]);
  return { answer, waits };
}

async function viaAi(backoff) {
  const { answer, waits } = failingThenOk();
  const moduleRef = await Test.createTestingModule({
    imports: [AiModule.forRoot({ models: { default: new FakeModel(answer) } })],
  }).compile();
  await moduleRef.init();
  await moduleRef.get(AiService).generateText({ prompt: 'Hi', retry: { attempts: FAILURES + 1, backoff } });
  await moduleRef.close();
  return waits();
}

async function viaResilience(backoff) {
  const { answer, waits } = failingThenOk();
  const policy = new RetryPolicy({ attempts: FAILURES + 1, retryIf: () => true, backoff });
  await policy.execute(async () => {
    const result = answer();
    if (result instanceof Error) throw result;
    return result;
  });
  return waits();
}

const constant = (waits) => waits.every((wait) => wait >= DELAY - 20);
function show(label, waits) {
  console.log(`${label.padEnd(62)} waits: ${waits.map((wait) => `${wait} ms`).join(', ')}`);
  return waits;
}

console.log(`A call that fails ${FAILURES} times with a 503, then answers. backoff: { delay: '${DELAY}ms', factor: 1 }.\n`);
show("@nestjs/resilience RetryPolicy, factor 1 (control)", await viaResilience({ delay: `${DELAY}ms`, factor: 1 }));
show("@nestjs/ai, factor 1 and jitter: 'none' (control)", await viaAi({ delay: `${DELAY}ms`, factor: 1, jitter: 'none' }));
const waits = show('@nestjs/ai, factor 1', await viaAi({ delay: `${DELAY}ms`, factor: 1 }));

console.log('');
console.log(constant(waits)
  ? 'RESULT: FIXED'
  : `RESULT: BUG: with factor 1, @nestjs/ai waits a random time below ${DELAY} ms, while @nestjs/resilience waits ${DELAY} ms each time.`);
process.exitCode = constant(waits) ? 0 : 1;
