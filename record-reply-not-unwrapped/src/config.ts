export const MQTT_URL = process.env.MQTT_URL ?? 'mqtt://localhost:11883';
export const NATS_URL = process.env.NATS_URL ?? 'nats://localhost:14222';
export const RMQ_URL = process.env.RMQ_URL ?? 'amqp://localhost:15672';

export const RMQ_QUEUE = 'repro-queue';

// The two patterns every handler answers: one returns a record, one a plain object.
export const RECORD_PATTERN = 'record';
export const PLAIN_PATTERN = 'plain';

export const PAYLOAD = { message: 'hello' };
export const HEADER_NAME = 'x-repro';
export const HEADER_VALUE = 'record';
