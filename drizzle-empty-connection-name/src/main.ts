import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DrizzleModule, getDrizzleToken } from '@nestjs/drizzle';

// Two databases, told apart by the object identity their driver hands back.
const primary = { $client: { end: async () => {} }, label: 'primary' };
const reporting = { $client: { end: async () => {} }, label: 'reporting' };

// A name that arrives empty, the way `process.env.DB_NAME ?? ''` leaves it.
const nameFromConfig = process.env.DB_NAME ?? '';

@Module({
  imports: [
    DrizzleModule.forRoot({ db: primary as never }),
    DrizzleModule.forRoot({ name: nameFromConfig, db: reporting as never }),
  ],
})
class AppModule {}

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: false,
});

console.log('getDrizzleToken()       ->', getDrizzleToken());
console.log('getDrizzleToken("")     ->', getDrizzleToken(''));
console.log('resolved under it       ->', app.get(getDrizzleToken()).label);
console.log('the other one           -> unreachable, no error was raised');

await app.close();
