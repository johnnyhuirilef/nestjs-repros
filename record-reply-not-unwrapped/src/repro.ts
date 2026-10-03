import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ClientProxyFactory } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { PAYLOAD, PLAIN_PATTERN, RECORD_PATTERN } from './config';
import { TRANSPORTS, TransportName } from './transports';

/**
 * A handler that returns a record built with MqttRecordBuilder, NatsRecordBuilder
 * or RmqRecordBuilder should reply with the record data, and the record options
 * (MQTT qos and properties, NATS headers, RMQ options) should apply to the reply,
 * as they do when a client sends a record. The servers build the reply packet as
 * `{ response, isDisposed, id }`, but the record check and the record serializers
 * look at `packet.data`, so the reply carries the whole record and the options
 * are lost.
 *
 * For each transport, a Nest microservice runs one handler that returns a record
 * and one that returns a plain object. A Nest client and a raw client (not Nest)
 * send the same requests.
 *
 *   docker run --rm -d --name mqtt-repro -p 11883:1883 eclipse-mosquitto:2 mosquitto -c /mosquitto-no-auth.conf
 *   docker run --rm -d --name nats-repro -p 14222:4222 nats:2
 *   docker run --rm -d --name rmq-repro -p 15672:5672 rabbitmq:3.13
 *   npm run repro
 */
const show = (value: unknown) => JSON.stringify(value);

async function runTransport(name: TransportName): Promise<number> {
  const { module, options, rawReply } = TRANSPORTS[name];
  const server = await NestFactory.createMicroservice(module, { ...options, logger: false });
  await server.listen();
  const client = ClientProxyFactory.create(options as any);
  await client.connect();

  let failed = 0;
  for (const pattern of [PLAIN_PATTERN, RECORD_PATTERN]) {
    const isRecord = pattern === RECORD_PATTERN;
    const clientGot = await lastValueFrom(client.send(pattern, {}));
    const raw = await rawReply(pattern);
    const unwrapped = show(clientGot) === show(PAYLOAD) && show(raw.body) === show(PAYLOAD);
    const ok = unwrapped && (!isRecord || raw.optionsApplied);

    console.log(`=== ${name}: handler returns ${isRecord ? 'a record' : 'a plain object'} ===`);
    console.log(`  expected:       send() resolves with ${show(PAYLOAD)}${isRecord ? ' and the record options reach the reply' : ''}`);
    console.log(`  send() got:     ${show(clientGot)}`);
    console.log(`  raw reply body: ${show(raw.body)}`);
    console.log(`  reply options:  ${raw.observed}`);
    console.log(`  outcome:        ${ok ? 'as expected' : 'wrong'}`);
    console.log('');
    failed += ok ? 0 : 1;
  }

  await client.close();
  await server.close();
  return failed;
}

async function main() {
  let failed = 0;
  for (const name of Object.keys(TRANSPORTS) as TransportName[]) {
    failed += await runTransport(name);
  }
  console.log(
    failed === 0
      ? 'RESULT: FIXED: every reply carries the record data, and the record options apply on MQTT, NATS and RMQ.'
      : `RESULT: BUG: ${failed} of 6 cases did not end as expected (the record is not unwrapped, and its options are dropped).`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
