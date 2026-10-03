import { headers as natsHeaders } from '@nats-io/nats-core';
import { Controller, Module } from '@nestjs/common';
import {
  MessagePattern,
  MqttRecordBuilder,
  NatsRecordBuilder,
  RmqRecordBuilder,
} from '@nestjs/microservices';
import { HEADER_NAME, HEADER_VALUE, PAYLOAD, PLAIN_PATTERN, RECORD_PATTERN } from './config';

// Each handler returns a record built with the builder of its transport. The
// options ask for something a client can observe on the reply.

@Controller()
class MqttController {
  @MessagePattern(RECORD_PATTERN)
  record() {
    return new MqttRecordBuilder(PAYLOAD)
      .setQoS(1)
      .setProperties({ userProperties: { [HEADER_NAME]: HEADER_VALUE } })
      .build();
  }

  @MessagePattern(PLAIN_PATTERN)
  plain() {
    return PAYLOAD;
  }
}

@Controller()
class NatsController {
  @MessagePattern(RECORD_PATTERN)
  record() {
    const headers = natsHeaders();
    headers.set(HEADER_NAME, HEADER_VALUE);
    return new NatsRecordBuilder(PAYLOAD).setHeaders(headers).build();
  }

  @MessagePattern(PLAIN_PATTERN)
  plain() {
    return PAYLOAD;
  }
}

@Controller()
class RmqController {
  @MessagePattern(RECORD_PATTERN)
  record() {
    return new RmqRecordBuilder(PAYLOAD)
      .setOptions({ priority: 5, headers: { [HEADER_NAME]: HEADER_VALUE } })
      .build();
  }

  @MessagePattern(PLAIN_PATTERN)
  plain() {
    return PAYLOAD;
  }
}

@Module({ controllers: [MqttController] })
export class MqttModule {}

@Module({ controllers: [NatsController] })
export class NatsModule {}

@Module({ controllers: [RmqController] })
export class RmqModule {}
