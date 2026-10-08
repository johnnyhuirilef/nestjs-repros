import { Controller, Get, Module } from '@nestjs/common';

@Controller()
class AppController {
  @Get()
  hello() {
    return 'hello';
  }
}

@Module({ controllers: [AppController] })
export class AppModule {}
