import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ConsiliumEngine } from '../src/engine.ts';
import { StubLlmClient } from '../src/llm.ts';
import { personaForRoleId } from '../src/engine.ts';
import type { ConsiliumParticipant } from '../src/types.ts';

test('solo mode: single deterministic turn with cost fields', async () => {
  const engine = new ConsiliumEngine({
    llm: new StubLlmClient((model) => `Solo reply from ${model}`),
  });

  const result = await engine.run({ mode: 'solo', prompt: 'Design a resilient architecture' });

  assert.equal(result.mode, 'solo');
  assert.equal(result.turns.length, 1);
  assert.equal(result.totalRounds, 1);
  assert.equal(result.turns[0].round, 1);
  assert.equal(result.turns[0].content, 'Solo reply from openrouter/free');
  assert.ok(result.turns[0].promptTokens !== undefined && result.turns[0].promptTokens >= 0);
  assert.ok(result.turns[0].totalTokens !== undefined && result.turns[0].totalTokens >= 0);
  assert.ok(result.turns[0].cost);
  assert.equal(result.totalCostUSD, 0);
  assert.equal(result.totalCostEUR, 0);
  assert.ok(result.costSummary);
  assert.equal(result.costSummary.formattedUSD, '$0.00 (100% Free Quota)');
  assert.equal(result.costSummary.formattedEUR, '€0.00 (100% Free Quota)');
  assert.equal(result.costSummary.models.length, 1);
  assert.equal(result.participants.length, 1);
});

test('chat mode routes to solo', async () => {
  const engine = new ConsiliumEngine({ llm: new StubLlmClient(() => 'chat answer') });
  const result = await engine.run({ mode: 'chat', prompt: 'hi' });
  assert.equal(result.mode, 'chat');
  assert.equal(result.turns.length, 1);
});

test('broadcast mode: concurrent generation for 3 stub participants', async () => {
  const engine = new ConsiliumEngine({
    llm: new StubLlmClient((model) => `Broadcast from ${model}`),
  });

  const result = await engine.run({
    mode: 'broadcast',
    prompt: 'Broadcast this',
    models: ['m1', 'm2', 'm3'],
  });

  assert.equal(result.mode, 'broadcast');
  assert.equal(result.participants.length, 3);
  assert.equal(result.turns.length, 3);
  assert.deepEqual(result.turns.map((t) => t.model), ['m1', 'm2', 'm3']);
  assert.ok(result.costSummary);
});

test('dialogue mode: 2 models, rounds clamped to [1,5] with synthesis', async () => {
  const engine = new ConsiliumEngine({
    llm: new StubLlmClient((model) => `${model} stance`),
  });

  const result = await engine.run({
    mode: 'dialogue',
    prompt: 'Debate streaming architecture',
    models: ['m-a', 'm-b'],
    rounds: 9,
  });

  assert.equal(result.mode, 'dialogue');
  assert.equal(result.totalRounds, 5);
  assert.equal(result.turns.length, 10);
  assert.ok(result.synthesis && result.synthesis.length > 0);
  assert.ok(result.synthesis);
  assert.ok(result.costSummary);
});

test('dialogue defaults rounds to 2 when falsy and clamps negative to 1', async () => {
  const engine = new ConsiliumEngine({ llm: new StubLlmClient(() => 'x') });
  const zero = await engine.run({
    mode: 'dialogue',
    prompt: 'Debate',
    models: ['m-a', 'm-b'],
    rounds: 0,
  });
  assert.equal(zero.totalRounds, 2);

  const negative = await engine.run({
    mode: 'dialogue',
    prompt: 'Debate',
    models: ['m-a', 'm-b'],
    rounds: -5,
  });
  assert.equal(negative.totalRounds, 1);
  assert.equal(negative.turns.length, 2);
});

test('consilium mode with 5 stub participants produces consensus report', async () => {
  const engine = new ConsiliumEngine({
    llm: new StubLlmClient((model) => `Consilium stance from ${model}`),
  });

  const result = await engine.run({
    mode: 'consilium',
    prompt: 'Design the 2026 roadmap',
    models: ['m1', 'm2', 'm3', 'm4', 'm5'],
    rounds: 2,
  });

  assert.equal(result.mode, 'consilium');
  assert.ok(result.participants.length >= 3 && result.participants.length <= 10);
  assert.equal(result.participants.length, 5);
  assert.equal(result.totalRounds, 2);
  assert.equal(result.turns.length, 10);
  assert.ok(result.synthesis && result.synthesis.length > 0);
  assert.ok(result.synthesis);
  assert.ok(result.costSummary);
  assert.equal(result.knowledgeBaseContextIncluded, false);
});

test('consilium: rounds clamped to max 4', async () => {
  const engine = new ConsiliumEngine({ llm: new StubLlmClient(() => 'p') });
  const result = await engine.run({
    mode: 'consilium',
    prompt: 'Scale-out decision',
    models: ['m1', 'm2', 'm3'],
    rounds: 100,
  });
  assert.equal(result.totalRounds, 4);
  assert.equal(result.turns.length, 12);
});

