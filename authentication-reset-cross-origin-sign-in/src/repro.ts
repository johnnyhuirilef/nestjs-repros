import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AuthenticationModule, PasswordHasher } from '@nestjs/authentication';
import { Accounts, SessionAuth } from './accounts.js';
import { ResetController } from './reset.controller.js';

const TRUSTED_ORIGIN = 'https://trusted.example.com';
const UNTRUSTED_ORIGIN = 'https://spa.example.com';
const OLD_PASSWORD = 'old-password-1';
const NEW_PASSWORD = 'new-password-2';
const LINK_POLL_MILLISECONDS = 20;
const LINK_TIMEOUT_MILLISECONDS = 5000;

@Module({
  imports: [
    AuthenticationModule.forRoot({
      passwordReset: { url: 'http://127.0.0.1/reset' },
      session: { cookie: { secure: false }, trustedOrigins: [TRUSTED_ORIGIN] },
    }),
  ],
  controllers: [ResetController],
  providers: [Accounts, SessionAuth],
})
class AppModule {}

interface Answer {
  status: number;
  body: string;
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function post(baseUrl: string, path: string, origin: string | undefined, payload: object): Promise<Answer> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (origin) {
    headers['origin'] = origin;
    headers['sec-fetch-site'] = 'same-site';
  }
  const response = await fetch(baseUrl + path, { method: 'POST', headers, body: JSON.stringify(payload) });
  return { status: response.status, body: await response.text() };
}

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, new ExpressAdapter(), { logger: false, abortOnError: false });
  await app.listen(0, '127.0.0.1');
  const baseUrl = await app.getUrl();
  const accounts = app.get(Accounts);

  // The server sends the link after it answers, so wait until the mailbox has it.
  async function freshLink(): Promise<string> {
    await accounts.createUser(OLD_PASSWORD);
    await post(baseUrl, '/forgot', undefined, {});
    const deadline = Date.now() + LINK_TIMEOUT_MILLISECONDS;
    while (Date.now() < deadline) {
      const token = accounts.takeResetToken();
      if (token) return token;
      await wait(LINK_POLL_MILLISECONDS);
    }
    throw new Error('No reset link arrived in the mailbox');
  }

  const show = (label: string, answer: Answer) => console.log(`${label.padEnd(14)} ${answer.status} ${answer.body}`);

  console.log('--- case 1: control, trusted origin, signIn true ---');
  const controlToken = await freshLink();
  const control = await post(baseUrl, '/reset', TRUSTED_ORIGIN, { token: controlToken, password: NEW_PASSWORD, signIn: true });
  show('POST /reset:', control);

  console.log('\n--- case 2: untrusted origin, signIn true ---');
  const bugToken = await freshLink();
  const bug = await post(baseUrl, '/reset', UNTRUSTED_ORIGIN, { token: bugToken, password: NEW_PASSWORD, signIn: true });
  show('POST /reset:', bug);
  const newPasswordWorks = await accounts.passwordMatches(NEW_PASSWORD);
  const oldPasswordWorks = await accounts.passwordMatches(OLD_PASSWORD);
  console.log(`new password works: ${newPasswordWorks}`);
  console.log(`old password works: ${oldPasswordWorks}`);
  const retry = await post(baseUrl, '/reset', TRUSTED_ORIGIN, { token: bugToken, password: 'retry-password-3', signIn: true });
  show('retry, trusted:', retry);
  const linkSpent = retry.status === 200 && retry.body.includes('"ok":false');
  console.log(`link spent:         ${linkSpent}`);

  console.log('\n--- case 3: untrusted origin, signIn false ---');
  const plainToken = await freshLink();
  const plain = await post(baseUrl, '/reset', UNTRUSTED_ORIGIN, { token: plainToken, password: NEW_PASSWORD, signIn: false });
  show('POST /reset:', plain);

  await app.close();

  const isBug = bug.status === 403 && newPasswordWorks && !oldPasswordWorks && linkSpent;
  console.log(`\nRESULT: ${isBug ? 'BUG' : 'OK'}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
