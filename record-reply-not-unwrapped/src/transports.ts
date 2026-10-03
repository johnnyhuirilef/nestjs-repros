import { connect as connectNats } from '@nats-io/transport-node';
import amqp from 'amqplib';
import mqtt from 'mqtt';
import { MqttModule, NatsModule, RmqModule } from './handlers';
import { HEADER_NAME, MQTT_URL, NATS_URL, RMQ_QUEUE, RMQ_URL } from './config';
import { Transport } from '@nestjs/microservices';

export type TransportName = 'MQTT' | 'NATS' | 'RMQ';

// What a raw client (not Nest) sees on the reply of one request.
export interface RawReply {
  body: unknown;
  // The part of the reply a record option should change.
  observed: string;
  // True when the record options reached the reply.
  optionsApplied: boolean;
}

const requestFor = (pattern: string) => JSON.stringify({ pattern, data: {}, id: 'raw-request' });

async function rawMqttReply(pattern: string): Promise<RawReply> {
  const spy = await mqtt.connectAsync(MQTT_URL, { protocolVersion: 5 });
  const replyTopic = `${pattern}/reply`;
  await spy.subscribeAsync(replyTopic, { qos: 2 });
  const received = new Promise<{ payload: Buffer; qos: number; properties: any }>(resolve =>
    spy.once('message', (_topic, payload, packet) =>
      resolve({ payload, qos: packet.qos, properties: packet.properties }),
    ),
  );
  await spy.publishAsync(pattern, requestFor(pattern));
  const { payload, qos, properties } = await received;
  await spy.endAsync();
  const userProperty = properties?.userProperties?.[HEADER_NAME];
  return {
    body: JSON.parse(payload.toString()).response,
    observed: `qos ${qos}, userProperties ${JSON.stringify(properties?.userProperties ?? null)}`,
    optionsApplied: qos === 1 && userProperty !== undefined,
  };
}

async function rawNatsReply(pattern: string): Promise<RawReply> {
  const connection = await connectNats({ servers: NATS_URL });
  const reply = await connection.request(pattern, requestFor(pattern), { timeout: 3000 });
  const header = reply.headers?.get(HEADER_NAME) ?? '';
  await connection.close();
  return {
    body: reply.json<{ response: unknown }>().response,
    observed: `headers ${JSON.stringify(header ? { [HEADER_NAME]: header } : null)}`,
    optionsApplied: header !== '',
  };
}

async function rawRmqReply(pattern: string): Promise<RawReply> {
  const connection = await amqp.connect(RMQ_URL);
  const channel = await connection.createChannel();
  const { queue: replyTo } = await channel.assertQueue('', { exclusive: true });
  const received = new Promise<amqp.ConsumeMessage>(resolve =>
    channel.consume(replyTo, message => message && resolve(message), { noAck: true }),
  );
  channel.sendToQueue(RMQ_QUEUE, Buffer.from(requestFor(pattern)), { replyTo, correlationId: 'raw-request' });
  const { content, properties } = await received;
  await connection.close();
  return {
    body: JSON.parse(content.toString()).response,
    observed: `priority ${properties.priority}, headers ${JSON.stringify(properties.headers ?? null)}`,
    optionsApplied: properties.priority === 5 && properties.headers?.[HEADER_NAME] !== undefined,
  };
}

export const TRANSPORTS = {
  MQTT: {
    module: MqttModule,
    options: { transport: Transport.MQTT, options: { url: MQTT_URL, protocolVersion: 5 } },
    rawReply: rawMqttReply,
  },
  NATS: {
    module: NatsModule,
    options: { transport: Transport.NATS, options: { servers: [NATS_URL] } },
    rawReply: rawNatsReply,
  },
  RMQ: {
    module: RmqModule,
    options: {
      transport: Transport.RMQ,
      options: { urls: [RMQ_URL], queue: RMQ_QUEUE, queueOptions: { durable: false } },
    },
    rawReply: rawRmqReply,
  },
};
