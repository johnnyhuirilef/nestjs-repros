// A getUser method of a useClass options factory that returns itself, against a getUser arrow function (control).
import 'reflect-metadata';
import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AuthorizationModule, Can, Policy } from '@nestjs/authorization';

const alice = { id: 1, roles: ['writer'] };

class PostPolicy {
  create(user) {
    return !!user?.roles.includes('writer');
  }
}
Policy()(PostPolicy);

class PostsController {
  list() {
    return ['ok'];
  }
}
Reflect.decorate([Get(), Can(PostPolicy, 'create')], PostsController.prototype, 'list',
  Object.getOwnPropertyDescriptor(PostsController.prototype, 'list'));
Controller('posts')(PostsController);

// The options factory returns itself, so getUser is a method that reads this.user.
class AuthorizationConfig {
  user = alice;
  createAuthorizationOptions() {
    return this;
  }
  getUser() {
    return this.user;
  }
}
Injectable()(AuthorizationConfig);

const errors = [];
const logger = { log() {}, warn() {}, debug() {}, verbose() {}, error: (message) => errors.push(String(message)) };

async function run(label, authorization) {
  class AppModule {}
  Module({ imports: [authorization], controllers: [PostsController] })(AppModule);
  const app = await NestFactory.create(AppModule, { logger });
  await app.listen(0, '127.0.0.1');
  errors.length = 0;
  const response = await fetch(`${await app.getUrl()}/posts`);
  const body = await response.text();
  await app.close();
  console.log(`${label.padEnd(52)} GET /posts -> ${response.status} ${body}`);
  for (const error of errors) {
    console.log(`  error: ${error}`);
  }
  return response.status;
}

console.log('Both cases give the user alice (a writer). PostPolicy.create allows writers.\n');
const control = await run('getUser arrow function, useFactory (control)', AuthorizationModule.forRootAsync({
  useFactory: () => ({ getUser: () => alice }),
  policies: [PostPolicy],
}));
const method = await run('getUser method, useClass that returns this', AuthorizationModule.forRootAsync({
  useClass: AuthorizationConfig,
  policies: [PostPolicy],
}));

const bug = control === 200 && method === 500;
console.log(
  bug
    ? '\nRESULT: BUG: the guard calls getUser without its object, so a getUser method that uses `this` fails with 500.'
    : method === 200
      ? '\nRESULT: FIXED: the guard calls getUser on the options, so the method can use `this`.'
      : `\nRESULT: UNEXPECTED: control ${control}, method ${method}.`,
);
process.exitCode = bug ? 1 : 0;
