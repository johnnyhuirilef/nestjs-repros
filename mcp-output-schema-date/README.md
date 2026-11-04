# A tool result with a Date fails its outputSchema

In `@nestjs/mcp` 0.0.2, a tool with an `outputSchema` sends the value that its method returns as `structuredContent`, and the JSON of that value as a text block. The MCP SDK validates `structuredContent` against the schema. `structuredContent` is the value itself, not its JSON, so a `Date`, or an object with `toJSON()`, fails the validation although its JSON matches the schema.

The script starts an app with `McpModule.forRoot()` on Express and two tools with the same `outputSchema`. `order-plain` returns a plain object with strings. `order-entity` returns an `Order` with a `Date` and a `Money` that has `toJSON()`. The script calls both tools over HTTP and prints the results.

## Run

```bash
npm install
npm run repro
```

## Output

On Node 26.13.0, macOS:

```
=== returns { id, placedAt: '2026-11-04T10:00:00.000Z', total: '19.99 EUR' } (control) ===
  isError: false
  structuredContent: {"id":"o1","placedAt":"2026-11-04T10:00:00.000Z","total":"19.99 EUR"}

=== returns new Order(): placedAt is a Date, total has toJSON() ===
  JSON.stringify(new Order()): {"id":"o1","placedAt":"2026-11-04T10:00:00.000Z","total":"19.99 EUR"}
  matches outputSchema: true
  isError: true
  text: Output validation error: Invalid structured content for tool order-entity: placedAt: Invalid input: expected string, received Date, total: Invalid input: expected string, received Money

RESULT: BUG: a value whose JSON matches the outputSchema fails the output validation.
```

The exit code is 1 while the value fails the validation, and 0 when it is validated as its JSON.
