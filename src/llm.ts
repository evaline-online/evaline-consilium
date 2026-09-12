/**
 * LLM abstraction for evaline-consilium.
 *
 * The engine never talks to a concrete provider — hosts (evaline-chat,
 * evabot-backend) inject their own implementation (Gemini, OpenRouter,
 * OmniRoute daemons, mocks).
 */

import type { LlmProvider } from './types.ts';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmGenerationOptions {
  temperature?: number;
  maxOutputTokens?: number;
  systemInstruction?: string;
  provider?: LlmProvider;
  apiKey?: string;
  signal?: AbortSignal;
}

/** Minimal LLM client contract required by the ConsiliumEngine. */
export interface LlmClient {
  generateContent(
    model: string,
    messages: LlmMessage[] | string,
    options?: LlmGenerationOptions
  ): Promise<string>;
}

/**
 * Pseudo-LlmClient used when the host did not inject a real provider.
 * It emits a deterministic stub so the engine remains testable and never
 * crashes on a missing backend. Real deployments MUST pass a real client.
 */
export class StubLlmClient implements LlmClient {
  private readonly responder?: (model: string, prompt: string) => string;

  constructor(responder?: (model: string, prompt: string) => string) {
    this.responder = responder;
  }

  public async generateContent(
    model: string,
    messages: LlmMessage[] | string,
    options?: LlmGenerationOptions
  ): Promise<string> {
    const content = Array.isArray(messages)
      ? messages.map((m) => `${m.role}: ${m.content}`).join('\n')
      : messages;
    const temperature = options?.temperature ?? 0.5;
    if (this.responder) {
      return this.responder(model, content);
    }
    return (
      `[stub:${model}] Your-message: ${content.slice(0, 200)} ` +
      `(temperature=${temperature}). Configure an LlmClient to enable real generation.`
    );
  }
}