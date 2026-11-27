import 'reflect-metadata';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import * as grpcJs from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { Controller, Get, Inject, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { GRPCHealthIndicator, HealthCheckService, TerminusModule } from '@nestjs/terminus';

// A gRPC health server that answers SERVING
const require = createRequire(import.meta.url);
const terminusDist = dirname(require.resolve('@nestjs/terminus'));
const protoPath = join(terminusDist, 'health-indicator/microservice/protos/health.proto');
const definition = grpcJs.loadPackageDefinition(protoLoader.loadSync(protoPath));
const server = new grpcJs.Server();
server.addService(definition.grpc.health.v1.Health.service, {
  check: (_call, callback) => callback(null, { status: 1 }),
});
const grpcPort = await new Promise((resolve, reject) =>
  server.bindAsync('127.0.0.1:0', grpcJs.ServerCredentials.createInsecure(), (err, port) =>
    err ? reject(err) : resolve(port),
  ),
);
const url = `127.0.0.1:${grpcPort}`;

// The timeout an app reads from its configuration, e.g. config.get('GRPC_TIMEOUT'), when it is not set
const unsetTimeout = process.env.GRPC_TIMEOUT === undefined ? undefined : Number(process.env.GRPC_TIMEOUT);

const cases = {
  'no-options': {},
  'timeout-1000': { timeout: 1000 },
  'timeout-undefined': { timeout: unsetTimeout },
};

class HealthController {
  constructor(health, grpc) {
    this.health = health;
    this.grpc = grpc;
  }
  check(name) {
    return this.health.check([() => this.grpc.checkService('hero', 'hero.Service', { url, ...cases[name] })]);
  }
}
Inject(HealthCheckService)(HealthController, undefined, 0);
Inject(GRPCHealthIndicator)(HealthController, undefined, 1);
for (const name of Object.keys(cases)) {
  const method = `check_${name}`;
  HealthController.prototype[method] = function () {
    return this.check(name);
  };
  Get(name)(HealthController.prototype, method, Object.getOwnPropertyDescriptor(HealthController.prototype, method));
}
Controller('health')(HealthController);

class AppModule {}
Module({ imports: [TerminusModule.forRoot({ logger: false })], controllers: [HealthController] })(AppModule);

const app = await NestFactory.create(AppModule, { logger: false });
await app.listen(0, '127.0.0.1');
const base = await app.getUrl();

const rows = [
  ['grpc.checkService(..., {}) (control)', 'no-options'],
  ['grpc.checkService(..., { timeout: 1000 }) (control)', 'timeout-1000'],
  ['grpc.checkService(..., { timeout: undefined })', 'timeout-undefined'],
];
const results = {};
console.log('GET /health with a gRPC health check against a server that answers SERVING.\n');
for (const [label, name] of rows) {
  const res = await fetch(`${base}/health/${name}`);
  const body = await res.json();
  results[name] = res.status;
  const detail = body.info?.hero?.status ?? body.error?.hero?.status ?? body.message;
  console.log(`${label.padEnd(56)} HTTP ${res.status}  ${detail}`);
}

await app.close();
server.forceShutdown();

const bug = results['no-options'] === 200 && results['timeout-undefined'] !== 200;
console.log(
  bug
    ? `\nRESULT: BUG: with { timeout: undefined }, the health endpoint answers ${results['timeout-undefined']} instead of using the default timeout.`
    : '\nRESULT: FIXED',
);
process.exitCode = bug ? 1 : 0;
