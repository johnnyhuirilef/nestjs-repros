import 'reflect-metadata';
import { Body, Controller, Module, Post, ValidationPipe } from '@nestjs/common';
import { APP_PIPE, NestFactory } from '@nestjs/core';
import { I18nModule, I18nValidationPipe, JsonI18nLoader, i18nValidationMessage } from '@nestjs/i18n';
import { Matches } from 'class-validator';

// Two @Matches on one property, each with its own message key.
class SignUpDto {}
Reflect.decorate(
  [
    Matches(/\d/, { message: i18nValidationMessage('users.passwordDigit') }),
    Matches(/[A-Z]/, { message: i18nValidationMessage('users.passwordUppercase') }),
  ],
  SignUpDto.prototype,
  'password',
);

class UsersController {
  signUp() {
    return { ok: true };
  }
}
Reflect.defineMetadata('design:paramtypes', [SignUpDto], UsersController.prototype, 'signUp');
Body()(UsersController.prototype, 'signUp', 0);
Reflect.decorate(
  [Post('sign-up')],
  UsersController.prototype,
  'signUp',
  Object.getOwnPropertyDescriptor(UsersController.prototype, 'signUp'),
);
Reflect.decorate([Controller('users')], UsersController);

async function run(name, pipe) {
  class AppModule {}
  Module({
    imports: [
      I18nModule.forRoot({
        defaultLocale: 'en',
        supportedLocales: ['en'],
        loader: new JsonI18nLoader({ path: new URL('../i18n', import.meta.url).pathname }),
      }),
    ],
    controllers: [UsersController],
    providers: [{ provide: APP_PIPE, useValue: pipe }],
  })(AppModule);
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  await app.listen(0);
  const url = await app.getUrl();
  const rows = [];
  for (const [password, expected] of [
    ['Abcdefgh', 'The password needs a digit.'],
    ['abcdefg1', 'The password needs an uppercase letter.'],
  ]) {
    const res = await fetch(`${url}/users/sign-up`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const { message } = await res.json();
    rows.push({ password, status: res.status, message, ok: message.length === 1 && message[0] === expected });
  }
  await app.close();
  return { name, rows };
}

const results = [await run('ValidationPipe (control)', new ValidationPipe()), await run('I18nValidationPipe', new I18nValidationPipe())];
for (const r of results) {
  console.log(`=== ${r.name} ===`);
  for (const row of r.rows) {
    console.log(`  "${row.password}" -> ${row.status} ${JSON.stringify(row.message)}${row.ok ? '' : '  <- wrong rule'}`);
  }
  console.log('');
}
const wrong = results[1].rows.filter((row) => !row.ok).length;
console.log(
  wrong === 0
    ? 'RESULT: FIXED: I18nValidationPipe shows the message of the rule that failed.'
    : `RESULT: BUG: I18nValidationPipe shows the message of the other rule for ${wrong} of 2 passwords.`,
);
process.exitCode = wrong === 0 && results[0].rows.every((row) => row.ok) ? 0 : 1;
