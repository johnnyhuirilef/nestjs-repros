import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  AuthenticationModule,
  AuthenticationRegistry,
  PasswordHasher,
  PasswordResetHandler,
  PasswordResetService,
} from '@nestjs/authentication';

const user = { id: 'u1', email: 'ada@example.com', passwordHash: '' };
const links = [];
const failOnce = { findUser: false, updatePassword: false };

class ResetHandler extends PasswordResetHandler {
  findUser(email) {
    if (failOnce.findUser) {
      failOnce.findUser = false;
      throw new Error('the database is briefly unavailable');
    }
    return email === user.email ? { ...user } : null;
  }
  send(link) {
    links.push(link.url);
  }
  updatePassword(id, passwordHash) {
    if (failOnce.updatePassword) {
      failOnce.updatePassword = false;
      throw new Error('the database is briefly unavailable');
    }
    user.passwordHash = passwordHash;
  }
}

class AppModule {}
Module({
  imports: [AuthenticationModule.forRoot({ passwordReset: { url: 'https://app.test/reset' } })],
  providers: [
    {
      provide: 'RESET_HANDLER',
      inject: [AuthenticationRegistry],
      useFactory: (registry) => {
        const handler = new ResetHandler();
        registry.registerHandler('passwordReset', handler);
        return handler;
      },
    },
  ],
})(AppModule);

const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
await app.init();
const resets = app.get(PasswordResetService);
const hasher = app.get(PasswordHasher);

async function newLink() {
  user.passwordHash = await hasher.hash('old password');
  links.length = 0;
  resets.request(user.email);
  while (links.length === 0) await new Promise((r) => setTimeout(r, 10));
  return new URL(links[0]).searchParams.get('token');
}

async function attempt(label, token) {
  let answer;
  try {
    const result = await resets.reset(token, 'new password 123');
    answer = result ? `result for ${result.userId}` : 'null';
  } catch (error) {
    answer = `throws: ${error.message}`;
  }
  console.log(`  ${label.padEnd(30)}${answer}`);
}

async function passwords() {
  const isNew = await hasher.verify('new password 123', user.passwordHash);
  const isOld = await hasher.verify('old password', user.passwordHash);
  console.log(`  ${'password in the database:'.padEnd(30)}${isNew ? 'new' : isOld ? 'old' : 'other'}`);
  return isNew;
}

console.log('=== The handler works (control) ===');
let token = await newLink();
await attempt('reset with the link:', token);
const control = await passwords();

// hash() and revokeSignIns() are not part of the handler, so the script makes
// them reject once by replacing them on the instance.
function failNextCall(target, name) {
  const original = target[name];
  target[name] = function (...args) {
    target[name] = original;
    return Promise.reject(new Error(`${name}() failed`));
  };
}

const steps = {
  findUser: () => (failOnce.findUser = true),
  hash: () => failNextCall(hasher, 'hash'),
  revokeSignIns: () => failNextCall(resets, 'revokeSignIns'),
  updatePassword: () => (failOnce.updatePassword = true),
};
const failures = [];
for (const [step, arm] of Object.entries(steps)) {
  console.log(`\n=== ${step}() fails once ===`);
  token = await newLink();
  arm();
  await attempt('reset with the link:', token);
  await attempt('retry with the same link:', token);
  if (!(await passwords())) failures.push(step);
}

await app.close();

console.log();
if (!control) {
  console.log('RESULT: UNEXPECTED: the control did not set the new password.');
  process.exit(2);
}
if (failures.length > 0) {
  console.log(`RESULT: SPENT: in ${failures.length} of ${Object.keys(steps).length} cases, after one failed step, the same link no longer resets the password.`);
  process.exit(1);
}
console.log('RESULT: FIXED: after each failure, the retry with the same link sets the new password.');
