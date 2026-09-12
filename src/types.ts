/**
 * evaline-consilium — public type contracts.
 *
 * Types are self-contained (zero dependencies), so the engine can be consumed
 * by any host (evaline-chat, evabot-backend, standalone CLI) without coupling.
 */

export type ConsiliumMode =
  | 'chat'
  | 'dialog'
  | 'interview'
  | 'consilium'
  | 'solo'
  | 'broadcast'
  | 'dialogue';

export type PresetId = 'top10_paid' | 'top10_free';

/** Provider constants mirrored so hosts and mocks share a vocabulary. */
export type LlmProvider = 'google' | 'omniroute' | 'openrouter' | 'opencode';

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

export interface TokenCostEstimate {
  inputCost: number;
  outputCost: number;
  totalCost: number;
  currency: string;
  costUSD: number;
  costEUR: number;
}

export interface CostModelStat {
  model: string;
  tokens: number;
  costUSD: number;
  costEUR: number;
  formattedUSD: string;
  formattedEUR: string;
}

export interface CostSummary {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCostUSD: number;
  totalCostEUR: number;
  formattedUSD: string;
  formattedEUR: string;
  models: CostModelStat[];
}

export interface ConsiliumProgressEvent {
  type:
    | 'turn_start'
    | 'turn_complete'
    | 'round_complete'
    | 'synthesis_start'
    | 'synthesis_complete'
    | 'error';
  round?: number;
  participantId?: string;
  turn?: ConsiliumTurn;
  message?: string;
}

export interface ConsiliumRunOptions {
  mode: ConsiliumMode;
  persona?: 'eva' | 'adam' | 'dual';
  prompt: string;
  models?: string[];
  participants?: ConsiliumParticipant[];
  rounds?: number;
  preset?: PresetId;
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
  costSummary?: CostSummary;
}