import 'reflect-metadata';
import {
  CanActivate,
  Controller,
  Get,
  Injectable,
  Module,
  Scope,
  Type,
  UseGuards,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MessagePattern } from '@nestjs/microservices';

export const trace = { constructed: 0, guardRan: false, handlerRan: false };

@Injectable()
export class DefaultDenyGuard implements CanActivate {
  canActivate() {
    trace.guardRan = true;
    return false;
  }
}

@Injectable({ scope: Scope.REQUEST })
export class RequestScopedDenyGuard implements CanActivate {
  canActivate() {
    trace.guardRan = true;
    return false;
  }
}

@Injectable({ scope: Scope.TRANSIENT })
export class TransientDenyGuard implements CanActivate {
  constructor() {
    trace.constructed++;
  }

  canActivate() {
    trace.guardRan = true;
    return false;
  }
}

@Controller()
export class PingController {
  @Get('ping')
  ping() {
    trace.handlerRan = true;
    return 'handler ran';
  }
}

@UseGuards(TransientDenyGuard)
@Controller()
export class GuardedPingController {
  @Get('ping')
  ping() {
    trace.handlerRan = true;
    return 'handler ran';
  }
}

@Controller()
export class PingMessageController {
  @MessagePattern('ping')
  ping() {
    trace.handlerRan = true;
    return 'handler ran';
  }
}

export function globalGuardModule(
  guard: Type<CanActivate>,
  controller: Type<unknown> = PingController,
) {
  @Module({
    controllers: [controller],
    providers: [{ provide: APP_GUARD, useClass: guard }],
  })
  class AppModule {}
  return AppModule;
}

export function routeGuardModule() {
  @Module({
    controllers: [GuardedPingController],
    providers: [TransientDenyGuard],
  })
  class AppModule {}
  return AppModule;
}