test('resolveParticipants preset top10_paid uses paidModels (slice 10)', () => {
  const paid = [
    'paid-a', 'paid-b', 'paid-c', 'paid-d', 'paid-e',
    'paid-f', 'paid-g', 'paid-h', 'paid-i', 'paid-j', 'paid-k',
  ];
  const engine = new ConsiliumEngine({ llm: new StubLlmClient(), paidModels: paid });
  const participants = engine.resolveParticipants({ mode: 'consilium', prompt: 'x', preset: 'top10_paid' });
  assert.equal(participants.length, 10);
  assert.equal(participants[0].model, 'paid-a');
  assert.equal(participants[9].model, 'paid-j');
  assert.ok(participants[0].roleId);
  assert.ok(participants[0].systemPrompt && participants[0].systemPrompt.length > 0);
});

test('resolveParticipants honors explicit participants', () => {
  const engine = new ConsiliumEngine({ llm: new StubLlmClient() });
  const given: ConsiliumParticipant[] = [{ id: 'p1', model: 'custom-model' }];
  const participants = engine.resolveParticipants({ mode: 'solo', prompt: 'x', participants: given });
  assert.equal(participants.length, 1);
  assert.equal(participants[0].id, 'p1');
  assert.equal(participants[0].model, 'custom-model');
  assert.equal(participants[0].title, 'Specialist');
});

test('validateConsiliumParticipants expands to 3 with corporate roles', () => {
  const engine = new ConsiliumEngine({ llm: new StubLlmClient() });
  const one: ConsiliumParticipant[] = [{ id: 'solo', model: 'm1' }];
  const expanded = engine.validateConsiliumParticipants(one);
  assert.equal(expanded.length, 3);
  assert.equal(expanded[1].roleId, 'devops');
  assert.equal(expanded[2].roleId, 'security_auditor');
  assert.ok(expanded[2].systemPrompt && expanded[2].systemPrompt.length > 0);
});

test('validateConsiliumParticipants bounds to 10', () => {
  const engine = new ConsiliumEngine({ llm: new StubLlmClient() });
  const many = Array.from({ length: 15 }, (_, i) => ({ id: `p${i}`, model: `m${i}` }));
  const bounded = engine.validateConsiliumParticipants(many);
  assert.equal(bounded.length, 10);
});

test('interview mode builds an inline eva interviewer', async () => {
  const engine = new ConsiliumEngine({ llm: new StubLlmClient(() => 'interview verdict') });
  const result = await engine.run({ mode: 'interview', prompt: 'Hire a senior engineer' });
  assert.equal(result.mode, 'interview');
  assert.equal(result.turns.length, 1);
  assert.equal(result.turns[0].participantId, 'eva-interviewer');
  assert.equal(result.participants[0].id, 'eva-interviewer');
});

test('erroring LlmClient yields bracketed error text, not a rejection', async () => {
  const failing = {
    async generateContent(model: string): Promise<string> {
      throw new Error(`down-${model}`);
    },
  };
  const engine = new ConsiliumEngine({ llm: failing });
  const result = await engine.run({ mode: 'solo', prompt: 'x' });
  assert.ok(result.turns[0].content.startsWith('[Error querying model'));
  assert.ok(result.turns[0].content.includes('down-openrouter/free'));
});

test('localePolicy is applied with persona for roleId', async () => {
  const collected: Array<{ prompt: string; persona?: string }> = [];
  const engine = new ConsiliumEngine({
    llm: new StubLlmClient(() => 'localized'),
    localePolicy: (prompt, persona) => {
      collected.push({ prompt, persona });
      return `${prompt} [locale:${persona ?? 'none'}]`;
    },
  });

  const result = await engine.run({
    mode: 'solo',
    prompt: 'x',
    participants: [{ id: 'eva-guest', model: 'm1', roleId: 'eva' }],
  });

  assert.equal(collected.length, 1);
  assert.equal(collected[0].persona, 'eva');
  assert.ok(result.turns[0].content === 'localized');
});

test('personaForRoleId helper', () => {
  assert.equal(personaForRoleId('eva-frontend'), 'eva');
  assert.equal(personaForRoleId('adam-backend'), 'adam');
  assert.equal(personaForRoleId('architect'), undefined);
  assert.equal(personaForRoleId(undefined), undefined);
});

test('knowledge base context is injected when prompt mentions evaline', async () => {
  const engine = new ConsiliumEngine({
    llm: new StubLlmClient(() => 'grounded'),
    knowledge: {
      async search(query, options) {
        assert.equal(options?.limit, 5);
        void query;
        return [{ id: '1', title: 'Hub', category: 'fact', content: 'Bratislava Obchodna 37' }];
      },
      formatContextForPrompt(docs) {
        return docs.map((d) => `${d.title}: ${d.content}`).join('\n');
      },
    },
  });

  const result = await engine.run({ mode: 'solo', prompt: 'Tell me about evaline hubs' });
  assert.equal(result.knowledgeBaseContextIncluded, true);
  assert.ok(result.turns[0].content === 'grounded');
});