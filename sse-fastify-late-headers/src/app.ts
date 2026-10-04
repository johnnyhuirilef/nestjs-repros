import {
  CallHandler,
  Controller,
  ExecutionContext,
  Get,
  Header,
  Injectable,
  Module,
  NestInterceptor,
  Res,
  Sse,
  UseInterceptors,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';

type ReplyLike = { header(name: string, value: string): unknown };

export const HEADERS = {
  decorator: 'x-decorator',
  interceptor: 'x-interceptor',
  handler: 'x-handler',
} as const;

@Injectable()
class HeaderInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    context.switchToHttp().getResponse<ReplyLike>().header(HEADERS.interceptor, 'set');
    return next.handle();
  }
}

const message = () => of({ data: 'hello' });

@Controller()
@UseInterceptors(HeaderInterceptor)
class RoutesController {
  @Get('plain')
  @Header(HEADERS.decorator, 'set')
  plain(@Res({ passthrough: true }) reply: ReplyLike) {
    reply.header(HEADERS.handler, 'set');
    return { hello: 'world' };
  }

  @Sse('sse')
  @Header(HEADERS.decorator, 'set')
  sse(@Res({ passthrough: true }) reply: ReplyLike): Observable<{ data: string }> {
    reply.header(HEADERS.handler, 'set');
    return message();
  }
}

@Module({ controllers: [RoutesController] })
export class AppModule {}
