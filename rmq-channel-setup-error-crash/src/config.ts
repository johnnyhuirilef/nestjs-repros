export const RMQ_URL = process.env.RMQ_URL ?? 'amqp://localhost:5672';
export const QUEUE = 'repro-conflict';

// The queue is declared durable by the script, so any client or server that
// declares the same queue as non-durable gets a 406 PRECONDITION_FAILED.
export const CONFLICTING_QUEUE_OPTIONS = { durable: false };
