// Plain JavaScript, so the decorators are applied with Reflect.decorate().
import 'reflect-metadata';
import { createServer } from 'node:http';
import { Inject, Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Workflow, WorkflowClient, WorkflowWorker, WorkflowsModule } from '@nestjs/workflows';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import * as z from 'zod';
import { AgentFunction, AiModule } from '@nestjs/ai';
import { AiAgents, AiWorkflowsModule } from '@nestjs/ai/workflows';

// A local server that answers in the OpenAI format and gives every tool call the id "0",
// as text-generation-inference (TGI) does when it does not stream.
const answers = [
  { tool: { name: 'refund', arguments: '{"orderId":"ord_1"}' } },
  { tool: { name: 'refund', arguments: '{"orderId":"ord_2"}' } },
  { text: 'Both orders were refunded.' },
];
const requests = [];
const sentIds = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    requests.push(JSON.parse(body));
    const answer = answers[requests.length - 1] ?? answers.at(-1);
    if (answer.tool) sentIds.push('0');
    const message = answer.tool
      ? { role: 'assistant', content: null, tool_calls: [{ id: sentIds.at(-1), type: 'function', function: answer.tool }] }
      : { role: 'assistant', content: answer.text };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      id: `chatcmpl-${requests.length}`,
      object: 'chat.completion',
      created: 0,
      model: 'tgi',
      choices: [{ index: 0, message, finish_reason: answer.tool ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const model = createOpenAICompatible({ name: 'tgi', baseURL: `http://127.0.0.1:${server.address().port}/v1` }).chatModel('tgi');

const refunded = [];
class Tools {
  refund({ orderId }) {
    refunded.push(orderId);
    return { refunded: orderId };
  }
}
Reflect.decorate(
  [AgentFunction({ name: 'refund', description: 'Refund an order', inputSchema: z.object({ orderId: z.string() }) })],
  Tools.prototype, 'refund', Object.getOwnPropertyDescriptor(Tools.prototype, 'refund'),
);
Reflect.decorate([Injectable()], Tools);

// A durable run where every refund waits for a person's approval.
class RefundRequest {
  constructor(agents) { this.agents = agents; }
  run(ctx, { email }) {
    return this.agents.run(ctx, { prompt: email, tools: ['refund'], approve: ['refund'] });
  }
}
Inject(AiAgents)(RefundRequest, undefined, 0);
Reflect.decorate([Workflow('refund-request')], RefundRequest);

class AppModule {}
Reflect.decorate([Module({
  imports: [
    WorkflowsModule.forRoot({ worker: { enabled: false, shutdownTimeout: 50 } }),
    AiModule.forRoot({ models: { default: model }, defaults: { retry: false } }),
    AiWorkflowsModule,
  ],
  providers: [Tools, RefundRequest],
})], AppModule);

const app = await Test.createTestingModule({ imports: [AppModule] }).compile();
app.useLogger(false);
await app.init();
const client = app.get(WorkflowClient);
const worker = app.get(WorkflowWorker);
const agents = app.get(AiAgents);
const show = (pending) => JSON.stringify(pending.map(({ key, toolCallId, input }) => ({ key, toolCallId, input })));

await client.start(RefundRequest, { email: 'Please refund ord_1 and ord_2' }, { id: 'run-1' });
await worker.drain();
for (const step of [1, 2]) {
  const pending = await agents.pendingApprovals('run-1');
  console.log(`Waiting for approval (${step}): ${show(pending)}`);
  if (pending[0]) {
    console.log(`  approve("${pending[0].key}")`);
    await agents.approve(pending[0].key);
    await worker.drain();
  }
}

const status = (await client.getStatus('run-1'))?.status;
const pending = await agents.pendingApprovals('run-1');
console.log('');
console.log(`Tool call ids the server sent: ${JSON.stringify(sentIds)}, in ${requests.length} requests with stream: ${JSON.stringify([...new Set(requests.map((r) => r.stream ?? false))])}`);
console.log(`Run status: ${status}`);
console.log(`Refunds that ran: ${JSON.stringify(refunded)}`);
console.log(`Still waiting: ${show(pending)}`);
console.log('');
const fixed = status === 'completed' && refunded.length === 2 && pending.length === 0;
console.log(fixed
  ? 'RESULT: FIXED'
  : 'RESULT: BUG: the second approval was lost, so the second refund never runs and the run waits forever.');

await app.close();
server.close();
process.exitCode = fixed ? 0 : 1;
