/**
 * evaline-consilium — public entrypoint.
 *
 * Re-exports the full public surface: types, LLM client contract, role
 * provider, pricing engine, knowledge source, the DI engine, the plugin
 * contract and the Consilium plugin.
 */

export * from './types.ts';
export * from './llm.ts';
export * from './roles.ts';
export * from './pricing.ts';
export * from './knowledge.ts';
export * from './engine.ts';
export * from './plugin-contract.ts';
export * from './plugin.ts';

export const CONSILIUM_VERSION = '0.1.0';