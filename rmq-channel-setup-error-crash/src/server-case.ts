import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { CONFLICTING_QUEUE_OPTIONS, QUEUE, RMQ_URL } from './config';

@Module({})
class AppModule {}

async function main() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
    transport: Transport.RMQ,
    options: { urls: [RMQ_URL], queue: QUEUE, queueOptions: CONFLICTING_QUEUE_OPTIONS },
    logger: false,
  });
  const outcome = await Promise.race([
    app.listen().then(
      () => 'resolved',
      error => `rejected with: ${error.message}`,
    ),
    new Promise(resolve => setTimeout(() => resolve('still pending'), 3000)),
  ]);
  console.log(`listen() ${outcome}`);
  await app.close();
}

main();
