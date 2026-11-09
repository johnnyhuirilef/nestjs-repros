import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { CircuitBreakerPolicy, ResiliencePolicy, RetryPolicy } from '@nestjs/resilience';
import { AiModule, AiService } from '@nestjs/ai';
import { FakeEmbeddingModel, FakeModel } from '@nestjs/ai/testing';

// Models that take 1.5s to answer.
const slowModel = () => new FakeModel(() => ({ text: 'slow answer', delay: 1_500 }));
const slowEmbeddingModel = () => new FakeEmbeddingModel(() => ({ embeddings: [[1, 2]], delay: 1_500 }));

// A policy the app shares with its other calls to the provider: a circuit breaker, and its own retries.
const appPolicy = () =>
  ResiliencePolicy.wrap(
    new CircuitBreakerPolicy({ name: 'llm', minimumCalls: 5, slidingWindow: { type: 'count', size: 10 }, openDuration: '30s' }),
    new RetryPolicy({ attempts: 3 }),
  );

async function run(label, options, call) {
  const moduleRef = await Test.createTestingModule({ imports: [AiModule.forRoot(options)] }).compile();
  await moduleRef.init();
  const ai = moduleRef.get(AiService);
  const started = Date.now();
  let outcome;
  try {
    await call(ai);
    outcome = 'resolved';
  } catch (error) {
    outcome = `rejected (${error.constructor.name})`;
  }
  const elapsed = Math.round((Date.now() - started) / 100) * 100;
  await moduleRef.close();
  console.log(`${label.padEnd(58)} ${outcome} after ~${elapsed} ms`);
  return elapsed;
}

const generate = (ai) => ai.generateText({ prompt: 'Hi', timeout: '200ms', retry: false });
const embed = (ai) => ai.embed({ value: 'Hi', timeout: '200ms', retry: false });

console.log("Each call sets timeout: '200ms' and retry: false. The model takes 1.5s.\n");
const results = [
  await run('generateText(), no resilience (control)', { models: { default: slowModel() } }, generate),
  await run('generateText(), the model sets resilience', { models: { default: { model: slowModel(), resilience: appPolicy() } } }, generate),
  await run('generateText(), defaults set resilience', { models: { default: slowModel() }, defaults: { resilience: appPolicy() } }, generate),
  await run('embed(), embeddingDefaults set resilience', { embeddingModels: { default: slowEmbeddingModel() }, embeddingDefaults: { resilience: appPolicy() } }, embed),
];

const ignored = results.filter((elapsed) => elapsed >= 1_000).length;
console.log('');
console.log(ignored === 0
  ? 'RESULT: FIXED'
  : `RESULT: BUG: the call's timeout is ignored in ${ignored} of 4 cases, whenever a resilience policy is set.`);
process.exitCode = ignored === 0 ? 0 : 1;
