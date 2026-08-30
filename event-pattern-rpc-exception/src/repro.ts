import 'reflect-metadata';
import { Catch, Controller, Module } from '@nestjs/common';
import type { RpcExceptionFilter } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  ClientProxyFactory,
  EventPattern,
  MessagePattern,
  RpcException,
  Transport,
} from '@nestjs/microservices';
import type { MicroserviceOptions } from '@nestjs/microservices';
import { throwError } from 'rxjs';

/**
 * An `RpcException` thrown from an `@EventPattern` handler is discarded.
 * The same exception from an `@MessagePattern` handler reaches the client,
 * and a plain `Error` from an `@EventPattern` handler is logged.
 *
 *   npm run repro
 */
const PORT = 8899;

let customFilterRan = false;
let nestReportedCount = 0;

// Count what Nest itself writes, so this script shows the result on any
// version instead of asserting one.
const realStderr = process.stderr.write.bind(process.stderr);
process.stderr.write = ((chunk: any, ...rest: any[]) => {
  if (String(chunk).includes('RpcExceptionsHandler')) nestReportedCount++;
  return realStderr(chunk, ...rest);
}) as typeof process.stderr.write;

@Catch(RpcException)
class AlertingFilter implements RpcExceptionFilter<RpcException> {
  catch(exception: RpcException) {
    customFilterRan = true;
    console.log(
      `  [filter] custom filter ran, wants to alert: ${exception.message}`,
    );
    return throwError(() => exception.getError());
  }
}

@Controller()
class AppController {
  @MessagePattern('msg.rpc')
  msgRpc(): never {
    throw new RpcException('message failed');
  }

  @EventPattern('evt.rpc')
  evtRpc(): never {
    throw new RpcException('event failed');
  }

  @EventPattern('evt.plain')
  evtPlain(): never {
    throw new Error('event failed with a plain Error');
  }

  @EventPattern('evt.filtered')
  evtFiltered(): never {
    throw new RpcException('order sync failed');
  }
}

@Module({ controllers: [AppController] })
class AppModule {}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    { transport: Transport.TCP, options: { port: PORT } },
  );
  app.useGlobalFilters(new AlertingFilter());
  await app.listen();

  const client = ClientProxyFactory.create({
    transport: Transport.TCP,
    options: { port: PORT },
  });
  await client.connect();

  console.log('\n=== A) @MessagePattern throwing RpcException ===');
  await new Promise<void>(resolve => {
    client.send('msg.rpc', {}).subscribe({
      next: () => resolve(),
      error: err => {
        console.log(`  client received: ${JSON.stringify(err)}`);
        resolve();
      },
    });
  });

  console.log('\n=== B) @EventPattern throwing a plain Error ===');
  client.emit('evt.plain', {}).subscribe();
  await wait(300);

  console.log('\n=== C) @EventPattern throwing RpcException ===');
  console.log('  (watch for any output below before the next section)');
  client.emit('evt.rpc', {}).subscribe();
  await wait(300);

  console.log('\n=== D) @EventPattern + RpcException, with a custom filter ===');
  customFilterRan = false;
  client.emit('evt.filtered', {}).subscribe();
  await wait(300);
  console.log(`  custom filter executed: ${customFilterRan}`);

  console.log('\n=== RESULT ===');
  const eventRpcReports = nestReportedCount - 1; // case B always reports
  console.log(`  RpcException reports from event handlers: ${eventRpcReports} (cases C and D)`);
  console.log(
    eventRpcReports === 2
      ? '  FIXED: both event handlers reported the failure.'
      : '  BUG: the failure was discarded with no signal.',
  );

  await client.close();
  await app.close();
  process.exit(0);
}

process.on('unhandledRejection', e => console.log('  [unhandledRejection]', e));
process.on('uncaughtException', e => console.log('  [uncaughtException]', e));

main();
