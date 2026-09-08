import { UniversalLlmClient, UniversalMessage, LlmProvider } from './UniversalLlmClient.js';
import { ModelRegistry, TokenCostEstimate } from '../models/ModelRegistry.js';
import { CORPORATE_ROLES, KnowledgeBaseConnector } from './CorporateRoles.js';
import { applyLocalePolicy } from './LocalePolicy.js';
import { Config } from './Config.js';
import { logger } from './Logger.js';

export type ConsiliumMode = 'chat' | 'dialog' | 'interview' | 'consilium' | 'solo' | 'broadcast' | 'dialogue';
export type PersonaId = 'eva' | 'adam' | 'dual';

/**
 * Derives the PersonaPolicy persona ('eva' | 'adam' | undefined) from a
 * corporate roleId: ids starting with 'eva' → Eva, with 'adam' → Adam.
 */
export function personaForRoleId(roleId?: string): 'eva' | 'adam' | undefined {
  if (!roleId) return undefined;
  if (roleId.startsWith('eva')) return 'eva';
  if (roleId.startsWith('adam')) return 'adam';
  return undefined;
}

export interface ConsiliumParticipant {
  id: string;
  model: string;
  roleId?: string;
  name?: string;
  title?: string;
  systemPrompt?: string;
  temperature?: number;
  provider?: LlmProvider;
}

export interface ConsiliumTurn {
  round: number;
  participantId: string;
  name: string;
  model: string;
  role?: string;
  content: string;
  timestamp: string;
  durationMs: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cost?: TokenCostEstimate;
}

export interface ConsiliumProgressEvent {
  type: 'turn_start' | 'turn_complete' | 'round_complete' | 'synthesis_start' | 'synthesis_complete' | 'error';
  round?: number;
  participantId?: string;
  turn?: ConsiliumTurn;
  message?: string;
}

export interface ConsiliumRunOptions {
  mode: ConsiliumMode;
  persona?: PersonaId;
  prompt: string;
  models?: string[];
  participants?: ConsiliumParticipant[];
  rounds?: number;
  preset?: 'top10_paid' | 'top10_free';
  synthesizerModel?: string;
  systemInstruction?: string;
  apiKey?: string;
  useKnowledgeBase?: boolean;
  onProgress?: (event: ConsiliumProgressEvent) => void;
  signal?: AbortSignal;
}

export interface ConsiliumResult {
  mode: ConsiliumMode;
  prompt: string;
  participants: ConsiliumParticipant[];
  turns: ConsiliumTurn[];
  synthesis?: string;
  totalRounds: number;
  durationMs: number;
  knowledgeBaseContextIncluded: boolean;
  totalPromptTokens?: number;
  totalCompletionTokens?: number;
  totalTokens?: number;
  totalCostUSD?: number;
  totalCostEUR?: number;
  costSummary?: {
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    totalCostUSD: number;
    totalCostEUR: number;
    formattedUSD: string;
    formattedEUR: string;
    models: Array<{
      model: string;
      tokens: number;
      costUSD: number;
      costEUR: number;
      formattedUSD: string;
      formattedEUR: string;
    }>;
  };
}

export class ConsiliumEngine {
  private client: UniversalLlmClient;
  private kbConnector: KnowledgeBaseConnector;

  constructor(apiKey?: string) {
    this.client = new UniversalLlmClient(apiKey);
    this.kbConnector = new KnowledgeBaseConnector();
  }

