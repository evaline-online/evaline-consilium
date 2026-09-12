/**
 * SubagentEngine.ts — /subagent command (TASK-325).
 *
 * Spawns N parallel LLM sub-agents, each with a distinct role persona and its
 * own FREE model (never Gemini — reserved for development), then synthesizes
 * all answers into a single verdict.
 *
 * Design:
 *  - Role personas (Analyst / Builder / Critic / Researcher) shape the system
 *    instruction so parallel answers are genuinely diverse, not 4x the same.
 *  - Every sub-agent runs through UniversalLlmClient (breaker + 45s timeout +
 *    ranked fallback chain come for free).
 *  - Parallelism via Promise.allSettled: one failed agent never kills the
 *    batch; failures are reported inline.
 *  - Synthesis is a separate free-model call that receives all successful
 *    answers and produces a final verdict.
 *
 * Limits (ONLY-FREE + abuse guard): max 4 sub-agents per run, 60s wall
 * budget per agent, fleet restricted to $0 models.
 */

import { UniversalLlmClient } from './UniversalLlmClient.js';
import { ModelRegistry } from '../models/ModelRegistry.js';
import { Config } from './Config.js';
import { logger } from './Logger.js';
import { OpLog } from './OpLog.js';

export interface SubagentRole {
  id: string;
  title: string;
  systemSuffix: string;
}

export interface SubagentResult {
  role: SubagentRole;
  modelId: string;
  ok: boolean;
  answer: string;
  error?: string;
  durationMs: number;
}

export interface SubagentRun {
  task: string;
  agentCount: number;
  results: SubagentResult[];
  synthesis: string;
  totalDurationMs: number;
}

export const SUBAGENT_ROLES: SubagentRole[] = [
  {
    id: 'analyst',
    title: 'Analyst',
    systemSuffix: 'You are the ANALYST sub-agent. Decompose the task, identify constraints, risks and unknowns. Be structured and concise (max 200 words).',
  },
  {
    id: 'builder',
    title: 'Builder',
    systemSuffix: 'You are the BUILDER sub-agent. Produce a concrete, actionable solution: steps, code or artifacts where relevant. Be pragmatic (max 200 words).',
  },
  {
    id: 'critic',
    title: 'Critic',
    systemSuffix: 'You are the CRITIC sub-agent. Attack the obvious solution: edge cases, failure modes, security, cost. Suggest mitigations (max 200 words).',
  },
  {
    id: 'researcher',
    title: 'Researcher',
    systemSuffix: 'You are the RESEARCHER sub-agent. Surface alternatives, prior art and trade-offs the others may miss (max 200 words).',
  },
];

/** Free $0 fleet for sub-agents — LIVE-VERIFIED 2026-09-08 (chat matrix):
 *  inkling* removed (403 'agentic harnesses only'), nemotron-ultra removed
 *  (45s+ latency). `openrouter/free` is the reliable meta-router. */
const SUBAGENT_FLEET = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'cohere/north-mini-code:free',
  'inclusionai/ling-3.0-flash-sante:free',
  'poolside/laguna-s-2.1:free',
  'dots-studio/dots-3-note-preview:free',
  'google/gemma-4-31b-it:free',
  'openrouter/free',
  // OmniRoute edge (free self-hosted margin) — for fleet diversity
  'omni/cf-gpt-oss-120b',
  'omni/cf-llama-3.3-70b',
  'omni/groq-gpt-oss-120b',
];

/** Picks a diverse model per slot: distinct ids across slots (wrap-around if fleet < agents). */
export function assignModels(agentCount: number): string[] {
  const pool = SUBAGENT_FLEET.filter((id) => ModelRegistry.isValidModel(id));
  const out: string[] = [];
  for (let i = 0; i < agentCount; i++) {
    const preferred = pool[i % pool.length];
    // Avoid two agents on the same model while the pool allows diversity.
    const candidate = out.includes(preferred) && pool.length > agentCount ? pool[(i + 1) % pool.length] : preferred;
    out.push(candidate);
  }
  return out;
}

export class SubagentEngine {
  private client: UniversalLlmClient;

  constructor(apiKey?: string) {
    this.client = new UniversalLlmClient(apiKey || (Config.vertexEnabled ? undefined : Config.geminiApiKey) || undefined);
  }

  /**
   * Parses '/subagent [N] <task>' — N optional (default 3, max 4).
   */
  public static parseArgs(args: string): { agentCount: number; task: string } {
    const m = args.match(/^([1-4])\s+(.*)$/s);
    if (m) return { agentCount: parseInt(m[1], 10), task: m[2].trim() };
    return { agentCount: 3, task: args.trim() };
  }

