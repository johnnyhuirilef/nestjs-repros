# A durable run loses the approval of a later tool call that reuses an id

In `@nestjs/ai` 0.0.2, a durable run (`AiAgents.run()` from `@nestjs/ai/workflows`) keys each approval by the run and the tool call id. Some providers give the same tool call id in every response. For example, text-generation-inference (TGI) gives every tool call the id `"0"` when it does not stream. When a later step asks for an approval with an id that an earlier step already used, `approve()` for it does nothing, and the run waits forever.

The script starts a local server that answers in the OpenAI format and gives every tool call the id `"0"`, as TGI does. The model is `@ai-sdk/openai-compatible`, pointed at that server. The run asks for two refunds, one per step, and every refund waits for an approval. The script approves each one that `pendingApprovals()` lists.

## Run

```bash
npm install
npm run repro
```

## Output

On Node 26.13.0, macOS:

```
Waiting for approval (1): [{"key":"run-1:0","toolCallId":"0","input":{"orderId":"ord_1"}}]
  approve("run-1:0")
Waiting for approval (2): [{"key":"run-1:0","toolCallId":"0","input":{"orderId":"ord_2"}}]
  approve("run-1:0")

Tool call ids the server sent: ["0","0"], in 2 requests with stream: [false]
Run status: suspended
Refunds that ran: ["ord_1"]
Still waiting: [{"key":"run-1:0","toolCallId":"0","input":{"orderId":"ord_2"}}]

RESULT: BUG: the second approval was lost, so the second refund never runs and the run waits forever.
```

The exit code is 1. When the bug is fixed, the script prints `RESULT: FIXED` and exits with 0.
