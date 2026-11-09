// Plain JavaScript, so the decorators are applied with Reflect.decorate().
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AiModule, AiService } from '@nestjs/ai';
import { FakeModel, providerError } from '@nestjs/ai/testing';

// Each case: the model "default" fails with a 503 and falls back to "patient", a longer timeout.
async function run(label, sameLanguageModel) {
  const first = new FakeModel([providerError(503), 'from patient']);
  const second = sameLanguageModel ? first : new FakeModel(['from patient']);
  class AppModule {}
  Reflect.decorate([Module({
    imports: [AiModule.forRoot({ models: {
      default: { model: first, retry: false, timeout: '5s', fallback: 'patient' },
      patient: { model: second, retry: false, timeout: '2m' },
    } })],
  })], AppModule);

  const warnings = [];
  const logger = { log() {}, error() {}, debug() {}, verbose() {}, warn: (message) => warnings.push(String(message)) };
  const app = await NestFactory.createApplicationContext(AppModule, { logger });
  let outcome;
  try {
    const { text, model } = await app.get(AiService).generateText({ prompt: 'Hi' });
    outcome = `answered "${text}" from "${model.name}"`;
  } catch (error) {
    outcome = `rejected (${error.name})`;
  }
  const calls = first.calls.length + (sameLanguageModel ? 0 : second.calls.length);
  await app.close();
  console.log(`${label.padEnd(44)} ${outcome}, ${calls} model call(s), ${warnings.length} warning(s)`);
  for (const warning of warnings) console.log(`  warn: ${warning}`);
  return outcome.startsWith('answered');
}

console.log('"default" fails with a 503 and has fallback: "patient".\n');
const control = await run('Two LanguageModel objects (control)', false);
const shared = await run('One LanguageModel object for both', true);
console.log('');
const fixed = control && shared;
console.log(fixed
  ? 'RESULT: FIXED'
  : 'RESULT: BUG: the fallback "patient" is dropped with no warning when it shares the LanguageModel of "default".');
process.exitCode = fixed ? 0 : 1;
