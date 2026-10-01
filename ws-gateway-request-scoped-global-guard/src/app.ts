import 'reflect-metadata';
import {
  CanActivate,
  Controller,
  Get,
  Injectable,
  Module,
  Scope,
  Type,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';

export const trace = { guardRan: false, handlerRan: false };

@Injectable({ scope: Scope.REQUEST })
export class RequestScopedDenyGuard implements CanActivate {
  canActivate() {
    trace.guardRan = true;
    return false;
  }
}

@Injectable()
export class StaticDenyGuard implements CanActivate {
  canActivate() {
    trace.guardRan = true;
    return false;
  }
}

@WebSocketGateway(0, { cors: true })
export class PingGateway {
  @SubscribeMessage('ping')
  ping() {
    trace.handlerRan = true;
    return { event: 'pong', data: 'handler ran' };
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

export function appModuleWith(guard: Type<CanActivate>, transport: 'ws' | 'http') {
  @Module({
    controllers: transport === 'http' ? [PingController] : [],
    providers: [
      ...(transport === 'ws' ? [PingGateway] : []),
      { provide: APP_GUARD, useClass: guard },
    ],
  })
  class AppModule {}
  return AppModule;
}
