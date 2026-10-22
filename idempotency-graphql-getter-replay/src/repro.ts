import 'reflect-metadata';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { Controller, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Field, GraphQLModule, ID, Int, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { Idempotent, IdempotencyModule } from '@nestjs/idempotency';

// A receipt like the one in the GraphQL part of the idempotency docs.
// `amount` is computed by a getter, as code-first object types often do.
@ObjectType()
class Receipt {
  @Field(() => ID) receiptId = 'rcpt_1';
  @Field(() => Int) amountCents = 1250;
  @Field(() => String, { nullable: true }) currency: string | null = 'EUR';

  @Field(() => String)
  get amount(): string {
    return `${(this.amountCents / 100).toFixed(2)} ${this.currency}`;
  }

  @Field(() => String, { nullable: true })
  get label(): string | null {
    return `Receipt ${this.receiptId}`;
  }
}

const runs: Record<string, number> = {};
const count = (name: string) => (runs[name] = (runs[name] ?? 0) + 1);

@Resolver()
class OrdersResolver {
  @Query(() => String) ping() {
    return 'pong';
  }

  @Mutation(() => Receipt)
  @Idempotent()
  payPlain() {
    count('payPlain');
    return { receiptId: 'rcpt_1', amountCents: 1250, currency: 'EUR', amount: '12.50 EUR', label: 'Receipt rcpt_1' };
  }

  @Mutation(() => Receipt)
  @Idempotent()
  payWithGetters() {
    count('payWithGetters');
    return new Receipt();
  }
}

@Controller('orders')
class OrdersController {
  @Post('pay')
  @Idempotent()
  pay() {
    count('POST /orders/pay');
    return new Receipt();
  }
}

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      includeStacktraceInErrorResponses: false,
    }),
    IdempotencyModule.forRoot({ scope: false }),
  ],
  providers: [OrdersResolver],
  controllers: [OrdersController],
})
class AppModule {}

const app = await NestFactory.create(AppModule, { logger: false });
await app.listen(0);
const url = await app.getUrl();

async function send(path: string, key: string, body?: unknown) {
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': key },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return `${res.status} ${(await res.text()).trim()}`;
}

const graphql = (field: string, selection: string) => ({ query: `mutation { ${field} { ${selection} } }` });

const scenarios = [
  {
    label: 'GraphQL, plain object (control)',
    name: 'payPlain',
    call: (key: string) => send('/graphql', key, graphql('payPlain', 'receiptId amount label')),
  },
  {
    label: 'GraphQL, class with getters, non-null field',
    name: 'payWithGetters',
    call: (key: string) => send('/graphql', key, graphql('payWithGetters', 'receiptId amount')),
  },
  {
    label: 'GraphQL, class with getters, nullable field',
    name: 'payWithGetters',
    call: (key: string) => send('/graphql', key, graphql('payWithGetters', 'receiptId label')),
  },
  { label: 'REST, same class (control)', name: 'POST /orders/pay', call: (key: string) => send('/orders/pay', key) },
];

let bugs = 0;
for (const [i, { label, name, call }] of scenarios.entries()) {
  const key = `key-${i + 1}`;
  const before = runs[name] ?? 0;
  const first = await call(key);
  const retry = await call(key);
  if (retry !== first) bugs++;
  console.log(`=== ${label} ===`);
  console.log(`  first call:   ${first}`);
  console.log(`  retry:        ${retry}`);
  console.log(`  handler runs: ${(runs[name] ?? 0) - before}`);
  console.log(`  same answer:  ${retry === first ? 'yes' : 'NO'}`);
  console.log();
}

await app.close();

if (bugs) {
  console.log(`RESULT: BUG: ${bugs} of ${scenarios.length} retries do not get the first answer.`);
  process.exit(1);
}
console.log('RESULT: OK: every retry gets the first answer.');
