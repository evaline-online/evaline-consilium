/**
 * Token estimation & cost calculation contracts.
 *
 * The engine needs a deterministic estimate of tokens and a USD/EUR cost view.
 * Hosts may inject their own exact engines (e.g. wrapped around ModelRegistry).
 */

import type { TokenCostEstimate } from './types.ts';

export interface TokenEstimate {
  promptTokens: number;
  completionTokens: number;
}

export interface CostCalculator {
  estimateTokens(text: string): number;
  calculateCost(
    model: string,
    promptTokens: number,
    completionTokens: number
  ): TokenCostEstimate;
}

export interface PricingEngine {
  estimateTokens(text: string): number;
  calculateCost(
    model: string,
    promptTokens: number,
    completionTokens: number
  ): TokenCostEstimate;
}

/**
 * Deterministic heuristic token estimator (≈ 4 chars / token), mirroring the
 * behavior of the legacy engine. Cheap and stable — real billing should be
 * delegated to provider-specific tokenizers by the host.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

const FREE_TOKENS_PER_MODEL = 1000;

/**
 * Default cost engine: models are priced in USD/EUR per 1M tokens; free-tier
 * models report zero cost. Model names containing common free markers are
 * treated as 100% free quota.
 */
export class SimpleCostEngine implements PricingEngine {
  private readonly pricing: Map<string, { inputUSD: number; outputUSD: number }>;
  private readonly eurRate: number;

  constructor(
    pricingTable: Record<string, { inputUSD?: number; outputUSD?: number }> = DEFAULT_PRICING,
    eurRate: number = DEFAULT_EUR_RATE
  ) {
    this.eurRate = eurRate;
    this.pricing = new Map(
      Object.entries(pricingTable).map(([model, p]) => [
        model,
        {
          inputUSD: p.inputUSD ?? 0,
          outputUSD: p.outputUSD ?? 0,
        },
      ])
    );
  }

  public estimateTokens(text: string): number {
    return estimateTokens(text);
  }

  public calculateCost(
    model: string,
    promptTokens: number,
    completionTokens: number
  ): TokenCostEstimate {
    const entry = this.resolveEntry(model);
    const freeTier = entry === null || entry.inputUSD <= 0 && entry.outputUSD <= 0;

    if (freeTier || promptTokens <= FREE_TOKENS_PER_MODEL) {
      // Free-tier quota: no cost for the first 1k tokens.
      return {
        inputCost: 0,
        outputCost: 0,
        totalCost: 0,
        currency: 'USD',
        costUSD: 0,
        costEUR: 0,
      };
    }

    const inputUSD = (promptTokens / 1_000_000) * entry.inputUSD;
    const outputUSD = (completionTokens / 1_000_000) * entry.outputUSD;
    const totalUSD = inputUSD + outputUSD;
    return {
      inputCost: inputUSD,
      outputCost: outputUSD,
      totalCost: totalUSD,
      currency: 'USD',
      costUSD: totalUSD,
      costEUR: totalUSD * this.eurRate,
    };
  }

  private resolveEntry(model: string): {
    inputUSD: number;
    outputUSD: number;
  } | null {
    const exact = this.pricing.get(model);
    if (exact) return exact;

    const norm = model.toLowerCase();
    if (
      norm.includes('free') ||
      norm.includes('stub') ||
      norm.includes('localhost')
    ) {
      return null;
    }
    for (const [key, val] of this.pricing.entries()) {
      if (norm.includes(key.toLowerCase())) return val;
    }
    return null;
  }
}

// Per-1M-token USD prices (input/output) for common gen-2.5-era models.
// Free-tier markers stay at 0.
export const DEFAULT_PRICING: Record<
  string,
  { inputUSD: number; outputUSD: number }
> = {
  'gemini-2.5-flash': { inputUSD: 0.3, outputUSD: 2.5 },
  'gemini-2.5-pro': { inputUSD: 1.25, outputUSD: 10.0 },
  'gemini-2.0-flash': { inputUSD: 0.1, outputUSD: 0.4 },
  'gemini-1.5-flash': { inputUSD: 0.075, outputUSD: 0.3 },
  'gemini-3.8-flash': { inputUSD: 0.3, outputUSD: 2.5 },
  'gemini-3.1-pro': { inputUSD: 1.25, outputUSD: 10.0 },
  'openrouter/free': { inputUSD: 0, outputUSD: 0 },
  'omniroute/free': { inputUSD: 0, outputUSD: 0 },
};

export const DEFAULT_EUR_RATE = 0.92;

// Re-exported convenience alias
export const FreePricingEngine = SimpleCostEngine;