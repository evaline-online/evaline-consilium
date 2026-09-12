/**
 * evaline-consilium — Consilium plugin (host-agnostic).
 *
 * Implements the Plugin contract and exposes routes/commands matching the
 * backend plugin shape so hosts can register it via their PluginManager.
 */

import type { Plugin, PluginContext, PluginManifest } from './plugin-contract.ts';
import type { ConsiliumEngineDeps } from './engine.ts';
import { ConsiliumEngine } from './engine.ts';
import type { ConsiliumMode } from './types.ts';

const MANIFEST: PluginManifest = {
  id: 'consilium',
  name: 'Consilium Multi-Agent Engine',
  version: '0.1.0',
  description: 'Multi-agent deliberation engine with solo, broadcast, dialogue, interview and consilium modes',
  author: 'EvaLine Engineering',
  enabled: true,
  category: 'ai',
};

const COMMAND_MODES: ConsiliumMode[] = ['solo', 'broadcast', 'dialogue', 'consilium'];

export class ConsiliumPlugin implements Plugin {
  public readonly manifest: PluginManifest = MANIFEST;
  public readonly routes: Array<{ method: string; path: string; handler: (body: unknown, query?: unknown) => Promise<unknown> }> = [];
  public readonly commands: Array<{ cmd: string; handler: (args: string) => Promise<string>; help?: string }> = [];

  private readonly engine: ConsiliumEngine;

  constructor(deps?: ConsiliumEngineDeps) {
    this.engine = new ConsiliumEngine(deps);
  }

  public async initialize(context: PluginContext): Promise<void> {
    this.routes.push({
      method: 'POST',
      path: '/api/consilium',
      handler: async (body: unknown): Promise<unknown> => {
        const req = (body ?? {}) as Record<string, unknown>;
        const result = await this.engine.run({
          mode: ((req.mode as ConsiliumMode) || 'consilium') as ConsiliumMode,
          prompt: (req.prompt as string) || '',
          models: (req.models as string[]) || undefined,
          rounds: req.rounds as number | undefined,
          synthesizerModel: req.synthesizerModel as string | undefined,
          systemInstruction: req.systemInstruction as string | undefined,
          useKnowledgeBase: req.useKnowledgeBase as boolean | undefined,
        });
        return { success: true, result };
      },
    });

    this.commands.push({
      cmd: '/consilium',
      handler: async (args: string): Promise<string> => this.handleCommand(args),
      help: 'Multi-agent deliberation. Usage: /consilium <mode> <prompt>',
    });

    this.commands.push({
      cmd: '/dialogue',
      handler: async (args: string): Promise<string> => this.handleCommand(`dialogue ${args}`),
      help: 'Two-model debate. Usage: /dialogue <prompt>',
    });

    this.commands.push({
      cmd: '/broadcast',
      handler: async (args: string): Promise<string> => this.handleCommand(`broadcast ${args}`),
      help: 'Broadcast to multiple models. Usage: /broadcast <prompt>',
    });

    context.registerRoute('POST', '/api/consilium', this.routes[this.routes.length - 1].handler);
    for (const command of this.commands) {
      context.registerCommand(command.cmd, command.handler, command.help);
    }
  }

  public async shutdown(): Promise<void> {}

  public async healthCheck(): Promise<{ status: 'healthy' | 'degraded' | 'down'; message?: string }> {
    return { status: 'healthy', message: 'Consilium ready' };
  }

  public async handleCommand(args: string): Promise<string> {
    const parts = args.trim().split(/\s+/);
    const first = parts[0] || '';
    const recognized = COMMAND_MODES.includes(first as ConsiliumMode);
    const mode = (recognized ? first : 'consilium') as ConsiliumMode;
    const prompt = (recognized ? parts.slice(1) : parts).join(' ').trim();

    const result = await this.engine.run({ mode, prompt });

    let output = `\n=== Consilium [${mode.toUpperCase()}] ===\n`;
    for (const turn of result.turns) {
      output += `\n[${turn.name}]\n${turn.content}\n`;
    }
    if (result.synthesis) {
      output += `\n=== SYNTHESIS ===\n${result.synthesis}\n`;
    }
    return output;
  }
}