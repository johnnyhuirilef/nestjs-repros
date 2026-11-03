// FileTemplateEngine checks the locale's shape, since "it becomes part of a file name", but not
// its length. The script sends template mails with long locales that pass that check, and prints
// the error, how long the event loop was blocked, and how the engine's file cache grows.
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FileTemplateEngine, InMemoryMailTransport, MailModule, Mailer } from '@nestjs/mail';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../templates', import.meta.url));
const engine = new FileTemplateEngine({ dir });
const transport = new InMemoryMailTransport();
class AppModule {}
Module({ imports: [MailModule.forRoot({ transport, from: 'app@example.com', templates: engine })] })(AppModule);

const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
const mailer = app.get(Mailer);
// Resolves to the HTML that the transport received
async function send(locale) {
  try {
    await mailer.send({ to: 'user@example.com', subject: 'Hi', template: 'hello', context: {}, locale });
    return transport.mails[0].html;
  } finally {
    transport.clear();
  }
}
// "a-a-a-...": every subtag is one letter, so the locale passes the engine's check
const tags = (length, letter = 'a') => `${letter}-`.repeat(Math.floor(length / 2)) + letter;

console.log("=== locale 'pl' (control) ===");
const html = await send('pl').catch((err) => `${err.name}: ${err.message}`);
const control = html.includes('Czesc');
console.log(`  sent: ${html.trim()}`);
console.log();

console.log(`=== locale of ${tags(1000).length} characters ===`);
const error = await send(tags(1000)).then(() => undefined, (err) => err);
const raw = error?.code === 'ENAMETOOLONG';
console.log(`  ${error ? `${error.name}${error.code ? ` (${error.code})` : ''}` : 'sent'}`);
console.log(`  the message has the absolute path of the templates directory: ${error?.message.includes(dir) ? 'yes' : 'no'}`);
console.log();

console.log(`=== locale of ${tags(100_000).length} characters ===`);
// A timer every millisecond: the longest gap between two ticks is how long the loop was blocked
let last = performance.now();
let blocked = 0;
const timer = setInterval(() => {
  const now = performance.now();
  blocked = Math.max(blocked, now - last);
  last = now;
}, 1);
await new Promise((done) => setTimeout(done, 20));
const start = performance.now();
await send(tags(100_000)).catch(() => {});
await new Promise((done) => setTimeout(done, 20));
clearInterval(timer);
console.log(`  send() took ${Math.round(performance.now() - start)} ms, longest event loop delay ${Math.round(blocked)} ms`);
console.log();

// 3000 locales of `length` characters, each different: `${letter}0000-x-x-...`, `${letter}0001-x-x-...`
const distinct = (length, letter) =>
  Array.from({ length: 3000 }, (_, i) => `${letter}${i.toString(36).padStart(4, '0')}-${tags(length - 6, letter)}`);

async function grow(locales) {
  console.log(`=== 3000 mails, each with its own locale of ${locales[0].length} characters ===`);
  globalThis.gc();
  const files = engine.files.size; // the engine's private cache of looked-up files
  const heap = process.memoryUsage().heapUsed;
  for (const locale of locales) {
    await send(locale).catch(() => {});
  }
  globalThis.gc();
  const added = engine.files.size - files;
  console.log(`  cache entries added: ${added}, heap growth after gc: ${((process.memoryUsage().heapUsed - heap) / 1e6).toFixed(1)} MB`);
  console.log();
  return added;
}
const longGrowth = await grow(distinct(241, 'a'));
await grow(distinct(35, 'b'));
await app.close();

const found = [raw && 'raw ENAMETOOLONG', blocked > 100 && 'event loop blocked', longGrowth > 0 && 'cache grows'].filter(Boolean);
if (!control) {
  console.log('RESULT: the control failed, so the script cannot tell.');
  process.exitCode = 2;
} else if (found.length > 0) {
  console.log(`RESULT: BUG: a long locale that passes the check reaches the file system (${found.join(', ')}).`);
  process.exitCode = 1;
} else {
  console.log('RESULT: FIXED: a long locale is refused before any file lookup.');
}
