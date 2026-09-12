# evaline-consilium

EvaLine Agent Consilium — a **host-agnostic, dependency-injected** multi-LLM
deliberation engine with five modes: **solo**, **broadcast**, **dialogue**,
**interview** and **consilium** (3–10 expert agents reaching a synthesized
consensus). It is a standalone port of the backend
`src/core/ConsiliumEngine.ts`, decoupled so any host (evaline-chat,
evabot-backend, a CLI) can drive it without importing backend code.

Strict TypeScript, ESM-only, zero runtime dependencies. Builds with `tsc`
(strict) and runs its own `node:test` suite against the source files.

## Architecture

```
                    ┌──────────────────────────────┐
     host request ─▶│ ConsiliumEngine (src/engine)  │
                    │   mode dispatcher             │
                    └───────┬────────┬────────┬─────┘
                            │        │        │
              ┌─────────────▼──┐  ┌──▼──────────────┐  ┌───────────────▼─────┐
              │ LlmClient      │  │ RoleProvider    │  │ PricingEngine       │
              │ deps.llm       │  │ deps.roles      │  │ deps.pricing        │
              │ (generateContent)│  │ get/all/keys   │  │ estimateTokens      │
              │  default: Stub │  │ default: Static │  │ calculateCost       │
              └────────────────┘  └─────────────────┘  │  default: Simple    │
                                                        └───────────────┬─────┘
              ┌──────────────┐  ┌──────────────────┐                     │
              │ KnowledgeSource │  │ localePolicy     │     ┌─────────────▼────┐
              │ deps.knowledge  │  │ deps.localePolicy│     │ ConsiliumTurn   │
              │ search+format  │  │ persona: eva/adam│     │ token + cost    │
              │  default: Empty│  │  default: id     │     └──────────────────┘
              └──────────────┘  └──────────────────┘

ConsiliumPlugin (src/plugin) wraps an engine instance behind the shared
Plugin contract and exposes POST /api/consilium plus /consilium, /dialogue,
/broadcast chat commands.
```

Every dependency is optional; the engine degrades to deterministic stubs so it
never crashes on a missing backend. Real deployments inject a real `LlmClient`
(e.g. Gemini / OpenRouter / OmniRoute) and optionally a `PricingEngine` backed
by the real tokenizer.

## Install

```bash
npm install evaline-consilium   # or: npm link from a monorepo
npm run build                   # tsc → dist/
npm test                        # node --experimental-strip-types --test
```

## Quick usage

### Engine (direct DI)

```ts
import { ConsiliumEngine, StubLlmClient } from 'evaline-consilium';

const engine = new ConsiliumEngine({
  llm: new StubLlmClient(), // inject your real LlmClient in production
  defaultModel: 'openrouter/free',
  paidModels: ['gemini-3.1-pro', 'gemini-3.8-flash'],
  freeModels: ['openrouter/free'],
  logger: { info: (c, m) => console.log(c, m) },
});

const result = await engine.run({
  mode: 'consilium',
  prompt: 'Design the 2026 EvaLine platform roadmap',
  models: ['gemini-3.1-pro', 'gemini-3.8-flash', 'openrouter/free'],
  rounds: 2,
  useKnowledgeBase: true,
  onProgress: (e) => console.log(e.type, e.message ?? e.participantId),
});

console.log(result.synthesis, result.costSummary?.formattedUSD);
```

### Plugin (host integration)

```ts
import { ConsiliumPlugin } from 'evaline-consilium';

const plugin = new ConsiliumPlugin({ llm: myLlmClient });

await plugin.initialize({
  config: {},
  logger: console,
  eventBus: myEventBus,
  registerRoute: (method, path, handler) => app.use(path, handler),
  registerCommand: (cmd, handler, help) => bot.onText(cmd, handler),
  getStorage: () => null,
});

// plugin.routes    → [{ method: 'POST', path: '/api/consilium', handler }]
// plugin.commands  → [{ cmd: '/consilium', handler, help }, ...]
const { success, result } = await plugin.routes[0].handler({ mode: 'solo', prompt: 'hi' });
const reply = await plugin.commands[0].handler('consilium design the platform');
await plugin.shutdown();
```

## Modes

| Mode        | Participants        | Rounds   | Output                                        |
| ----------- | ------------------- | -------- | --------------------------------------------- |
| `solo`/`chat` | 1                | 1        | Single model answer                           |
| `broadcast` | N (concurrent)      | 1        | Independent answers, no synthesis             |
| `dialogue`  | 2 (proponent/challenger) | clamp [1,5], default 2 | Turn history + arbiter synthesis |
| `interview` | 1 (Eva / Adam / dual) | 1      | Structured interview response                 |
| `consilium` | 3–10                | clamp [1,4], default 2 | Per-agent stances → deliberation rounds → Markdown Consensus Report |

Costs are estimated per turn (`estimateTokens` + `calculateCost`) and rolled up
into `costSummary` with `$0.00 (100% Free Quota)` / `€0.00 (100% Free Quota)`
when the model is free-tier.

## Notes

- The package ships ESM `.ts` sources; run tests/build with Node ≥ 22
  (`--experimental-strip-types`) or `tsc`. The build emits `.js` to `dist/`
  with standard `package.json` `exports` for consumption.
- The consilium `synthesisPrompt` includes EvaLine's mandatory grounded
  verification block (Chernomorsk plant, Bratislava hub, product portfolio,
  EVA vs rubber/PVC, UNIC/CE/MOH, diesel generators) — ported verbatim from
  the backend.

## License

UNLICENSED — proprietary. © EvaLine. All rights reserved.