  /**
   * Runs the parallel sub-agent batch + synthesis. NEVER touches paid models.
   */
  public async run(task: string, agentCount = 3, apiKey?: string): Promise<SubagentRun> {
    const t0 = Date.now();
    const n = Math.max(1, Math.min(4, agentCount));
    const roles = SUBAGENT_ROLES.slice(0, n);
    const models = assignModels(n);

    OpLog.getInstance().log('info', 'system', `/subagent run: ${n} agents, task="${task.substring(0, 80)}"`);
    logger.info('SubagentEngine', `Spawning ${n} sub-agents: ${roles.map((r, i) => `${r.title}(${models[i]})`).join(', ')}`);

    const settled = await Promise.allSettled(
      roles.map((role, i) => this.runAgent(role, models[i], task, apiKey))
    );

    const results: SubagentResult[] = settled.map((s, i) => {
      if (s.status === 'fulfilled') return s.value;
      return {
        role: roles[i],
        modelId: models[i],
        ok: false,
        answer: '',
        error: s.reason?.message || 'unknown error',
        durationMs: 0,
      };
    });

    const okResults = results.filter((r) => r.ok);
    let synthesis = '';
    if (okResults.length > 0) {
      try {
        synthesis = await this.synthesize(task, okResults, apiKey);
      } catch (err: any) {
        synthesis = `[SYNTHESIS FAILED: ${err.message}] — raw answers below.`;
      }
    } else {
      synthesis = '[X] All sub-agents failed. See per-agent errors below.';
    }

    const totalDurationMs = Date.now() - t0;
    OpLog.getInstance().log('info', 'system', `/subagent done: ${okResults.length}/${n} ok in ${totalDurationMs}ms`);
    return { task, agentCount: n, results, synthesis, totalDurationMs };
  }

  private async runAgent(role: SubagentRole, modelId: string, task: string, apiKey?: string): Promise<SubagentResult> {
    const t0 = Date.now();
    const instruction = `${Config.defaultSystemInstruction}\n${role.systemSuffix}`;
    const answer = await this.client.generateContent(
      modelId,
      [{ role: 'user', content: task }],
      { systemInstruction: instruction, maxOutputTokens: 1024, apiKey },
      true // ranked fallback chain stays enabled
    );
    return { role, modelId, ok: true, answer: answer.trim(), durationMs: Date.now() - t0 };
  }

  private async synthesize(task: string, results: SubagentResult[], apiKey?: string): Promise<string> {
    const block = results
      .map((r, i) => `[${i + 1}] ${r.role.title} (${r.modelId}):\n${r.answer}`)
      .join('\n\n');
    const instruction = `${Config.defaultSystemInstruction}\nYou are the SYNTHESIZER of a multi-agent consilium. Merge the sub-agent answers below into one verdict: agree on the best plan, resolve contradictions explicitly, output a short action list. Max 250 words.`;
    return this.client.generateContent(
      'openrouter/free',
      [{ role: 'user', content: `TASK: ${task}\n\nSUB-AGENT ANSWERS:\n${block}` }],
      { systemInstruction: instruction, maxOutputTokens: 1024, apiKey }
    );
  }

  /** Renders the full run as chat-ready text. */
  public static format(run: SubagentRun): string {
    const lines: string[] = [];
    lines.push('');
    lines.push('═'.repeat(78));
    lines.push(`   SUB-AGENTS — параллельный запуск (${run.results.length} агентов, ${Math.round(run.totalDurationMs / 100) / 10}s)`);
    lines.push('═'.repeat(78));
    lines.push(`  ЗАДАЧА: ${run.task.substring(0, 120)}${run.task.length > 120 ? '…' : ''}`);
    lines.push('');
    for (const r of run.results) {
      const status = r.ok ? '[OK]' : '[FAIL]';
      const dur = `${Math.round(r.durationMs / 100) / 10}s`;
      lines.push(`  ${status} ${r.role.title.padEnd(10)} ${r.modelId} (${dur})`);
      if (r.ok) {
        for (const l of r.answer.split('\n').slice(0, 12)) lines.push(`       ${l}`);
        if (r.answer.split('\n').length > 12) lines.push('       …');
      } else {
        lines.push(`       error: ${r.error}`);
      }
      lines.push('');
    }
    lines.push('─'.repeat(78));
    lines.push('  СИНТЕЗ:');
    for (const l of run.synthesis.split('\n').slice(0, 20)) lines.push(`  ${l}`);
    lines.push('═'.repeat(78));
    return lines.join('\n');
  }
}
