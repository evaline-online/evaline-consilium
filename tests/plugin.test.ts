import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ConsiliumPlugin } from '../src/plugin.ts';
import { PluginError, PluginEventBus } from '../src/plugin-contract.ts';
import { StubLlmClient } from '../src/llm.ts';
import type { PluginContext } from '../src/plugin-contract.ts';
import type { ConsiliumResult } from '../src/types.ts';

function makeContext(): PluginContext {
  return {
    config: {},
    logger: null,
    eventBus: new PluginEventBus(),
    registerRoute: () => undefined,
    registerCommand: () => undefined,
    getStorage: () => null,
  };
}

test('manifest declares consilium plugin', () => {
  const plugin = new ConsiliumPlugin();
  assert.equal(plugin.manifest.id, 'consilium');
  assert.equal(plugin.manifest.name, 'Consilium Multi-Agent Engine');
  assert.equal(plugin.manifest.version, '0.1.0');
  assert.equal(plugin.manifest.category, 'ai');
  assert.equal(plugin.manifest.enabled, true);
});

test('initialize registers route and commands', async () => {
  const plugin = new ConsiliumPlugin();
  const context = makeContext();
  await plugin.initialize(context);

  assert.equal(plugin.routes.length, 1);
  assert.equal(plugin.routes[0].method, 'POST');
  assert.equal(plugin.routes[0].path, '/api/consilium');

  const cmds = plugin.commands.map((c) => c.cmd);
  assert.deepEqual(cmds, ['/consilium', '/dialogue', '/broadcast']);
  assert.ok(plugin.commands[0].help);
});

test('route handler returns {success:true, result}', async () => {
  const plugin = new ConsiliumPlugin({ llm: new StubLlmClient(() => 'routed') });
  await plugin.initialize(makeContext());

  const response = (await plugin.routes[0].handler({ mode: 'solo', prompt: 'go' })) as {
    success: boolean;
    result: ConsiliumResult;
  };
  assert.equal(response.success, true);
  assert.equal(response.result.mode, 'solo');
  assert.equal(response.result.turns.length, 1);
  assert.equal(response.result.turns[0].content, 'routed');
});

test('command handler formats solo output with header and no synthesis', async () => {
  const plugin = new ConsiliumPlugin({ llm: new StubLlmClient(() => 'reply text') });
  await plugin.initialize(makeContext());

  const out = await plugin.handleCommand('solo  Build a thing ');
  assert.ok(out.startsWith('\n=== Consilium [SOLO] ===\n'));
  assert.ok(out.includes('\n[') && out.includes(']\nreply text'));
  assert.ok(!out.includes('=== SYNTHESIS ==='));
});

test('command handler defaults to consilium mode when first token is not a mode', async () => {
  const plugin = new ConsiliumPlugin({ llm: new StubLlmClient(() => 'deliberation') });
  await plugin.initialize(makeContext());

  const out = await plugin.handleCommand('design the platform');
  assert.ok(out.startsWith('\n=== Consilium [CONSILIUM] ===\n'));
  assert.ok(out.includes('=== SYNTHESIS ==='));
});

test('/dialogue command prefix formats synthesis block', async () => {
  const plugin = new ConsiliumPlugin({ llm: new StubLlmClient(() => 'arg') });
  await plugin.initialize(makeContext());

  const out = await plugin.handleCommand('dialogue debate everything');
  assert.ok(out.startsWith('\n=== Consilium [DIALOGUE] ===\n'));
  assert.ok(out.includes('=== SYNTHESIS ==='));
});

test('healthCheck returns ready status', async () => {
  const plugin = new ConsiliumPlugin();
  const health = await plugin.healthCheck?.();
  assert.deepEqual(health, { status: 'healthy', message: 'Consilium ready' });
});

test('PluginError formats message with plugin id', () => {
  const err = new PluginError('consilium', 'boom');
  assert.equal(err.name, 'PluginError');
  assert.ok(err.message.includes('[consilium]'));
  assert.ok(err.message.includes('boom'));
});

test('PluginEventBus on/off/emit/clear', async () => {
  const bus = new PluginEventBus();
  let hits = 0;
  const handler = () => {
    hits += 1;
  };
  bus.on('evt', handler);
  await bus.emit('evt', {});
  await bus.emit('evt', {});
  assert.equal(hits, 2);

  bus.off('evt', handler);
  await bus.emit('evt', {});
  assert.equal(hits, 2);

  bus.on('evt', handler);
  bus.clear();
  await bus.emit('evt', {});
  assert.equal(hits, 2);
});