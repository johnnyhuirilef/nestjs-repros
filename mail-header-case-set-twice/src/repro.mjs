// MailModule's `headers` are added to every message, and the docs say "A message's own
// headers win". The script sends mails whose own header differs from a default only in
// letter case, and prints what InMemoryMailTransport received, or the error.
import 'reflect-metadata';
import { Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { InMemoryMailTransport, MailModule, Mailer } from '@nestjs/mail';

// A mail class whose render() sets the header too (no decorators in a .mjs file)
class NewsletterMail {
  render() {
    return { subject: 'News', html: '<p>Hi</p>', headers: { 'X-Campaign': 'from-render' } };
  }
}
Injectable()(NewsletterMail);

const transport = new InMemoryMailTransport();
class AppModule {}
Module({
  imports: [MailModule.forRoot({ transport, from: 'app@example.com', headers: { 'X-Campaign': 'default' } })],
  providers: [NewsletterMail],
})(AppModule);

const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
const mailer = app.get(Mailer);

async function check(title, send) {
  transport.clear();
  const error = await send().then(() => undefined, (err) => err);
  console.log(`=== ${title} ===`);
  if (error) {
    console.log(`  ${error.name}: ${error.message}`);
  } else {
    console.log(`  sent with headers: ${JSON.stringify(transport.mails[0].headers)}`);
  }
  console.log();
  return !error;
}

const inline = (headers) => () => mailer.send({ to: 'user@example.com', subject: 'News', html: '<p>Hi</p>', headers });
const results = {
  sameCase: await check("default 'X-Campaign', message 'X-Campaign' (control)", inline({ 'X-Campaign': 'spring' })),
  otherCase: await check("default 'X-Campaign', message 'x-campaign'", inline({ 'x-campaign': 'spring' })),
  mailClass: await check("mail class: render() 'X-Campaign', send() 'x-campaign'", () =>
    mailer.send(NewsletterMail, { to: 'user@example.com', headers: { 'x-campaign': 'spring' } }),
  ),
};
await app.close();

const failed = Object.entries(results).filter(([, ok]) => !ok).map(([name]) => name);
if (results.sameCase && failed.length > 0) {
  console.log(`RESULT: BUG: a header that differs only in letter case does not win over the default (${failed.join(', ')}).`);
  process.exitCode = 1;
} else if (results.sameCase) {
  console.log('RESULT: FIXED: the message header wins in every case.');
} else {
  console.log('RESULT: the control failed, so the script cannot tell.');
  process.exitCode = 2;
}
