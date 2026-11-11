# A `generateObject()` call that fails the schema check emits no usage event

In `@nestjs/ai` 0.0.2, a `generateObject()` call rejects with `AiOutputError` when the model's answer is not JSON or does not match the schema. The model answered and used tokens, but `onUsage` is not called for that model call. The docs say: "Every model call that answers emits a usage event."

The script configures one `FakeModel` from `@nestjs/ai/testing` and a module `onUsage` listener. It calls `generateObject()` three times. The model answers a valid object (the control), an object with a number where the schema wants a string, and text that is not JSON.

## Run

```bash
npm install
npm run repro
```

## Output

On Node 26.13.0, macOS:

```
Valid object (control)                   answered, usage.totalTokens 20, onUsage called 1 time(s) (totalTokens 20)
Object that does not match the schema    rejected (AiOutputError), onUsage called 0 time(s)
Answer that is not JSON                  rejected (AiOutputError), onUsage called 0 time(s)

Model calls: 3. Usage events: 1.

RESULT: BUG: a generateObject() call that fails the schema check emits no usage event, although the model answered.
```

The exit code is 1. When each of the three model calls emits one usage event, the script prints `RESULT: FIXED` and exits with 0.