  /**
   * Main entrypoint for running any Consilium engine mode
   */
  public async run(options: ConsiliumRunOptions): Promise<ConsiliumResult> {
    const startTime = Date.now();
    logger.info('ConsiliumEngine', `Starting execution: mode=${options.mode}, rounds=${options.rounds || 1}`);

    // Fetch hybrid DB context if enabled or if prompt concerns EvaLine
    let kbContext = '';
    let kbIncluded = false;
    const shouldQueryKB = Boolean(options.useKnowledgeBase) || /(evaline|євалайн|евалайн|eva-line)/i.test(options.prompt);
    if (shouldQueryKB) {
      try {
        const docs = await this.kbConnector.search(options.prompt, { limit: 5 });
        if (docs.length > 0) {
          kbContext = this.kbConnector.formatContextForPrompt(docs);
          kbIncluded = true;
          logger.info('ConsiliumEngine', `Injected ${docs.length} hybrid DB knowledge documents into context`);
        }
      } catch (err: unknown) {
        logger.warn('ConsiliumEngine', `Failed retrieving knowledge base: ${err instanceof Error ? err.message : String(err)}`);
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
   * Resolves and enriches participants list with corporate roles and defaults
   */
  public resolveParticipants(options: ConsiliumRunOptions): ConsiliumParticipant[] {
    if (options.participants && options.participants.length > 0) {
      return options.participants.map((p, idx) => {
        const role = p.roleId && CORPORATE_ROLES[p.roleId] ? CORPORATE_ROLES[p.roleId] : undefined;
        return {
          id: p.id || `participant-${idx + 1}`,
          model: p.model || Config.defaultModel,
          roleId: p.roleId,
          name: p.name || role?.name || `Agent ${idx + 1}`,
          title: p.title || role?.title || 'Specialist',
          systemPrompt: applyLocalePolicy(p.systemPrompt || role?.systemPrompt || Config.defaultSystemInstruction, personaForRoleId(p.roleId)),
          temperature: p.temperature ?? role?.suggestedTemperature ?? 0.5,
          provider: p.provider,
        };
      });
    }

    let modelList: string[] = [];
    if (options.preset === 'top10_paid') {
      modelList = ModelRegistry.getTop10PaidSmartestModels().map((m) => m.id);
    } else if (options.preset === 'top10_free') {
      modelList = ModelRegistry.getTop10FreeModels().map((m) => m.id);
    } else if (options.models && options.models.length > 0) {
      modelList = options.models;
    } else {
      modelList = [Config.defaultModel];
    }

    const defaultRoleKeys = Object.keys(CORPORATE_ROLES);

    return modelList.map((model, idx) => {
      const roleKey = defaultRoleKeys[idx % defaultRoleKeys.length];
      const role = CORPORATE_ROLES[roleKey];
      return {
        id: `agent-${idx + 1}-${role.id}`,
        model,
        roleId: role.id,
        name: role.name,
        title: role.title,
        systemPrompt: applyLocalePolicy(role.systemPrompt, personaForRoleId(role.id)),
        temperature: role.suggestedTemperature,
      };
    });
  }

  /**
   * Validates and bounds participants for Consilium mode (strictly between 3 and 10 participants)
   */
  public validateConsiliumParticipants(participants: ConsiliumParticipant[]): ConsiliumParticipant[] {
    let activeParticipants = [...participants];
    if (activeParticipants.length < 3) {
      // Expand up to 3 minimum with corporate roles
      const extraRoles = ['architect', 'devops', 'security_auditor'];
      while (activeParticipants.length < 3) {
        const role = CORPORATE_ROLES[extraRoles[activeParticipants.length % extraRoles.length]];
        activeParticipants.push({
          id: `consilium-agent-${activeParticipants.length + 1}`,
          model: role.preferredModel,
          roleId: role.id,
          name: role.name,
          title: role.title,
        systemPrompt: applyLocalePolicy(role.systemPrompt, personaForRoleId(role.id)),
          temperature: role.suggestedTemperature,
        });
      }
    } else if (activeParticipants.length > 10) {
      // Bound to maximum 10 participants
      activeParticipants = activeParticipants.slice(0, 10);
    }
    return activeParticipants;
  }

  /**
   * Mode 1: Solo Mode (Standard 1-on-1 execution)
   */
  private async runSolo(
    options: ConsiliumRunOptions,
    participants: ConsiliumParticipant[],
    kbContext: string,
    startTime: number,
    kbIncluded: boolean
  ): Promise<ConsiliumResult> {
    const participant = participants[0] || {
      id: 'solo-agent',
      model: Config.defaultModel,
      name: 'EvaBot Solo Agent',
      title: 'AI Specialist',
      systemPrompt: applyLocalePolicy(Config.defaultSystemInstruction, 'eva'),
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
      response = await this.client.generateContent(
        participant.model,
        [{ role: 'user', content: effectivePrompt }],
        {
          temperature: participant.temperature,
          systemInstruction: participant.systemPrompt,
          apiKey: options.apiKey,
          signal: options.signal,
        }
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('ConsiliumEngine', `Solo execution error on ${participant.model}: ${msg}`);
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

  /**
   * Mode: Interview Mode (Structured technical or executive interview)
   */
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
        model: interviewer?.model || 'gemini-2.5-flash',
        name: 'Eva (Frontend, Brand Face & Strategic Interviewer)',
        title: 'Lead Frontend Architect, Face of the Company & UX Director',
        systemPrompt: applyLocalePolicy(
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
        model: interviewer?.model || Config.defaultModel || 'openrouter/free',
        name: 'Adam (Backend, Production, Security & Business Process Interviewer)',
        title: 'Chief Backend Architect, Production, Security & Business Process Lead',
        systemPrompt: applyLocalePolicy(
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
        model: interviewer?.model || Config.defaultModel || 'openrouter/free',
        name: 'Eva & Adam (Dual Co-Pilot Interview Board)',
        title: 'Full-Stack Technical Interview Board',
        systemPrompt: applyLocalePolicy(
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
      response = await this.client.generateContent(
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
      logger.error('ConsiliumEngine', `Interview execution error on ${interviewer.model}: ${msg}`);
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

  /**
   * Mode 2: Broadcast Mode (Query N models concurrently)
   */
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
        const content = await this.client.generateContent(
          p.model,
          [{ role: 'user', content: effectivePrompt }],
          {
            temperature: p.temperature,
            systemInstruction: p.systemPrompt,
            apiKey: options.apiKey,
            signal: options.signal,
          }
        );

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
        logger.error('ConsiliumEngine', `Broadcast error on participant ${p.id} (${p.model}): ${msg}`);
        const failedTurn = this.createTurn(
          1,
          p,
          effectivePrompt,
          `[Error querying model ${p.model}: ${msg}]`,
          Date.now() - turnStart
        );
        return failedTurn;
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

  /**
   * Mode 3: Dual-model Dialogue Mode (2 models exchange arguments over K rounds)
   */
  private async runDialogue(
    options: ConsiliumRunOptions,
    participants: ConsiliumParticipant[],
    kbContext: string,
    startTime: number,
    kbIncluded: boolean
  ): Promise<ConsiliumResult> {
    const p1 = participants[0] || {
      id: 'agent-1',
      model: Config.defaultModel || 'openrouter/free',
      name: 'Lead Proponent',
      title: 'Lead Architect',
      systemPrompt: CORPORATE_ROLES.architect.systemPrompt,
      temperature: 0.4,
    };

    const p2 = participants[1] || {
      id: 'agent-2',
      model: 'gemini-2.5-flash',
      name: 'Lead Challenger',
      title: 'Principal Security & Risk Auditor',
      systemPrompt: CORPORATE_ROLES.security_auditor.systemPrompt,
      temperature: 0.4,
    };

    const totalRounds = Math.max(1, Math.min(options.rounds || 2, 5));
    const turns: ConsiliumTurn[] = [];
    const dialogueHistory: UniversalMessage[] = [];

    const effectivePrompt = kbContext ? `${kbContext}\n\nTopic for Technical Deliberation: ${options.prompt}` : options.prompt;
    dialogueHistory.push({ role: 'user', content: effectivePrompt });

    for (let round = 1; round <= totalRounds; round++) {
      // Participant 1's turn
      const t1Start = Date.now();
      options.onProgress?.({
        type: 'turn_start',
        round,
        participantId: p1.id,
        message: `Round ${round}/${totalRounds}: ${p1.name} is presenting arguments...`,
      });

      const p1Prompt = round === 1
        ? effectivePrompt
        : `Round ${round} Counter-Argument: Review the previous reply and defend or refine your architectural stance:\n\n${dialogueHistory[dialogueHistory.length - 1].content}`;

      let p1Response = '';
      try {
        p1Response = await this.client.generateContent(
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
        logger.error('ConsiliumEngine', `Dialogue turn error for ${p1.name}: ${msg}`);
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

      // Participant 2's turn
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
        p2Response = await this.client.generateContent(
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
        logger.error('ConsiliumEngine', `Dialogue turn error for ${p2.name}: ${msg}`);
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

    // Synthesize final dialogue outcome
    // ONLY-FREE policy: synthesis defaults to the reliable free meta-router.
    // Gemini is reserved for development — never a silent default.
    const synthModel = options.synthesizerModel || Config.defaultModel || 'openrouter/free';
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
      synthesis = await this.client.generateContent(
        synthModel,
        [{ role: 'user', content: synthPrompt }],
        {
          temperature: 0.2,
          systemInstruction: Config.defaultSystemInstruction,
          apiKey: options.apiKey,
          signal: options.signal,
        }
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('ConsiliumEngine', `Dialogue synthesis error: ${msg}`);
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

  /**
   * Mode 4: Consilium Mode (3 to 10 models discuss in rounds, then synthesizer produces consensus)
   */
  private async runConsilium(
    options: ConsiliumRunOptions,
    participants: ConsiliumParticipant[],
    kbContext: string,
    startTime: number,
    kbIncluded: boolean
  ): Promise<ConsiliumResult> {
    // Validate bounds: 3 to 10 participants
    const activeParticipants = this.validateConsiliumParticipants(participants);

    const totalRounds = Math.max(1, Math.min(options.rounds || 2, 4));
    const turns: ConsiliumTurn[] = [];
    const effectivePrompt = kbContext ? `${kbContext}\n\nConsilium Mandate / Technical Challenge: ${options.prompt}` : options.prompt;

    // Round 1: Independent vantage evaluations (concurrent)
    logger.info('ConsiliumEngine', `Consilium Round 1: ${activeParticipants.length} agents evaluating concurrently`);
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
        const content = await this.client.generateContent(
          p.model,
          [{ role: 'user', content: userMsg }],
          {
            temperature: p.temperature,
            systemInstruction: p.systemPrompt,
            apiKey: options.apiKey,
            signal: options.signal,
          }
        );

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
        logger.error('ConsiliumEngine', `Consilium Round 1 error for ${p.name}: ${msg}`);
        return this.createTurn(
          1,
          p,
          options.prompt,
          `[Perspective unavailable due to query error: ${msg}]`,
          Date.now() - turnStart
        );
      }
    });

    const round1Turns = await Promise.all(round1Promises);
    turns.push(...round1Turns);

    // Round 2 to K: Cross-deliberation & debate
    for (let r = 2; r <= totalRounds; r++) {
      logger.info('ConsiliumEngine', `Consilium Round ${r}: Cross-evaluation across ${activeParticipants.length} agents`);
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
          const content = await this.client.generateContent(
            p.model,
            [{ role: 'user', content: prompt }],
            {
              temperature: p.temperature,
              systemInstruction: p.systemPrompt,
              apiKey: options.apiKey,
              signal: options.signal,
            }
          );

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
          logger.error('ConsiliumEngine', `Consilium Round ${r} error for ${p.name}: ${msg}`);
          return this.createTurn(
            r,
            p,
            prompt,
            `[Deliberation note unavailable: ${msg}]`,
            Date.now() - turnStart
          );
        }
      });

      const currentRoundTurns = await Promise.all(roundPromises);
      turns.push(...currentRoundTurns);
    }

    // Final Stage: Synthesizer produces authoritative corporate consensus
    // ONLY-FREE policy: synthesis defaults to the reliable free meta-router.
    // Gemini is reserved for development — never a silent default.
    const synthModel = options.synthesizerModel || Config.defaultModel || 'openrouter/free';
    logger.info('ConsiliumEngine', `Synthesizing final consensus with ${synthModel}`);
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
      synthesis = await this.client.generateContent(
        synthModel,
        [{ role: 'user', content: synthesisPrompt }],
        {
          temperature: 0.2,
          systemInstruction: Config.defaultSystemInstruction,
          apiKey: options.apiKey,
          signal: options.signal,
        }
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('ConsiliumEngine', `Consilium synthesis error: ${msg}`);
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
    const promptTokens = ModelRegistry.estimateTokens(prompt);
    const completionTokens = ModelRegistry.estimateTokens(content);
    const cost = ModelRegistry.calculateCost(participant.model, promptTokens, completionTokens);

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
    costSummary: {
      totalPromptTokens: number;
      totalCompletionTokens: number;
      totalTokens: number;
      totalCostUSD: number;
      totalCostEUR: number;
      formattedUSD: string;
      formattedEUR: string;
      models: Array<{
        model: string;
        tokens: number;
        costUSD: number;
        costEUR: number;
        formattedUSD: string;
        formattedEUR: string;
      }>;
    };
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
      st.tokens += (p + c);
      st.costUSD += (t.cost?.costUSD || 0);
      st.costEUR += (t.cost?.costEUR || 0);
      modelStats.set(t.model, st);
    }

    if (synthesis && synthModel && synthesisPrompt) {
      const sp = ModelRegistry.estimateTokens(synthesisPrompt);
      const sc = ModelRegistry.estimateTokens(synthesis);
      const sCost = ModelRegistry.calculateCost(synthModel, sp, sc);
      totalPromptTokens += sp;
      totalCompletionTokens += sc;
      totalCostUSD += sCost.costUSD;
      totalCostEUR += sCost.costEUR;

      const st = modelStats.get(synthModel) || { tokens: 0, costUSD: 0, costEUR: 0 };
      st.tokens += (sp + sc);
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
}
