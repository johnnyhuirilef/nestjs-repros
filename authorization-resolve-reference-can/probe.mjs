// A @Can() on a federation @ResolveReference(), against the same @Can() on a @Query() (control).
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Args, GraphQLModule, Query, ResolveReference, Resolver } from '@nestjs/graphql';
import { ApolloFederationDriver } from '@nestjs/apollo';
import { AuthorizationModule, Can, Policy } from '@nestjs/authorization';

const typeDefs = `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"])
  type User @key(fields: "id") { id: ID! secret: String }
  type Query { user(id: ID!): User }
`;

// Only admins may view a user. The requests below send no user, so both must be denied.
class UserPolicy {
  view(user) {
    return !!user?.roles?.includes('admin');
  }
}
Policy()(UserPolicy);

let calls = 0;
const load = (id) => {
  calls += 1;
  return { id, secret: `secret of user ${id}` };
};

class UsersResolver {
  user(id) {
    return load(id);
  }
  resolveReference(reference) {
    return load(reference.id);
  }
}
const descriptor = (key) => Object.getOwnPropertyDescriptor(UsersResolver.prototype, key);
Args('id')(UsersResolver.prototype, 'user', 0);
Reflect.decorate([Query('user'), Can(UserPolicy, 'view')], UsersResolver.prototype, 'user', descriptor('user'));
Reflect.decorate([ResolveReference(), Can(UserPolicy, 'view')], UsersResolver.prototype, 'resolveReference',
  descriptor('resolveReference'));
Resolver('User')(UsersResolver);

class AppModule {}
Module({
  imports: [
    // Default options: no fieldResolverEnhancers.
    GraphQLModule.forRoot({ driver: ApolloFederationDriver, typeDefs, context: ({ req }) => ({ req }) }),
    AuthorizationModule.forRoot({ policies: [UserPolicy] }),
  ],
  providers: [UsersResolver],
})(AppModule);

const quiet = { log() {}, warn() {}, debug() {}, verbose() {}, error() {} };
console.log("No user is signed in. UserPolicy.view allows only admins. Both resolvers have @Can(UserPolicy, 'view').\n");

const app = await NestFactory.create(AppModule, { logger: quiet, abortOnError: false });
try {
  await app.listen(0, '127.0.0.1');
} catch (error) {
  console.log(`Startup failed: ${error.message}\n`);
  const fixed = error.message.includes('UsersResolver.resolveReference is not enforced');
  console.log(fixed ? 'RESULT: FIXED: startup reports the @Can() on the @ResolveReference().' : 'RESULT: UNEXPECTED');
  process.exit(fixed ? 0 : 2);
}
console.log('Startup: no error.\n');
const url = `${await app.getUrl()}/graphql`;

async function ask(label, query) {
  calls = 0;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await response.json();
  const errors = (body.errors ?? []).map((error) => `${error.message} (${error.extensions?.code})`);
  console.log(`${label}\n  data: ${JSON.stringify(body.data)}\n  errors: ${JSON.stringify(errors)}\n  resolver ran: ${calls}\n`);
  return { body, calls };
}

const control = await ask('@Query user (control)', '{ user(id: "7") { id secret } }');
const reference = await ask(
  '@ResolveReference, through _entities',
  '{ _entities(representations: [{ __typename: "User", id: "7" }]) { ... on User { id secret } } }',
);
await app.close();

const controlDenied = control.calls === 0 && !control.body.data?.user;
const leaked = reference.calls > 0 && !!reference.body.data?._entities?.[0]?.secret;
console.log(
  controlDenied && leaked
    ? 'RESULT: BUG: the @Can() on the @ResolveReference() is not enforced, and startup does not report it.'
    : `RESULT: UNEXPECTED: control denied ${controlDenied}, reference resolver returned the data ${leaked}.`,
);
process.exitCode = controlDenied && leaked ? 1 : 2;
