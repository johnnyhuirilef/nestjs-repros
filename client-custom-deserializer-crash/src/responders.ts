import amqp from 'amqplib';
import { createServer } from 'net';
import mqtt from 'mqtt';
import Redis from 'ioredis';
import { MQTT_URL, PATTERN, REDIS_PORT, RMQ_QUEUE, RMQ_URL, TCP_PORT } from './config';

export type Transport = 'tcp' | 'redis' | 'mqtt' | 'rmq';
type Stop = () => Promise<unknown>;

type GetReply = (requestId: string) => string;

const requestIdOf = (json: string): string => JSON.parse(json).id;

// Plain responders, not Nest servers: each one answers every request with
// whatever `getReply(requestId)` returns, like a non-Nest service on the same broker.

async function respondTcp(getReply: GetReply): Promise<Stop> {
  const server = createServer(socket =>
    socket.on('data', data => {
      const reply = getReply(requestIdOf(data.toString().replace(/^\d+#/, '')));
      socket.write(`${Buffer.byteLength(reply)}#${reply}`);
    }),
  );
  await new Promise<void>(resolve => server.listen(TCP_PORT, resolve));
  return () => new Promise(resolve => server.close(resolve));
}

async function respondRedis(getReply: GetReply): Promise<Stop> {
  const subscriber = new Redis(REDIS_PORT);
  const publisher = new Redis(REDIS_PORT);
  await subscriber.subscribe(PATTERN);
  subscriber.on('message', (_channel, message) =>
    publisher.publish(`${PATTERN}.reply`, getReply(requestIdOf(message))),
  );
  return async () => {
    subscriber.disconnect();
    publisher.disconnect();
  };
}

async function respondMqtt(getReply: GetReply): Promise<Stop> {
  const responder = mqtt.connect(MQTT_URL);
  await new Promise(resolve => responder.on('connect', resolve));
  await responder.subscribeAsync(PATTERN);
  responder.on('message', (_topic, payload) =>
    responder.publish(`${PATTERN}/reply`, getReply(requestIdOf(payload.toString()))),
  );
  return () => responder.endAsync();
}

async function respondRmq(getReply: GetReply): Promise<Stop> {
  const connection = await amqp.connect(RMQ_URL);
  const channel = await connection.createChannel();
  await channel.assertQueue(RMQ_QUEUE, { durable: true });
  await channel.consume(RMQ_QUEUE, message => {
    // RabbitMQ delivers null when the consumer is cancelled, e.g. by deleting the queue.
    if (!message) return;
    channel.sendToQueue(message.properties.replyTo, Buffer.from(getReply(requestIdOf(message.content.toString()))), {
      correlationId: message.properties.correlationId,
    });
    channel.ack(message);
  });
  return async () => {
    await channel.deleteQueue(RMQ_QUEUE);
    await connection.close();
  };
}

export const RESPONDERS: Record<Transport, (getReply: GetReply) => Promise<Stop>> = {
  tcp: respondTcp,
  redis: respondRedis,
  mqtt: respondMqtt,
  rmq: respondRmq,
};
