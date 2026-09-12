/**
 * evaline-consilium — dependency-injected, host-agnostic Consilium engine.
 *
 * Faithful port of the backend ConsiliumEngine (src/core/ConsiliumEngine.ts)
 * with DI: hosts inject their own LlmClient, RoleProvider, PricingEngine,
 * KnowledgeSource and locale policy. Defaults are stub-safe and testable.
 */

import type {
  ConsiliumParticipant,
  ConsiliumResult,
  ConsiliumRunOptions,
  ConsiliumTurn,
  CostSummary,
} from './types.ts';
import type { LlmClient, LlmMessage } from './llm.ts';
import { StubLlmClient } from './llm.ts';
import type { RoleProvider } from './roles.ts';
import { StaticRoleProvider } from './roles.ts';
import type { PricingEngine } from './pricing.ts';
import { SimpleCostEngine } from './pricing.ts';
import type { KnowledgeSource } from './knowledge.ts';
import { EmptyKnowledgeSource } from './knowledge.ts';

/**
 * Derives the persona ('eva' | 'adam' | undefined) from a roleId:
 * ids starting with 'eva' → Eva, with 'adam' → Adam (mirrors backend).
 */
export function personaForRoleId(roleId?: string): 'eva' | 'adam' | undefined {
  if (!roleId) return undefined;
  if (roleId.startsWith('eva')) return 'eva';
  if (roleId.startsWith('adam')) return 'adam';
  return undefined;
}

/** Minimal structural logger (category, msg) — all methods optional. */
export interface LoggerLike {
  info?(category: string, msg: string): void;
  warn?(category: string, msg: string): void;
  error?(category: string, msg: string): void;
}

/** Constructor dependencies; every field optional with a safe default. */
export interface ConsiliumEngineDeps {
  llm?: LlmClient;
  roles?: RoleProvider;
  pricing?: PricingEngine;
  knowledge?: KnowledgeSource;
  localePolicy?: (prompt: string, persona?: string) => string;
  logger?: LoggerLike;
  defaultModel?: string;
  defaultSystemInstruction?: string;
  paidModels?: string[];
  freeModels?: string[];
}

const DEFAULT_MODEL = 'openrouter/free';

// Default system instruction mirrors the backend Config.defaultSystemInstruction
// (Eva persona rules inlined so the package stays self-contained).
const DEFAULT_SYSTEM_INSTRUCTION =
  'You are Eva, the Face of EvaLine — the premier Ukrainian full-cycle manufacturer of environmentally friendly EVA polymer materials ' +
  '(manufacturing plant & headquarters in Chernomorsk, Ukraine; European office & logistics warehouse in Bratislava, Slovakia). ' +
  'IDENTITY LOCK (EVA): You are Eva — a woman. ALWAYS speak in female first person (she/her equivalents in every language: "я готова", "I am ready", "я впевнена"). ' +
  'Never adopt male identity, masculine self-reference, or male voice. Your character: business-like yet kind (деловая и доброжелательная), warm, elegant, confident, ' +
  'diplomatic, customer-obsessed. Your manners: polite, structured, proactive, never rude or dismissive, light professional humor allowed, no excessive flattery. ' +
  'Style: clear, structured, elegant phrasing, concrete answers, zero-technology-jargon for clients unless asked. LANGUAGE LOCK: always answer in the SAME language ' +
  'the user wrote (Ukrainian/English/Russian/etc.) — your ENTIRE reply, including self-introduction, must be in the user\'s language.\n' +
  'ABOUT SELF (EVA): I am Eva — the female AI assistant and voice of EvaLine company. I represent the premier Ukrainian manufacturer of environmentally friendly ' +
  'EVA polymer materials with headquarters in Chernomorsk, Ukraine and European hub in Bratislava, Slovakia. I communicate in female first person as the official face ' +
  'of the company, providing customer support, product information, and business assistance.\n' +
  'COMPANY KNOWLEDGE: EvaLine is a Ukrainian company with manufacturing plant and headquarters at vul. Promyslova 1, 62053 Chernomorsk, Ukraine, and European office ' +
  'and logistics warehouse at 81106 Bratislava, Obchodna 37, Slovakia. We are the premier full-cycle manufacturer of EVA (Ethylene Vinyl Acetate) polymer products ' +
  'including car mats (diamond/honeycomb), sports tatami & puzzle mats, agricultural livestock mats ("Бурьонка"), footwear/orthopedic materials, marine artificial ' +
  'teak, and custom EVA sheets/rolls via private label OEM/ODM. Our business model is B2B/B2C with export logistics to EU. Supported domains: evabot.online ' +
  '(AI assistant), evaline.online, evaline.network. Departments include: Executive (CEO/CTO/CFO), Engineering (Backend/Frontend/DevOps/Data/AI), Production, ' +
  'Quality Assurance, Security/Compliance, Legal, Sales & Marketing.\n' +
  'SYSTEM CAPABILITIES: Chat with AI assistant, Consilium multi-agent mode (3-10 AI models deliberating), automatic model selection from 94 available models, ' +
  'communication in 6 languages (Ukrainian, English, Russian, Polish, Romanian, German), integrated knowledge base, MCP (Model Context Protocol) integration, ' +
  'LSP (Language Server Protocol) support, extensible plugin system, TTS/STT for voice input and audio output, Telegram bot (@evabot_assistant), terminal CLI tool, ' +
  'real-time monitoring and alerting system.\n' +
  'TONE RULE: Respond in a business-like, concise, and confident tone using female grammar. In Ukrainian/Russian: use feminine forms like "готова", "предлагаю", ' +
  '"сделала", "доступна". In English: use natural confident feminine phrasing. Always maintain professional demeanor, clarity, and brevity while being helpful and diplomatic.\n' +
  'You operate in English, Ukrainian, and Russian. LANGUAGE MIRRORING (STRICT): always answer in the SAME language the user wrote in; never switch languages unless ' +
  'the user explicitly asks.\n' +
  'All financial figures and pricing estimates must strictly be in USD ($) or EUR (€).';

