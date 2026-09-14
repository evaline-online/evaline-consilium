# Changelog

All notable changes to evaline-consilium will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Planned
- [ ] Additional deliberation modes beyond the current five
- [ ] Pluggable arbiter strategies for the consilium synthesis
- [ ] Streaming progress events across all modes
- [ ] Real tokenizer-backed `PricingEngine` out of the box

---

## [0.1.0] - 2026-09-02

### Added
- **Host-agnostic, dependency-injected multi-LLM deliberation engine** — standalone port of the backend `src/core/ConsiliumEngine.ts`, decoupled so any host (evaline-chat, evabot-backend, a CLI) can drive it without importing backend code.
- **Five deliberation modes**:
  - `solo` / `chat` — single model answer
  - `broadcast` — N concurrent independent answers, no synthesis
  - `dialogue` — 2 participants (proponent/challenger), rounds clamped [1,5] (default 2), turn history + arbiter synthesis
  - `interview` — single role (Eva / Adam / dual), structured interview response
  - `consilium` — 3–10 expert agents, per-agent stances → deliberation rounds (clamped [1,4], default 2) → Markdown Consensus Report
- **Dependency injection with deterministic stubs**: `LlmClient`, `RoleProvider`, `PricingEngine`, `KnowledgeSource`, `LocalePolicy` — every dependency optional, engine degrades to deterministic stubs and never crashes on a missing backend.
- **ConsiliumPlugin** — wraps an engine instance behind the shared Plugin contract; exposes `POST /api/consilium` plus `/consilium`, `/dialogue`, `/broadcast` chat commands.
- **Cost estimation per turn** (`estimateTokens` + `calculateCost`) rolled up into `costSummary`, reporting `$0.00 (100% Free Quota)` / `€0.00 (100% Free Quota)` for free-tier models.
- **Grounded synthesis prompt** with EvaLine's mandatory verification block (Chernomorsk plant, Bratislava hub, product portfolio, EVA vs rubber/PVC, UNIC/CE/MOH, diesel generators) — ported verbatim from the backend.
- **Zero runtime dependencies**, ESM-only, strict `tsc` build, own `node:test` suite run against the source files.
- **Model registry support**: `defaultModel`, `paidModels`, `freeModels` (e.g. `gemini-3.1-pro`, `gemini-3.8-flash`, `openrouter/free`).
- **Repository collateral**: `EVALINE_KNOWLEDGE.md`, `ROLES_AND_RULES.md`, `FREE_MODELS_REFERENCE.md`, `PAID_MODELS_REFERENCE.md`, `KANBAN.md`, backend engine, src, and tests.

---

**Format:** [Keep a Changelog](https://keepachangelog.com/)  
**Versioning:** [Semantic Versioning](https://semver.org/)  
**Status:** Active development