# A GraphQL replay drops the fields that a getter returns

In `@nestjs/idempotency`, a retry of a GraphQL mutation gets the stored
result. The
[docs](https://github.com/nestjs/docs.nestjs.com/blob/16740e7b1020d7e14ba58718bb6e31ee7ace6c38/content/reliability/idempotency.md?plain=1#L1064)
say that it replays "with the same types the resolver returned".

The stored copy keeps only the own enumerable properties of a class instance
([`result.util.ts:109-115`](https://github.com/nestjs/idempotency/blob/b2c1e79af2c68cf04a3e6daecb1468a76da78bd4/lib/utils/result.util.ts#L109-L115)).
So a field that a getter returns, such as `@Field() get amount()`, is not in
the replay. GraphQL then reads `undefined` for that field:

- A non-null field makes the retry fail with `Cannot return null for
  non-nullable field`, while the first call succeeded.
- A nullable field turns into `null` on the retry, with no error.

## Run it

```bash
npm install
npm run repro
```

No database is needed. The script uses the default in-memory store, Apollo
and the Express adapter, and sends real HTTP requests. Each scenario sends
the same request twice with the same `Idempotency-Key`.

- `GraphQL, plain object (control)`: the mutation returns a plain object.
- `GraphQL, class with getters, non-null field`: the mutation returns a
  `Receipt` instance and the client selects `amount`, a non-null field
  that a getter returns.
- `GraphQL, class with getters, nullable field`: the same mutation, and the
  client selects `label`, a nullable field that a getter returns.
- `REST, same class (control)`: a controller returns the same `Receipt`
  instance.

## What you should see

Output of `npm run repro` with `@nestjs/idempotency` 0.0.2:

```
=== GraphQL, plain object (control) ===
  first call:   200 {"data":{"payPlain":{"receiptId":"rcpt_1","amount":"12.50 EUR","label":"Receipt rcpt_1"}}}
  retry:        200 {"data":{"payPlain":{"receiptId":"rcpt_1","amount":"12.50 EUR","label":"Receipt rcpt_1"}}}
  handler runs: 1
  same answer:  yes

=== GraphQL, class with getters, non-null field ===
  first call:   200 {"data":{"payWithGetters":{"receiptId":"rcpt_1","amount":"12.50 EUR"}}}
  retry:        200 {"errors":[{"message":"Cannot return null for non-nullable field Receipt.amount.","locations":[{"line":1,"column":39}],"path":["payWithGetters","amount"],"extensions":{"code":"INTERNAL_SERVER_ERROR"}}],"data":null}
  handler runs: 1
  same answer:  NO

=== GraphQL, class with getters, nullable field ===
  first call:   200 {"data":{"payWithGetters":{"receiptId":"rcpt_1","label":"Receipt rcpt_1"}}}
  retry:        200 {"data":{"payWithGetters":{"receiptId":"rcpt_1","label":null}}}
  handler runs: 1
  same answer:  NO

=== REST, same class (control) ===
  first call:   201 {"receiptId":"rcpt_1","amountCents":1250,"currency":"EUR"}
  retry:        201 {"receiptId":"rcpt_1","amountCents":1250,"currency":"EUR"}
  handler runs: 1
  same answer:  yes

RESULT: BUG: 2 of 4 retries do not get the first answer.
```

The handler runs once in each scenario, so every retry comes from the
store. The exit code of `npm run repro` is 1.

Over REST, the first response is JSON, and JSON already leaves out the
getters. So the retry gets the same answer, and only GraphQL is affected.

## Workaround

Return a plain object from the mutation, or give the class a `toJSON()`
method that includes the getters. The store applies `toJSON()`. With
`toJSON() { return { ...this, amount: this.amount, label: this.label }; }`
on `Receipt`, every retry gets the first answer. That method also changes
the REST response, which then includes `amount` and `label`.

## Versions

`@nestjs/idempotency` 0.0.2 · `@nestjs/common` 12.2.0 · `@nestjs/core`
12.2.0 · `@nestjs/graphql` 14.0.3 · `@nestjs/apollo` 14.0.3 ·
`@apollo/server` 5.5.1 · `@as-integrations/express5` 1.1.2 · `graphql` 16.14.2 ·
Node 24
