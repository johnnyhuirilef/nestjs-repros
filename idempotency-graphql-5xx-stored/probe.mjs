import 'reflect-metadata';
import { Controller, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Args, GraphQLModule, Mutation, Query, Resolver } from '@nestjs/graphql';
import { ApolloDriver } from '@nestjs/apollo';
import { IdempotencyModule, Idempotent } from '@nestjs/idempotency';
import { ResilienceModule, Timeout } from '@nestjs/resilience';

// A dependency that is slow on the first call and healthy after that
const state = { slow: true, runs: { http: 0, graphql: 0 } };
const charge = async () => {
  if (state.slow) await new Promise((resolve) => setTimeout(resolve, 300));
  return 'paid';
};

// The same handler over HTTP and as a GraphQL mutation: @Idempotent() and @Timeout(50)
class PaymentsController {
  async pay() {
    state.runs.http++;
    return { status: await charge() };
  }
}
class PaymentsResolver {
  ping() {
    return 'pong';
  }
  async pay(_idempotencyKey) {
    state.runs.graphql++;
    return charge();
  }
}

const method = (cls, name) => Object.getOwnPropertyDescriptor(cls.prototype, name);
const decorate = (cls, name, decorators) =>
  Object.defineProperty(cls.prototype, name, Reflect.decorate(decorators, cls.prototype, name, method(cls, name)));

decorate(PaymentsController, 'pay', [Post(), Idempotent(), Timeout(50)]);
Controller('pay')(PaymentsController);

// Plain JS has no emitted type metadata, so set the parameter types by hand
Reflect.defineMetadata('design:paramtypes', [String], PaymentsResolver.prototype, 'pay');
Args('idempotencyKey', { type: () => String })(PaymentsResolver.prototype, 'pay', 0);
decorate(PaymentsResolver, 'ping', [Query(() => String)]);
decorate(PaymentsResolver, 'pay', [Mutation(() => String), Idempotent(), Timeout(50)]);
Resolver()(PaymentsResolver);

// IdempotencyModule before ResilienceModule, as the resilience docs recommend
class AppModule {}
Module({
  imports: [
    IdempotencyModule.forRoot({}),
    ResilienceModule.forRoot({}),
    GraphQLModule.forRoot({ driver: ApolloDriver, autoSchemaFile: true }),
  ],
  controllers: [PaymentsController],
  providers: [PaymentsResolver],
})(AppModule);

const app = await NestFactory.create(AppModule, { logger: false });
await app.listen(0);
const base = await app.getUrl();

const callHttp = async (key) => {
  const res = await fetch(`${base}/pay`, { method: 'POST', headers: { 'idempotency-key': key } });
  const body = await res.json();
  return `HTTP ${res.status}  ${res.status < 300 ? body.status : body.message}`;
};
const callGraphql = async (key) => {
  const res = await fetch(`${base}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'apollo-require-preflight': 'true' },
    body: JSON.stringify({ query: `mutation { pay(idempotencyKey: "${key}") }` }),
  });
  const body = await res.json();
  if (!body.errors) return `data: ${body.data.pay}`;
  const { code, httpStatus } = body.errors[0].extensions;
  return `error: ${code} (httpStatus ${httpStatus})`;
};

console.log('A payment with @Idempotent() and @Timeout(50). The first call times out, then the dependency is healthy.\n');
const rows = [];
rows.push(['POST /pay (control), 1st call', await callHttp('key-http')]);
rows.push(['mutation pay, 1st call', await callGraphql('key-graphql')]);
await new Promise((resolve) => setTimeout(resolve, 400));
state.slow = false;
rows.push(['POST /pay (control), retry, same key', await callHttp('key-http')]);
rows.push(['mutation pay, retry, same key', await callGraphql('key-graphql')]);
for (const [label, result] of rows) console.log(`${label.padEnd(40)} ${result}`);
console.log(`\nHandler runs: POST /pay ${state.runs.http}, mutation pay ${state.runs.graphql}`);
await app.close();

if (state.runs.graphql === 1) {
  console.log('\nRESULT: BUG: the GraphQL TIMEOUT (504) is stored and replayed, so the retry with the same key does not run the mutation.');
  process.exit(1);
}
console.log('\nRESULT: FIXED');
