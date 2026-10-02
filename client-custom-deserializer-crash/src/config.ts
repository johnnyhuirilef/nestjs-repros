export const TCP_PORT = Number(process.env.TCP_PORT ?? 19001);
export const REDIS_PORT = Number(process.env.REDIS_PORT ?? 16379);
export const MQTT_URL = process.env.MQTT_URL ?? 'mqtt://localhost:11883';
export const RMQ_URL = process.env.RMQ_URL ?? 'amqp://localhost:15672';

export const PATTERN = 'repro';
export const RMQ_QUEUE = 'repro-queue';

// Replies a Nest responder never sends: the custom deserializer reads `meta.id`,
// so a payload without `meta` makes it throw. Any publisher on the reply topic
// can send one.
export const foreignReply = (id: string) => JSON.stringify({ id, body: 'x' });
// What the custom deserializer expects.
export const wellFormedReply = (id: string) => JSON.stringify({ meta: { id }, body: 'ok' });