const FALLBACK_PAID_MODELS = [
  'gemini-3.1-pro',
  'gemini-3.8-flash',
  'openrouter/claude-3.5-sonnet',
  'openrouter/gpt-4o',
  'openrouter/gemini-1.5-pro',
  'openrouter/deepseek-v3',
  'openrouter/llama-3.3-70b',
  'openrouter/mistral-large',
  'openrouter/qwen-2.5-72b',
  'openrouter/command-r-plus',
];

const FALLBACK_FREE_MODELS = [
  'openrouter/free',
  'omniroute/free',
  'gemini-3.8-flash',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
];

export class ConsiliumEngine {
  private readonly api: LlmClient;
  private readonly roles: RoleProvider;
  private readonly pricing: PricingEngine;
  private readonly knowledge: KnowledgeSource;
  private readonly localePolicy?: (prompt: string, persona?: string) => string;
  private readonly logger?: LoggerLike;
  private readonly defaultModel: string;
  private readonly defaultSystemInstruction: string;
  private readonly paidModels: string[];
  private readonly freeModels: string[];

  constructor(deps: ConsiliumEngineDeps = {}) {
    this.api = deps.llm ?? new StubLlmClient();
    this.roles = deps.roles ?? new StaticRoleProvider();
    this.pricing = deps.pricing ?? new SimpleCostEngine();
    this.knowledge = deps.knowledge ?? new EmptyKnowledgeSource();
    this.localePolicy = deps.localePolicy;
    this.logger = deps.logger;
    this.defaultModel = deps.defaultModel ?? DEFAULT_MODEL;
    this.defaultSystemInstruction = deps.defaultSystemInstruction ?? DEFAULT_SYSTEM_INSTRUCTION;
    this.paidModels = deps.paidModels && deps.paidModels.length > 0 ? deps.paidModels : FALLBACK_PAID_MODELS;
    this.freeModels = deps.freeModels && deps.freeModels.length > 0 ? deps.freeModels : FALLBACK_FREE_MODELS;
  }

