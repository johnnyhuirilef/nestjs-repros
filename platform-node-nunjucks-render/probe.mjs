import 'reflect-metadata';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Controller, Get, Module, Render } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NodeAdapter } from '@nestjs/platform-node';
import { FastifyAdapter } from '@nestjs/platform-fastify';

const require = createRequire(import.meta.url);
const views = join(import.meta.dirname, 'views');

class AppController {
  index() {
    return { name: 'Nest' };
  }
}
Reflect.decorate([Get(), Render('index')], AppController.prototype, 'index', Object.getOwnPropertyDescriptor(AppController.prototype, 'index'));
Reflect.decorate([Controller()], AppController);
class AppModule {}
Reflect.decorate([Module({ controllers: [AppController] })], AppModule);

const errors = [];
const logger = { log() {}, warn() {}, debug() {}, verbose() {}, fatal() {}, error: (message) => errors.push(String(message)) };

async function run(label, adapter, engine) {
  errors.length = 0;
  const app = await NestFactory.create(AppModule, adapter, { logger });
  app.setViewEngine({ engine, templates: views });
  await app.listen(0, '127.0.0.1');
  const response = await fetch(`${await app.getUrl()}/`);
  const body = (await response.text()).trim();
  await app.close();
  console.log(label.padEnd(36), response.status, JSON.stringify(body));
  if (errors.length) console.log(''.padEnd(36), 'logged error:', errors[0]);
  return response.status;
}

const nunjucks = { nunjucks: require('nunjucks') };
const handlebars = { handlebars: require('handlebars') };

console.log('Same @Render("index") route and setViewEngine({ engine, templates }) options on each adapter.\n');
const nodeHandlebars = await run('NodeAdapter, handlebars (control)', new NodeAdapter(), handlebars);
const fastifyNunjucks = await run('FastifyAdapter, nunjucks (control)', new FastifyAdapter(), nunjucks);
const nodeNunjucks = await run('NodeAdapter, nunjucks', new NodeAdapter(), nunjucks);

const bug = nodeHandlebars === 200 && fastifyNunjucks === 200 && nodeNunjucks !== 200;
console.log(bug
  ? '\nRESULT: BUG: @Render() with nunjucks fails on the NodeAdapter, although the same options render on Fastify.'
  : '\nRESULT: FIXED');
process.exitCode = bug ? 1 : 0;