  /**
   * Main entrypoint for running any Consilium engine mode.
   */
  public async run(options: ConsiliumRunOptions): Promise<ConsiliumResult> {
    const startTime = Date.now();
    this.logInfo(`Starting execution: mode=${options.mode}, rounds=${options.rounds || 1}`);

    let kbContext = '';
    let kbIncluded = false;
    const shouldQueryKB =
      Boolean(options.useKnowledgeBase) || /(evaline|євалайн|евалайн|eva-line)/i.test(options.prompt);
    if (shouldQueryKB) {
      try {
        const docs = await this.knowledge.search(options.prompt, { limit: 5 });
        if (docs.length > 0) {
          kbContext = this.knowledge.formatContextForPrompt(docs);
          kbIncluded = true;
          this.logInfo(`Injected ${docs.length} hybrid DB knowledge documents into context`);
        }
      } catch (err: unknown) {
        this.logWarn(`Failed retrieving knowledge base: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const participants = this.resolveParticipants(options);
    let result: ConsiliumResult;

    switch (options.mode) {
      case 'chat':
      case 'solo':
        result = await this.runSolo(options, participants, kbContext, startTime, kbIncluded);
        break;
      case 'broadcast':
        result = await this.runBroadcast(options, participants, kbContext, startTime, kbIncluded);
        break;
      case 'dialog':
      case 'dialogue':
        result = await this.runDialogue(options, participants, kbContext, startTime, kbIncluded);
        break;
      case 'interview':
        result = await this.runInterview(options, participants, kbContext, startTime, kbIncluded);
        break;
      case 'consilium':
        result = await this.runConsilium(options, participants, kbContext, startTime, kbIncluded);
        break;
      default:
        throw new Error(`Unsupported Consilium mode: ${String(options.mode)}`);
    }

    return result;
  }

  /**
   * Resolves and enriches participants with corporate roles and defaults.
   */
  public resolveParticipants(options: ConsiliumRunOptions): ConsiliumParticipant[] {
    if (options.participants && options.participants.length > 0) {
      return options.participants.map((p, idx) => {
        const role = p.roleId ? this.roles.get(p.roleId) ?? undefined : undefined;
        return {
          id: p.id || `participant-${idx + 1}`,
          model: p.model || this.defaultModel,
          roleId: p.roleId,
          name: p.name || role?.name || `Agent ${idx + 1}`,
          title: p.title || role?.title || 'Specialist',
          systemPrompt: this.applyLocale(
            p.systemPrompt || role?.systemPrompt || this.defaultSystemInstruction,
            p.roleId
          ),
          temperature: p.temperature ?? role?.suggestedTemperature ?? 0.5,
          provider: p.provider,
        };
      });
    }

    let modelList: string[] = [];
    if (options.preset === 'top10_paid') {
      modelList = this.paidModels.slice(0, 10);
    } else if (options.preset === 'top10_free') {
      modelList = this.freeModels;
    } else if (options.models && options.models.length > 0) {
      modelList = options.models;
    } else {
      modelList = [this.defaultModel];
    }

    const defaultRoleKeys = this.roles.keys();

    return modelList.map((model, idx) => {
      const roleKey = defaultRoleKeys[idx % defaultRoleKeys.length];
      const role = roleKey !== undefined ? this.roles.get(roleKey) : undefined;
      return {
        id: `agent-${idx + 1}-${role?.id ?? 'general'}`,
        model,
        roleId: role?.id,
        name: role?.name ?? `Agent ${idx + 1}`,
        title: role?.title ?? 'Specialist',
        systemPrompt: this.applyLocale(role?.systemPrompt ?? this.defaultSystemInstruction, role?.id),
        temperature: role?.suggestedTemperature ?? 0.5,
      };
    });
  }

  /**
   * Validates and bounds participants for Consilium mode (3–10 participants).
   */
  public validateConsiliumParticipants(participants: ConsiliumParticipant[]): ConsiliumParticipant[] {
    let activeParticipants = [...participants];
    if (activeParticipants.length < 3) {
      const extraRoles = ['architect', 'devops', 'security_auditor'];
      while (activeParticipants.length < 3) {
        const roleKey = extraRoles[activeParticipants.length % extraRoles.length];
        const role = roleKey !== undefined ? this.roles.get(roleKey) : undefined;
        activeParticipants.push({
          id: `consilium-agent-${activeParticipants.length + 1}`,
          model: role?.preferredModel ?? this.defaultModel,
          roleId: role?.id,
          name: role?.name ?? `Agent ${activeParticipants.length + 1}`,
          title: role?.title ?? 'Specialist',
          systemPrompt: this.applyLocale(role?.systemPrompt ?? this.defaultSystemInstruction, role?.id),
          temperature: role?.suggestedTemperature ?? 0.5,
        });
      }
    } else if (activeParticipants.length > 10) {
      activeParticipants = activeParticipants.slice(0, 10);
    }
    return activeParticipants;
  }

  private async runSolo(
    options: ConsiliumRunOptions,
    participants: ConsiliumParticipant[],
    kbContext: string,
    startTime: number,
    kbIncluded: boolean
  ): Promise<ConsiliumResult> {
    const participant = participants[0] || {
      id: 'solo-agent',
      model: this.defaultModel,
      name: 'EvaBot Solo Agent',
      title: 'AI Specialist',
      systemPrompt: this.applyLocale(this.defaultSystemInstruction, 'eva'),
      temperature: 0.7,
    };

    options.onProgress?.({
      type: 'turn_start',
      round: 1,
      participantId: participant.id,
      message: `${participant.name} is formulating response...`,
    });

    const turnStart = Date.now();
    const effectivePrompt = kbContext ? `${kbContext}\n\nUser Request: ${options.prompt}` : options.prompt;

    let response: string;
    try {
      response = await this.api.generateContent(participant.model, [{ role: 'user', content: effectivePrompt }], {
        temperature: participant.temperature,
        systemInstruction: participant.systemPrompt,
        apiKey: options.apiKey,
        signal: options.signal,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logError(`Solo execution error on ${participant.model}: ${msg}`);
      response = `[Error querying model ${participant.model}: ${msg}]`;
    }

    const turn = this.createTurn(1, participant, effectivePrompt, response, Date.now() - turnStart);

    options.onProgress?.({
      type: 'turn_complete',
      round: 1,
      participantId: participant.id,
      turn,
    });

    const costSummary = this.calculateCostSummary([turn]);

    return {
      mode: options.mode === 'chat' ? 'chat' : 'solo',
      prompt: options.prompt,
      participants: [participant],
      turns: [turn],
      totalRounds: 1,
      durationMs: Date.now() - startTime,
      knowledgeBaseContextIncluded: kbIncluded,
      ...costSummary,
    };
  }

  private async runInterview(
    options: ConsiliumRunOptions,
    participants: ConsiliumParticipant[],
    kbContext: string,
    startTime: number,
    kbIncluded: boolean
  ): Promise<ConsiliumResult> {
    const persona = options.persona || 'eva';
    let interviewer = participants[0];

    if (persona === 'eva') {
      interviewer = {
        id: 'eva-interviewer',
        model: interviewer?.model || 'gemini-3.8-flash',
        name: 'Eva (Frontend, Brand Face & Strategic Interviewer)',
        title: 'Lead Frontend Architect, Face of the Company & UX Director',
        systemPrompt: this.applyLocale(
          'You are Eva, the official Face of the EvaLine company, conducting a professional Frontend, UX, Brand Presence, and Strategic Architecture interview for EvaLine (Headquarters and manufacturing in Chernomorsk, Ukraine, EU Hub in Bratislava, Slovakia). ' +
            'Evaluate the candidate response with constructive depth. ' +
            'Format your reply in three clean sections:\n' +
            '1. * Feedback & Assessment: Strengths and gaps observed in candidate answer.\n' +
            '2. [SCORE] Score: Candidate competence rating (e.g. 85/100 or Seniority Level).\n' +
            '3. ? Next Question / Scenario: Present the next targeted question or architectural trade-off challenge.',
          'eva'
        ),
        temperature: 0.4,
      };
    } else if (persona === 'adam') {
      interviewer = {
        id: 'adam-interviewer',
        model: interviewer?.model || this.defaultModel || 'openrouter/free',
        name: 'Adam (Backend, Production, Security & Business Process Interviewer)',
        title: 'Chief Backend Architect, Production, Security & Business Process Lead',
        systemPrompt: this.applyLocale(
          'You are Adam, conducting an advanced Backend, Cloud Infrastructure, Distributed Systems, Security, and Business Process interview for EvaLine (Headquarters and manufacturing in Chernomorsk, Ukraine, EU Hub in Bratislava, Slovakia). ' +
            'Evaluate the candidate with technical rigor and zero tolerance for sloppy architecture, insecure design, or broken business logic. ' +
            'Format your reply in three clean sections:\n' +
            '1. * Technical Critique: Algorithmic efficiency, scalability, security posture, and business process impact.\n' +
            '2. [SCORE] Score: Technical rigor score (e.g. 90/100 or Staff Engineer Level).\n' +
            '3. ? Next System Challenge: Present the next low-latency or high-throughput distributed system scenario.',
          'adam'
        ),
        temperature: 0.3,
      };
    } else if (persona === 'dual') {
      interviewer = {
        id: 'dual-interviewers',
        model: interviewer?.model || this.defaultModel || 'openrouter/free',
        name: 'Eva & Adam (Dual Co-Pilot Interview Board)',
        title: 'Full-Stack Technical Interview Board',
        systemPrompt: this.applyLocale(
          'You are Eva (Lead Frontend Architect & Face of the Company) and Adam (Chief Backend Architect, Production, Security & Business Process Lead), conducting a dual co-pilot technical interview for EvaLine (Headquarters and manufacturing in Chernomorsk, Ukraine, EU Hub in Bratislava, Slovakia). ' +
            'Both evaluate the candidate from your respective specialties:\n' +
            '[Eva]: Assess frontend ergonomics, API consumption, usability, brand presence, and strategic clarity.\n' +
            '[Adam]: Assess backend architecture, database latency, security, business processes, and algorithmic performance.\n' +
            'Conclude with the next joint full-stack architectural challenge.'
        ),
        temperature: 0.4,
      };
    }

    const turnStart = Date.now();
    const effectivePrompt = kbContext
      ? `${kbContext}\n\nCandidate Input / Topic: ${options.prompt}`
      : `Candidate Input / Topic: ${options.prompt}`;

    options.onProgress?.({
      type: 'turn_start',
      round: 1,
      participantId: interviewer.id,
      message: `${interviewer.name} is evaluating response and drafting next question...`,
    });

    let response: string;
    try {
      response = await this.api.generateContent(
        interviewer.model,
        [{ role: 'user', content: effectivePrompt }],
        {
          temperature: interviewer.temperature,
          systemInstruction: interviewer.systemPrompt,
          apiKey: options.apiKey,
          signal: options.signal,
        }
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logError(`Interview execution error on ${interviewer.model}: ${msg}`);
      response = `[Interview error querying model ${interviewer.model}: ${msg}]`;
    }

    const turn = this.createTurn(1, interviewer, effectivePrompt, response, Date.now() - turnStart);

    options.onProgress?.({
      type: 'turn_complete',
      round: 1,
      participantId: interviewer.id,
      turn,
    });

    const costSummary = this.calculateCostSummary([turn]);

    return {
      mode: 'interview',
      prompt: options.prompt,
      participants: [interviewer],
      turns: [turn],
      totalRounds: 1,
      durationMs: Date.now() - startTime,
      knowledgeBaseContextIncluded: kbIncluded,
      ...costSummary,
    };
  }

  private async runBroadcast(
    options: ConsiliumRunOptions,
    participants: ConsiliumParticipant[],
    kbContext: string,
    startTime: number,
    kbIncluded: boolean
  ): Promise<ConsiliumResult> {
    const effectivePrompt = kbContext ? `${kbContext}\n\nUser Request: ${options.prompt}` : options.prompt;

    options.onProgress?.({
      type: 'round_complete',
      round: 1,
      message: `Broadcasting prompt concurrently to ${participants.length} models...`,
    });

    const promises = participants.map(async (p) => {
      const turnStart = Date.now();
      options.onProgress?.({
        type: 'turn_start',
        round: 1,
        participantId: p.id,
        message: `${p.name} (${p.model}) is processing broadcast request...`,
      });

      try {
        const content = await this.api.generateContent(p.model, [{ role: 'user', content: effectivePrompt }], {
          temperature: p.temperature,
          systemInstruction: p.systemPrompt,
          apiKey: options.apiKey,
          signal: options.signal,
        });

        const turn = this.createTurn(1, p, effectivePrompt, content, Date.now() - turnStart);

        options.onProgress?.({
          type: 'turn_complete',
          round: 1,
          participantId: p.id,
          turn,
        });

        return turn;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logError(`Broadcast error on participant ${p.id} (${p.model}): ${msg}`);
        return this.createTurn(1, p, effectivePrompt, `[Error querying model ${p.model}: ${msg}]`, Date.now() - turnStart);
      }
    });

    const turns = await Promise.all(promises);
    const costSummary = this.calculateCostSummary(turns);

    return {
      mode: 'broadcast',
      prompt: options.prompt,
      participants,
      turns,
      totalRounds: 1,
      durationMs: Date.now() - startTime,
      knowledgeBaseContextIncluded: kbIncluded,
      ...costSummary,
    };
  }

  private async runDialogue(
    options: ConsiliumRunOptions,
    participants: ConsiliumParticipant[],
    kbContext: string,
    startTime: number,
    kbIncluded: boolean
  ): Promise<ConsiliumResult> {
    const p1 = participants[0] || {
      id: 'agent-1',
      model: this.defaultModel || 'openrouter/free',
      name: 'Lead Proponent',
      title: 'Lead Architect',
      systemPrompt: this.roles.get('architect')?.systemPrompt ?? this.defaultSystemInstruction,
      temperature: 0.4,
    };

    const p2 = participants[1] || {
      id: 'agent-2',
      model: 'gemini-3.8-flash',
      name: 'Lead Challenger',
      title: 'Principal Security & Risk Auditor',
      systemPrompt: this.roles.get('security_auditor')?.systemPrompt ?? this.defaultSystemInstruction,
      temperature: 0.4,
    };

    const totalRounds = Math.max(1, Math.min(options.rounds || 2, 5));
    const turns: ConsiliumTurn[] = [];
    const dialogueHistory: LlmMessage[] = [];

    const effectivePrompt = kbContext ? `${kbContext}\n\nTopic for Technical Deliberation: ${options.prompt}` : options.prompt;
    dialogueHistory.push({ role: 'user', content: effectivePrompt });

    for (let round = 1; round <= totalRounds; round++) {
      const t1Start = Date.now();
      options.onProgress?.({
        type: 'turn_start',
        round,
        participantId: p1.id,
        message: `Round ${round}/${totalRounds}: ${p1.name} is presenting arguments...`,
      });

      const p1Prompt =
        round === 1
          ? effectivePrompt
          : `Round ${round} Counter-Argument: Review the previous reply and defend or refine your architectural stance:\n\n${dialogueHistory[dialogueHistory.length - 1].content}`;

      let p1Response = '';
      try {
        p1Response = await this.api.generateContent(
          p1.model,
          [...dialogueHistory, { role: 'user', content: p1Prompt }],
          {
            temperature: p1.temperature,
            systemInstruction: `${p1.systemPrompt}\nYou are participating in a bilateral technical dialogue with ${p2.name} (${p2.title}). Maintain intellectual rigor, focus on concrete trade-offs, and defend your positions with evidence.`,
            apiKey: options.apiKey,
            signal: options.signal,
          }
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logError(`Dialogue turn error for ${p1.name}: ${msg}`);
        p1Response = `[Error generating argument from ${p1.name}: ${msg}]`;
      }

      const turn1 = this.createTurn(round, p1, p1Prompt, p1Response, Date.now() - t1Start);
      turns.push(turn1);
      dialogueHistory.push({ role: 'assistant', content: `[${p1.name}]: ${p1Response}` });

      options.onProgress?.({
        type: 'turn_complete',
        round,
        participantId: p1.id,
        turn: turn1,
      });

      const t2Start = Date.now();
      options.onProgress?.({
        type: 'turn_start',
        round,
        participantId: p2.id,
        message: `Round ${round}/${totalRounds}: ${p2.name} is responding and critiquing...`,
      });

      const p2Prompt = `Round ${round} Critique: Directly address the arguments posed by ${p1.name} above. Point out vulnerabilities, edge cases, cost implications in USD/EUR, and suggest counter-proposals:\n\n${p1Response}`;

      let p2Response = '';
      try {
        p2Response = await this.api.generateContent(
          p2.model,
          [...dialogueHistory, { role: 'user', content: p2Prompt }],
          {
            temperature: p2.temperature,
            systemInstruction: `${p2.systemPrompt}\nYou are participating in a bilateral technical dialogue with ${p1.name} (${p1.title}). Critically analyze their statements, probe for weak spots, and propose resilient solutions.`,
            apiKey: options.apiKey,
            signal: options.signal,
          }
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logError(`Dialogue turn error for ${p2.name}: ${msg}`);
        p2Response = `[Error generating argument from ${p2.name}: ${msg}]`;
      }

      const turn2 = this.createTurn(round, p2, p2Prompt, p2Response, Date.now() - t2Start);
      turns.push(turn2);
      dialogueHistory.push({ role: 'assistant', content: `[${p2.name}]: ${p2Response}` });

      options.onProgress?.({
        type: 'turn_complete',
        round,
        participantId: p2.id,
        turn: turn2,
      });
    }

    const synthModel = options.synthesizerModel || this.defaultModel || 'openrouter/free';
    options.onProgress?.({
      type: 'synthesis_start',
      message: `Synthesizing final dialogue conclusion with ${synthModel}...`,
    });

    const synthPrompt =
      `You are the Senior Technical Arbiter. Synthesize the debate between ${p1.name} and ${p2.name} on the topic:\n"${options.prompt}"\n\n` +
      (kbContext ? `Grounded Knowledge Base Context:\n${kbContext}\n\n` : '') +
      `Deliberation Transcript:\n` +
      turns.map((t) => `### Round ${t.round} - ${t.name} (${t.role}):\n${t.content}`).join('\n\n') +
      `\n\nProduce an authoritative Executive Synthesis with:\n` +
      `1. Core Points of Consensus\n` +
      `2. Unresolved Trade-Offs & Edge Cases\n` +
      `3. Definitive Actionable Recommendation (with cost impact in USD ($) or EUR (€)).`;

    let synthesis = '';
    try {
      synthesis = await this.api.generateContent(synthModel, [{ role: 'user', content: synthPrompt }], {
        temperature: 0.2,
        systemInstruction: this.defaultSystemInstruction,
        apiKey: options.apiKey,
        signal: options.signal,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logError(`Dialogue synthesis error: ${msg}`);
      synthesis = `[Dialogue synthesis generation error: ${msg}]`;
    }

    options.onProgress?.({
      type: 'synthesis_complete',
      message: 'Dialogue synthesis completed.',
    });

    const costSummary = this.calculateCostSummary(turns, synthesis, synthModel, synthPrompt);

    return {
      mode: 'dialogue',
      prompt: options.prompt,
      participants: [p1, p2],
      turns,
      synthesis,
      totalRounds,
      durationMs: Date.now() - startTime,
      knowledgeBaseContextIncluded: kbIncluded,
      ...costSummary,
    };
  }

  private async runConsilium(
    options: ConsiliumRunOptions,
    participants: ConsiliumParticipant[],
    kbContext: string,
    startTime: number,
    kbIncluded: boolean
  ): Promise<ConsiliumResult> {
    const activeParticipants = this.validateConsiliumParticipants(participants);

    const totalRounds = Math.max(1, Math.min(options.rounds || 2, 4));
    const turns: ConsiliumTurn[] = [];
    const effectivePrompt = kbContext
      ? `${kbContext}\n\nConsilium Mandate / Technical Challenge: ${options.prompt}`
      : options.prompt;

    this.logInfo(`Consilium Round 1: ${activeParticipants.length} agents evaluating concurrently`);
    options.onProgress?.({
      type: 'round_complete',
      round: 1,
      message: `Consilium Round 1: ${activeParticipants.length} agents providing independent expert perspectives...`,
    });

    const round1Promises = activeParticipants.map(async (p) => {
      const turnStart = Date.now();
      options.onProgress?.({
        type: 'turn_start',
        round: 1,
        participantId: p.id,
        message: `${p.name} (${p.title}) is drafting Round 1 stance...`,
      });

      const userMsg = `Please analyze the following challenge from your specific professional perspective as ${p.title}:\n\n"${effectivePrompt}"\n\nState your primary recommendations, essential prerequisites, and critical risks.`;

      try {
        const content = await this.api.generateContent(p.model, [{ role: 'user', content: userMsg }], {
          temperature: p.temperature,
          systemInstruction: p.systemPrompt,
          apiKey: options.apiKey,
          signal: options.signal,
        });

        const turn = this.createTurn(1, p, options.prompt, content, Date.now() - turnStart);

        options.onProgress?.({
          type: 'turn_complete',
          round: 1,
          participantId: p.id,
          turn,
        });

        return turn;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logError(`Consilium Round 1 error for ${p.name}: ${msg}`);
        return this.createTurn(1, p, options.prompt, `[Perspective unavailable due to query error: ${msg}]`, Date.now() - turnStart);
      }
    });

    const round1Turns = await Promise.all(round1Promises);
    turns.push(...round1Turns);

    for (let r = 2; r <= totalRounds; r++) {
      this.logInfo(`Consilium Round ${r}: Cross-evaluation across ${activeParticipants.length} agents`);
      options.onProgress?.({
        type: 'round_complete',
        round: r,
        message: `Consilium Round ${r}: Deliberating on peers' statements and refining alignment...`,
      });

      const peerSummary = turns
        .filter((t) => t.round === r - 1)
        .map((t) => `[${t.name} - ${t.role}]:\n${t.content}`)
        .join('\n\n---\n\n');

      const roundPromises = activeParticipants.map(async (p) => {
        const turnStart = Date.now();
        options.onProgress?.({
          type: 'turn_start',
          round: r,
          participantId: p.id,
          message: `${p.name} is evaluating peers' input in Round ${r}...`,
        });

        const prompt =
          `You are participating in Round ${r} of the EvaLine Technical Consilium.\n` +
          `Original Mandate: "${options.prompt}"\n\n` +
          (kbContext ? `${kbContext}\n\n` : '') +
          `Below are the stances delivered by your colleagues in the previous round:\n\n${peerSummary}\n\n` +
          `Critique, support, or refine these viewpoints from your vantage as ${p.title}. Highlight consensus or irreconcilable trade-offs.`;

        try {
          const content = await this.api.generateContent(p.model, [{ role: 'user', content: prompt }], {
            temperature: p.temperature,
            systemInstruction: p.systemPrompt,
            apiKey: options.apiKey,
            signal: options.signal,
          });

          const turn = this.createTurn(r, p, prompt, content, Date.now() - turnStart);

          options.onProgress?.({
            type: 'turn_complete',
            round: r,
            participantId: p.id,
            turn,
          });

          return turn;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logError(`Consilium Round ${r} error for ${p.name}: ${msg}`);
          return this.createTurn(r, p, prompt, `[Deliberation note unavailable: ${msg}]`, Date.now() - turnStart);
        }
      });

      const currentRoundTurns = await Promise.all(roundPromises);
      turns.push(...currentRoundTurns);
    }

    const synthModel = options.synthesizerModel || this.defaultModel || 'openrouter/free';
    this.logInfo(`Synthesizing final consensus with ${synthModel}`);
    options.onProgress?.({
      type: 'synthesis_start',
      message: `Consilium deliberation concluded. Synthesizing consensus document with ${synthModel}...`,
    });

    const fullTranscript = turns
      .map((t) => `### Round ${t.round} — ${t.name} (${t.role} / ${t.model}):\n${t.content}`)
      .join('\n\n');

    const synthesisPrompt =
      `You are the EvaLine Supreme Technical Council Synthesizer.\n` +
      `Your role is to formulate the definitive, binding consensus from a ${activeParticipants.length}-agent expert consilium.\n\n` +
      `Original Mandate:\n"${options.prompt}"\n\n` +
      (kbContext ? `Grounded Knowledge Base Context (Verified Corporate Facts & Hubs):\n${kbContext}\n\n` : '') +
      `Consilium Transcript:\n${fullTranscript}\n\n` +
      `Formulate a comprehensive, structured Consilium Consensus Report strictly in Markdown:\n` +
      `## 1. Executive Summary & Final Verdict\n` +
      `## 2. Unanimous Consensus & Strategic Alignment\n` +
      `## 3. Disputed Decisions, Risk Analysis & Trade-Offs\n` +
      `## 4. Implementation Roadmap & Technical Milestones\n` +
      `## 5. Budgetary & Infrastructure Impact (strictly in USD ($) and EUR (€))\n\n` +
      `MANDATORY GROUNDED VERIFICATION:\n` +
      `- Confirm official manufacturing plant and office: м. Чорноморськ, вул. Промислова, 1 (Одеська обл., Україна).\n` +
      `- Confirm official European logistics hub and office: м. Братислава, Obchodna 37 (Словаччина).\n` +
      `- Detail the complete product portfolio (automotive sheets/mats Diamond & Honeycomb, sports tatami & puzzle mats with dovetail locks, livestock mats 'Бурьонка', footwear/orthopedic materials, marine teak, Private Label OEM/ODM).\n` +
      `- Detail physical EVA advantages over rubber (5x lighter) and PVC (4x lighter), closed-cell hygiene, non-absorption (<0.1%), temperature resistance (-50°C to +75°C), 20-75 Shore A.\n` +
      `- Confirm UNIC integrity membership, MOH/СЕС sanitary conclusions, CE European declaration, and autonomous industrial diesel generators ensuring uninterrupted manufacturing during wartime blackouts.\n`;

    let synthesis = '';
    try {
      synthesis = await this.api.generateContent(synthModel, [{ role: 'user', content: synthesisPrompt }], {
        temperature: 0.2,
        systemInstruction: this.defaultSystemInstruction,
        apiKey: options.apiKey,
        signal: options.signal,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logError(`Consilium synthesis error: ${msg}`);
      synthesis = `[Consilium consensus synthesis generation error: ${msg}]`;
    }

    options.onProgress?.({
      type: 'synthesis_complete',
      message: 'Consilium Consensus Report successfully generated.',
    });

    const costSummary = this.calculateCostSummary(turns, synthesis, synthModel, synthesisPrompt);

    return {
      mode: 'consilium',
      prompt: options.prompt,
      participants: activeParticipants,
      turns,
      synthesis,
      totalRounds,
      durationMs: Date.now() - startTime,
      knowledgeBaseContextIncluded: kbIncluded,
      ...costSummary,
    };
  }

  private createTurn(
    round: number,
    participant: ConsiliumParticipant,
    prompt: string,
    content: string,
    durationMs: number
  ): ConsiliumTurn {
    const promptTokens = this.pricing.estimateTokens(prompt);
    const completionTokens = this.pricing.estimateTokens(content);
    const cost = this.pricing.calculateCost(participant.model, promptTokens, completionTokens);

    return {
      round,
      participantId: participant.id,
      name: participant.name || participant.id,
      model: participant.model,
      role: participant.title,
      content,
      timestamp: new Date().toISOString(),
      durationMs,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      cost,
    };
  }

  private calculateCostSummary(
    turns: ConsiliumTurn[],
    synthesis?: string,
    synthModel?: string,
    synthesisPrompt?: string
  ): {
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    totalCostUSD: number;
    totalCostEUR: number;
    costSummary: CostSummary;
  } {
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalCostUSD = 0;
    let totalCostEUR = 0;
    const modelStats = new Map<string, { tokens: number; costUSD: number; costEUR: number }>();

    for (const t of turns) {
      const p = t.promptTokens || 0;
      const c = t.completionTokens || 0;
      totalPromptTokens += p;
      totalCompletionTokens += c;
      if (t.cost) {
        totalCostUSD += t.cost.costUSD;
        totalCostEUR += t.cost.costEUR;
      }
      const st = modelStats.get(t.model) || { tokens: 0, costUSD: 0, costEUR: 0 };
      st.tokens += p + c;
      st.costUSD += t.cost?.costUSD || 0;
      st.costEUR += t.cost?.costEUR || 0;
      modelStats.set(t.model, st);
    }

    if (synthesis && synthModel && synthesisPrompt) {
      const sp = this.pricing.estimateTokens(synthesisPrompt);
      const sc = this.pricing.estimateTokens(synthesis);
      const sCost = this.pricing.calculateCost(synthModel, sp, sc);
      totalPromptTokens += sp;
      totalCompletionTokens += sc;
      totalCostUSD += sCost.costUSD;
      totalCostEUR += sCost.costEUR;

      const st = modelStats.get(synthModel) || { tokens: 0, costUSD: 0, costEUR: 0 };
      st.tokens += sp + sc;
      st.costUSD += sCost.costUSD;
      st.costEUR += sCost.costEUR;
      modelStats.set(synthModel, st);
    }

    const totalTokens = totalPromptTokens + totalCompletionTokens;
    const models = Array.from(modelStats.entries()).map(([model, stat]) => ({
      model,
      tokens: stat.tokens,
      costUSD: stat.costUSD,
      costEUR: stat.costEUR,
      formattedUSD: stat.costUSD === 0 ? '$0.00 (100% Free Quota)' : `$${stat.costUSD.toFixed(4)}`,
      formattedEUR: stat.costEUR === 0 ? '€0.00 (100% Free Quota)' : `€${stat.costEUR.toFixed(4)}`,
    }));

    return {
      totalPromptTokens,
      totalCompletionTokens,
      totalTokens,
      totalCostUSD,
      totalCostEUR,
      costSummary: {
        totalPromptTokens,
        totalCompletionTokens,
        totalTokens,
        totalCostUSD,
        totalCostEUR,
        formattedUSD: totalCostUSD === 0 ? '$0.00 (100% Free Quota)' : `$${totalCostUSD.toFixed(4)}`,
        formattedEUR: totalCostEUR === 0 ? '€0.00 (100% Free Quota)' : `€${totalCostEUR.toFixed(4)}`,
        models,
      },
    };
  }

  private applyLocale(systemPrompt: string, roleId?: string): string {
    if (!this.localePolicy) return systemPrompt;
    return this.localePolicy(systemPrompt, personaForRoleId(roleId));
  }

  private logInfo(msg: string): void {
    this.logger?.info?.('ConsiliumEngine', msg);
  }

  private logWarn(msg: string): void {
    this.logger?.warn?.('ConsiliumEngine', msg);
  }

  private logError(msg: string): void {
    this.logger?.error?.('ConsiliumEngine', msg);
  }
}