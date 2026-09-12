"""ConsiliumEngine — Python port of `src/core/ConsiliumEngine.ts`.

Supports modes: chat/solo, broadcast, dialog/dialogue, interview, consilium.
Uses UniversalLlmClient for LLM calls, ModelRegistry for cost accounting,
CorporateRoles + KnowledgeBaseConnector for role/knowledge injection, and
apply_locale_policy for policy compliance.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any, Callable

from .config import settings
from .corporate_roles import CORPORATE_ROLES, CorporateRole, KnowledgeBaseConnector
from .llm_client import UniversalLlmClient
from .locale_policy import apply_locale_policy
from .logger import logger
from .model_registry import ModelRegistry

CONSILIUM_MODES = frozenset({"chat", "dialog", "interview", "consilium", "solo", "broadcast", "dialogue"})
PERSONA_IDS = frozenset({"eva", "adam", "dual"})


class ConsiliumTurn:
    def __init__(self, **kwargs: Any) -> None:
        self.round = kwargs["round"]
        self.participant_id = kwargs["participantId"]
        self.name = kwargs["name"]
        self.model = kwargs["model"]
        self.role = kwargs.get("role")
        self.content = kwargs["content"]
        self.timestamp = kwargs["timestamp"]
        self.duration_ms = kwargs["durationMs"]
        self.prompt_tokens = kwargs.get("promptTokens")
        self.completion_tokens = kwargs.get("completionTokens")
        self.total_tokens = kwargs.get("totalTokens")
        self.cost = kwargs.get("cost")

    def to_dict(self) -> dict[str, Any]:
        return {
            "round": self.round,
            "participantId": self.participant_id,
            "name": self.name,
            "model": self.model,
            "role": self.role,
            "content": self.content,
            "timestamp": self.timestamp,
            "durationMs": self.duration_ms,
            "promptTokens": self.prompt_tokens,
            "completionTokens": self.completion_tokens,
            "totalTokens": self.total_tokens,
            "cost": self.cost,
        }


class ConsiliumEngine:
    def __init__(self, api_key: str | None = None) -> None:
        self.client = UniversalLlmClient(api_key)
        self.kb_connector = KnowledgeBaseConnector()

    # ------------------------------------------------------------------
    # Main entrypoint
    # ------------------------------------------------------------------
    async def run(self, options: dict[str, Any]) -> dict[str, Any]:
        start_time = time.monotonic()
        mode = options.get("mode", "chat")
        rounds = int(options.get("rounds") or 1)
        logger.info("ConsiliumEngine", f"Starting execution: mode={mode}, rounds={rounds}")

        kb_context = ""
        kb_included = False
        if options.get("useKnowledgeBase"):
            try:
                docs = await self.kb_connector.search(options.get("prompt", ""), {"limit": 3})
                if docs:
                    kb_context = self.kb_connector.format_context_for_prompt(docs)
                    kb_included = True
                    logger.info("ConsiliumEngine", f"Injected {len(docs)} hybrid DB knowledge documents into context")
            except Exception as exc:  # noqa: BLE001
                logger.warn("ConsiliumEngine", f"Failed retrieving knowledge base: {exc}")

        participants = self.resolve_participants(options)

        on_progress = options.get("onProgress")

        if mode in ("chat", "solo"):
            result = await self.run_solo(options, participants, kb_context, start_time, kb_included, on_progress)
        elif mode == "broadcast":
            result = await self.run_broadcast(options, participants, kb_context, start_time, kb_included, on_progress)
        elif mode in ("dialog", "dialogue"):
            result = await self.run_dialogue(options, participants, kb_context, start_time, kb_included, on_progress)
        elif mode == "interview":
            result = await self.run_interview(options, participants, kb_context, start_time, kb_included, on_progress)
        elif mode == "consilium":
            result = await self.run_consilium(options, participants, kb_context, start_time, kb_included, on_progress)
        else:
            raise ValueError(f"Unsupported Consilium mode: {mode}")

        return result

    # ------------------------------------------------------------------
    # Participant resolution & validation
    # ------------------------------------------------------------------
    def resolve_participants(self, options: dict[str, Any]) -> list[dict[str, Any]]:
        provided = options.get("participants")
        if provided:
            enriched: list[dict[str, Any]] = []
            for idx, p in enumerate(provided):
                role_id = p.get("roleId")
                role = CORPORATE_ROLES.get(role_id) if role_id else None
                c_role: CorporateRole | None = role
                system_prompt = p.get("systemPrompt") or (
                    c_role.system_prompt if c_role else None
                ) or settings.default_system_instruction
                enriched.append(
                    {
                        "id": p.get("id") or f"participant-{idx + 1}",
                        "model": p.get("model") or settings.default_model,
                        "roleId": role_id,
                        "name": p.get("name") or (c_role.name if c_role else None) or f"Agent {idx + 1}",
                        "title": p.get("title") or (c_role.title if c_role else None) or "Specialist",
                        "systemPrompt": apply_locale_policy(system_prompt),
                        "temperature": float(p.get("temperature") if p.get("temperature") is not None else (
                            c_role.suggested_temperature if c_role else None
                        ) or 0.5),
                        "provider": p.get("provider"),
                    }
                )
            return enriched

        preset = options.get("preset")
        models_opt = options.get("models")
        if preset == "top10_paid":
            model_list = [m["id"] for m in ModelRegistry.get_top10_paid_smartest_models()]
        elif preset == "top10_free":
            model_list = [m["id"] for m in ModelRegistry.get_top10_free_models()]
        elif models_opt:
            model_list = list(models_opt)
        else:
            model_list = [settings.default_model]

        role_keys = list(CORPORATE_ROLES.keys())
        resolved: list[dict[str, Any]] = []
        for idx, model in enumerate(model_list):
            role_key = role_keys[idx % len(role_keys)]
            role = CORPORATE_ROLES[role_key]
            resolved.append(
                {
                    "id": f"agent-{idx + 1}-{role.id}",
                    "model": model,
                    "roleId": role.id,
                    "name": role.name,
                    "title": role.title,
                    "systemPrompt": apply_locale_policy(role.system_prompt),
                    "temperature": role.suggested_temperature,
                }
            )
        return resolved

    def validate_consilium_participants(self, participants: list[dict[str, Any]]) -> list[dict[str, Any]]:
        active = list(participants)
        if len(active) < 3:
            extra_roles = ["architect", "devops", "security_auditor"]
            while len(active) < 3:
                role = CORPORATE_ROLES[extra_roles[len(active) % len(extra_roles)]]
                active.append(
                    {
                        "id": f"consilium-agent-{len(active) + 1}",
                        "model": role.preferred_model,
                        "roleId": role.id,
                        "name": role.name,
                        "title": role.title,
                        "systemPrompt": apply_locale_policy(role.system_prompt),
                        "temperature": role.suggested_temperature,
                    }
                )
        elif len(active) > 10:
            active = active[:10]
        return active

    # ------------------------------------------------------------------
    # Mode: Solo / Chat
    # ------------------------------------------------------------------
    async def run_solo(
        self,
        options: dict[str, Any],
        participants: list[dict[str, Any]],
        kb_context: str,
        start_time: float,
        kb_included: bool,
        on_progress: Callable[[dict[str, Any]], None] | None = None,
    ) -> dict[str, Any]:
        if participants:
            participant = participants[0]
        else:
            participant = {
                "id": "solo-agent",
                "model": settings.default_model,
                "name": "EvaBot Solo Agent",
                "title": "AI Specialist",
                "systemPrompt": apply_locale_policy(settings.default_system_instruction),
                "temperature": 0.7,
            }

        self._emit(on_progress, {
            "type": "turn_start",
            "round": 1,
            "participantId": participant["id"],
            "message": f"{participant['name']} is formulating response...",
        })

        turn_start = time.monotonic()
        effective_prompt = f"{kb_context}\n\nUser Request: {options['prompt']}" if kb_context else options["prompt"]

        response = await self._safe_generate(
            participant, [{"role": "user", "content": effective_prompt}], options, participant_key="solo"
        )

        turn = self.create_turn(1, participant, effective_prompt, response, (time.monotonic() - turn_start) * 1000)

        self._emit(on_progress, {"type": "turn_complete", "round": 1, "participantId": participant["id"], "turn": turn})

        summary = self.calculate_cost_summary([turn])
        return {
            "mode": "chat" if options.get("mode") == "chat" else "solo",
            "prompt": options["prompt"],
            "participants": [participant],
            "turns": [turn],
            "totalRounds": 1,
            "durationMs": round((time.monotonic() - start_time) * 1000),
            "knowledgeBaseContextIncluded": kb_included,
            **summary,
        }

    # ------------------------------------------------------------------
    # Mode: Interview
    # ------------------------------------------------------------------
    async def run_interview(
        self,
        options: dict[str, Any],
        participants: list[dict[str, Any]],
        kb_context: str,
        start_time: float,
        kb_included: bool,
        on_progress: Callable[[dict[str, Any]], None] | None = None,
    ) -> dict[str, Any]:
        persona = options.get("persona") or "eva"
        interviewer = participants[0] if participants else None

        if persona == "eva":
            base_model = interviewer.get("model") if interviewer else "gemini-2.5-flash"
            interviewer = {
                "id": "eva-interviewer",
                "model": base_model,
                "name": "Eva (Frontend & Strategic Interviewer)",
                "title": "Lead Frontend Architect & UX Director",
                "systemPrompt": apply_locale_policy(
                    "You are Eva, conducting a professional Frontend, UX, and Strategic Architecture interview for EvaLine "
                    "(Headquarters and manufacturing in Chernomorsk, Ukraine, EU Hub in Bratislava, Slovakia). Evaluate the candidate response with constructive depth. "
                    "Format your reply in three clean sections:\n"
                    "1. 💡 Feedback & Assessment: Strengths and gaps observed in candidate answer.\n"
                    "2. 🎯 Score: Candidate competence rating (e.g. 85/100 or Seniority Level).\n"
                    "3. ❓ Next Question / Scenario: Present the next targeted question or architectural trade-off challenge."
                ),
                "temperature": 0.4,
            }
        elif persona == "adam":
            base_model = interviewer.get("model") if interviewer else "gemini-2.5-pro"
            interviewer = {
                "id": "adam-interviewer",
                "model": base_model,
                "name": "Adam (Backend & Systems Interviewer)",
                "title": "Chief Backend Architect & Core Systems Lead",
                "systemPrompt": apply_locale_policy(
                    "You are Adam, conducting an advanced Backend, Cloud Infrastructure, and Distributed Systems interview "
                    "for EvaLine (Headquarters and manufacturing in Chernomorsk, Ukraine, EU Hub in Bratislava, Slovakia). Evaluate the candidate with technical rigor and zero tolerance "
                    "for sloppy architecture. Format your reply in three clean sections:\n"
                    "1. 💡 Technical Critique: Algorithmic efficiency, scalability, and security posture.\n"
                    "2. 🎯 Score: Technical rigor score (e.g. 90/100 or Staff Engineer Level).\n"
                    "3. ❓ Next System Challenge: Present the next low-latency or high-throughput distributed system scenario."
                ),
                "temperature": 0.3,
            }
        else:  # dual
            base_model = interviewer.get("model") if interviewer else "gemini-2.5-pro"
            interviewer = {
                "id": "dual-interviewers",
                "model": base_model,
                "name": "Eva & Adam (Dual Co-Pilot Interview Board)",
                "title": "Full-Stack Technical Interview Board",
                "systemPrompt": apply_locale_policy(
                    "You are Eva (Lead Frontend Architect) and Adam (Chief Backend Architect), conducting a dual co-pilot "
                    "technical interview for EvaLine (Headquarters and manufacturing in Chernomorsk, Ukraine, EU Hub in Bratislava, Slovakia). Both evaluate the candidate from your "
                    "respective specialties:\n"
                    "[Eva ♀]: Assess frontend ergonomics, API consumption, usability, and strategic clarity.\n"
                    "[Adam ♂]: Assess backend architecture, database latency, security, and algorithmic performance.\n"
                    "Conclude with the next joint full-stack architectural challenge."
                ),
                "temperature": 0.4,
            }

        effective_prompt = (
            f"{kb_context}\n\nCandidate Input / Topic: {options['prompt']}"
            if kb_context
            else f"Candidate Input / Topic: {options['prompt']}"
        )

        self._emit(on_progress, {
            "type": "turn_start",
            "round": 1,
            "participantId": interviewer["id"],
            "message": f"{interviewer['name']} is evaluating response and drafting next question...",
        })

        turn_start = time.monotonic()
        response = await self._safe_generate(
            interviewer, [{"role": "user", "content": effective_prompt}], options, participant_key="interview"
        )
        turn = self.create_turn(1, interviewer, effective_prompt, response, (time.monotonic() - turn_start) * 1000)

        self._emit(on_progress, {"type": "turn_complete", "round": 1, "participantId": interviewer["id"], "turn": turn})

        summary = self.calculate_cost_summary([turn])
        return {
            "mode": "interview",
            "prompt": options["prompt"],
            "participants": [interviewer],
            "turns": [turn],
            "totalRounds": 1,
            "durationMs": round((time.monotonic() - start_time) * 1000),
            "knowledgeBaseContextIncluded": kb_included,
            **summary,
        }

    # ------------------------------------------------------------------
    # Mode: Broadcast
    # ------------------------------------------------------------------
    async def run_broadcast(
        self,
        options: dict[str, Any],
        participants: list[dict[str, Any]],
        kb_context: str,
        start_time: float,
        kb_included: bool,
        on_progress: Callable[[dict[str, Any]], None] | None = None,
    ) -> dict[str, Any]:
        effective_prompt = f"{kb_context}\n\nUser Request: {options['prompt']}" if kb_context else options["prompt"]

        self._emit(on_progress, {
            "type": "round_complete",
            "round": 1,
            "message": f"Broadcasting prompt concurrently to {len(participants)} models...",
        })

        turns: list[dict[str, Any]] = []
        for p in participants:
            turn_start = time.monotonic()
            self._emit(on_progress, {
                "type": "turn_start",
                "round": 1,
                "participantId": p["id"],
                "message": f"{p['name']} ({p['model']}) is processing broadcast request...",
            })
            content = await self._safe_generate(
                p, [{"role": "user", "content": effective_prompt}], options, participant_key=f"broadcast-{p['id']}"
            )
            turn = self.create_turn(1, p, effective_prompt, content, (time.monotonic() - turn_start) * 1000)
            self._emit(on_progress, {"type": "turn_complete", "round": 1, "participantId": p["id"], "turn": turn})
            turns.append(turn)

        summary = self.calculate_cost_summary(turns)
        return {
            "mode": "broadcast",
            "prompt": options["prompt"],
            "participants": participants,
            "turns": turns,
            "totalRounds": 1,
            "durationMs": round((time.monotonic() - start_time) * 1000),
            "knowledgeBaseContextIncluded": kb_included,
            **summary,
        }

    # ------------------------------------------------------------------
    # Mode: Dialogue (dual-model debate over K rounds)
    # ------------------------------------------------------------------
    async def run_dialogue(
        self,
        options: dict[str, Any],
        participants: list[dict[str, Any]],
        kb_context: str,
        start_time: float,
        kb_included: bool,
        on_progress: Callable[[dict[str, Any]], None] | None = None,
    ) -> dict[str, Any]:
        arch = CORPORATE_ROLES["architect"]
        sec = CORPORATE_ROLES["security_auditor"]
        p1 = participants[0] if participants else {
            "id": "agent-1",
            "model": "gemini-3.1-pro",
            "name": "Lead Proponent",
            "title": "Lead Architect",
            "systemPrompt": apply_locale_policy(arch.system_prompt),
            "temperature": 0.4,
        }
        p2 = participants[1] if len(participants) > 1 else {
            "id": "agent-2",
            "model": "gemini-3.8-flash",
            "name": "Lead Challenger",
            "title": "Principal Security & Risk Auditor",
            "systemPrompt": apply_locale_policy(sec.system_prompt),
            "temperature": 0.4,
        }

        total_rounds = max(1, min(int(options.get("rounds") or 2), 5))
        turns: list[dict[str, Any]] = []
        dialogue_history: list[dict[str, str]] = []

        effective_prompt = (
            f"{kb_context}\n\nTopic for Technical Deliberation: {options['prompt']}" if kb_context else options["prompt"]
        )
        dialogue_history.append({"role": "user", "content": effective_prompt})

        for rnd in range(1, total_rounds + 1):
            # Participant 1 (Proponent)
            t1_start = time.monotonic()
            self._emit(on_progress, {
                "type": "turn_start",
                "round": rnd,
                "participantId": p1["id"],
                "message": f"Round {rnd}/{total_rounds}: {p1['name']} is presenting arguments...",
            })
            p1_prompt = (
                effective_prompt
                if rnd == 1
                else (
                    f"Round {rnd} Counter-Argument: Review the previous reply and defend or refine your architectural stance:\n\n"
                    f"{dialogue_history[-1]['content']}"
                )
            )
            p1_extra = (
                f"\nYou are participating in a bilateral technical dialogue with {p2['name']} ({p2['title']}). "
                f"Maintain intellectual rigor, focus on concrete trade-offs, and defend your positions with evidence."
            )
            p1_response = await self._safe_generate(
                p1, [*dialogue_history, {"role": "user", "content": p1_prompt}], options,
                participant_key=f"dialogue-{p1['id']}", system_extra=p1_extra,
            )
            turn1 = self.create_turn(rnd, p1, p1_prompt, p1_response, (time.monotonic() - t1_start) * 1000)
            turns.append(turn1)
            dialogue_history.append({"role": "assistant", "content": f"[{p1['name']}]: {p1_response}"})
            self._emit(on_progress, {"type": "turn_complete", "round": rnd, "participantId": p1["id"], "turn": turn1})

            # Participant 2 (Challenger)
            t2_start = time.monotonic()
            self._emit(on_progress, {
                "type": "turn_start",
                "round": rnd,
                "participantId": p2["id"],
                "message": f"Round {rnd}/{total_rounds}: {p2['name']} is responding and critiquing...",
            })
            p2_prompt = (
                f"Round {rnd} Critique: Directly address the arguments posed by {p1['name']} above. "
                f"Point out vulnerabilities, edge cases, cost implications in USD/EUR, and suggest counter-proposals:\n\n{p1_response}"
            )
            p2_extra = (
                f"\nYou are participating in a bilateral technical dialogue with {p1['name']} ({p1['title']}). "
                f"Critically analyze their statements, probe for weak spots, and propose resilient solutions."
            )
            p2_response = await self._safe_generate(
                p2, [*dialogue_history, {"role": "user", "content": p2_prompt}], options,
                participant_key=f"dialogue-{p2['id']}", system_extra=p2_extra,
            )
            turn2 = self.create_turn(rnd, p2, p2_prompt, p2_response, (time.monotonic() - t2_start) * 1000)
            turns.append(turn2)
            dialogue_history.append({"role": "assistant", "content": f"[{p2['name']}]: {p2_response}"})
            self._emit(on_progress, {"type": "turn_complete", "round": rnd, "participantId": p2["id"], "turn": turn2})

        # Synthesis
        synth_model = options.get("synthesizerModel") or "gemini-3.8-flash"
        self._emit(on_progress, {"type": "synthesis_start", "message": f"Synthesizing final dialogue conclusion with {synth_model}..."})

        synth_prompt = (
            f"You are the Senior Technical Arbiter. Synthesize the debate between {p1['name']} and {p2['name']} "
            f'on the topic:\n"{options["prompt"]}"\n\nDeliberation Transcript:\n'
            + "\n\n".join(
                f"### Round {t['round']} - {t['name']} ({t['role']}):\n{t['content']}" for t in turns
            )
            + "\n\nProduce an authoritative Executive Synthesis with:\n"
            + "1. Core Points of Consensus\n"
            + "2. Unresolved Trade-Offs & Edge Cases\n"
            + "3. Definitive Actionable Recommendation (with cost impact in USD ($) or EUR (\u20ac))."
        )

        synthesis = await self._safe_generate(
            {"model": synth_model, "temperature": 0.2, "systemPrompt": settings.default_system_instruction},
            [{"role": "user", "content": synth_prompt}],
            options,
            participant_key="dialogue-synthesis",
        )
        self._emit(on_progress, {"type": "synthesis_complete", "message": "Dialogue synthesis completed."})

        summary = self.calculate_cost_summary(turns, synthesis, synth_model, synth_prompt)
        return {
            "mode": "dialogue",
            "prompt": options["prompt"],
            "participants": [p1, p2],
            "turns": turns,
            "synthesis": synthesis,
            "totalRounds": total_rounds,
            "durationMs": round((time.monotonic() - start_time) * 1000),
            "knowledgeBaseContextIncluded": kb_included,
            **summary,
        }

    # ------------------------------------------------------------------
    # Mode: Consilium (3-10 agents, multi-round, synthesized consensus)
    # ------------------------------------------------------------------
    async def run_consilium(
        self,
        options: dict[str, Any],
        participants: list[dict[str, Any]],
        kb_context: str,
        start_time: float,
        kb_included: bool,
        on_progress: Callable[[dict[str, Any]], None] | None = None,
    ) -> dict[str, Any]:
        active_participants = self.validate_consilium_participants(participants)
        total_rounds = max(1, min(int(options.get("rounds") or 2), 4))
        turns: list[dict[str, Any]] = []
        effective_prompt = (
            f"{kb_context}\n\nConsilium Mandate / Technical Challenge: {options['prompt']}" if kb_context else options["prompt"]
        )

        # Round 1: concurrent independent evaluations
        logger.info("ConsiliumEngine", f"Consilium Round 1: {len(active_participants)} agents evaluating concurrently")
        self._emit(on_progress, {
            "type": "round_complete",
            "round": 1,
            "message": f"Consilium Round 1: {len(active_participants)} agents providing independent expert perspectives...",
        })

        round1_turns: list[dict[str, Any]] = []
        for p in active_participants:
            turn_start = time.monotonic()
            self._emit(on_progress, {
                "type": "turn_start",
                "round": 1,
                "participantId": p["id"],
                "message": f"{p['name']} ({p['title']}) is drafting Round 1 stance...",
            })
            user_msg = (
                f'Please analyze the following challenge from your specific professional perspective as {p["title"]}:\n\n'
                f'"{effective_prompt}"\n\nState your primary recommendations, essential prerequisites, and critical risks.'
            )
            content = await self._safe_generate(
                p, [{"role": "user", "content": user_msg}], options, participant_key=f"consilium-r1-{p['id']}"
            )
            turn = self.create_turn(1, p, options["prompt"], content, (time.monotonic() - turn_start) * 1000)
            self._emit(on_progress, {"type": "turn_complete", "round": 1, "participantId": p["id"], "turn": turn})
            round1_turns.append(turn)
        turns.extend(round1_turns)

        # Rounds 2..K: cross-deliberation
        for rnd in range(2, total_rounds + 1):
            logger.info("ConsiliumEngine", f"Consilium Round {rnd}: Cross-evaluation across {len(active_participants)} agents")
            self._emit(on_progress, {
                "type": "round_complete",
                "round": rnd,
                "message": f"Consilium Round {rnd}: Deliberating on peers' statements and refining alignment...",
            })
            peer_summary = "\n\n---\n\n".join(
                f"[{t['name']} - {t['role']}]:\n{t['content']}" for t in turns if t["round"] == rnd - 1
            )
            for p in active_participants:
                turn_start = time.monotonic()
                self._emit(on_progress, {
                    "type": "turn_start",
                    "round": rnd,
                    "participantId": p["id"],
                    "message": f"{p['name']} is evaluating peers' input in Round {rnd}...",
                })
                prompt_text = (
                    f"You are participating in Round {rnd} of the EvaLine Technical Consilium.\n"
                    f'Original Mandate: "{options["prompt"]}"\n\n'
                    f"Below are the stances delivered by your colleagues in the previous round:\n\n{peer_summary}\n\n"
                    f"Critique, support, or refine these viewpoints from your vantage as {p['title']}. "
                    f"Highlight consensus or irreconcilable trade-offs."
                )
                content = await self._safe_generate(
                    p, [{"role": "user", "content": prompt_text}], options, participant_key=f"consilium-r{rnd}-{p['id']}"
                )
                turn = self.create_turn(rnd, p, prompt_text, content, (time.monotonic() - turn_start) * 1000)
                self._emit(on_progress, {"type": "turn_complete", "round": rnd, "participantId": p["id"], "turn": turn})
                turns.append(turn)

        # Final synthesis
        synth_model = options.get("synthesizerModel") or "gemini-3.8-flash"
        logger.info("ConsiliumEngine", f"Synthesizing final consensus with {synth_model}")
        self._emit(on_progress, {
            "type": "synthesis_start",
            "message": f"Consilium deliberation concluded. Synthesizing consensus document with {synth_model}...",
        })

        full_transcript = "\n\n".join(
            f"### Round {t['round']} \u2014 {t['name']} ({t['role']} / {t['model']}):\n{t['content']}" for t in turns
        )
        synthesis_prompt = (
            f"You are the EvaLine Supreme Technical Council Synthesizer.\n"
            f"Your role is to formulate the definitive, binding consensus from a {len(active_participants)}-agent expert consilium.\n\n"
            f'Original Mandate:\n"{options["prompt"]}"\n\n'
            f"Consilium Transcript:\n{full_transcript}\n\n"
            f"Formulate a comprehensive, structured Consilium Consensus Report strictly in Markdown:\n"
            f"## 1. Executive Summary & Final Verdict\n"
            f"## 2. Unanimous Consensus & Strategic Alignment\n"
            f"## 3. Disputed Decisions, Risk Analysis & Trade-Offs\n"
            f"## 4. Implementation Roadmap & Technical Milestones\n"
            f"## 5. Budgetary & Infrastructure Impact (strictly in USD ($) and EUR (\u20ac))\n"
        )
        synthesis = await self._safe_generate(
            {"model": synth_model, "temperature": 0.2, "systemPrompt": settings.default_system_instruction},
            [{"role": "user", "content": synthesis_prompt}],
            options,
            participant_key="consilium-synthesis",
        )
        self._emit(on_progress, {"type": "synthesis_complete", "message": "Consilium Consensus Report successfully generated."})

        summary = self.calculate_cost_summary(turns, synthesis, synth_model, synthesis_prompt)
        return {
            "mode": "consilium",
            "prompt": options["prompt"],
            "participants": active_participants,
            "turns": turns,
            "synthesis": synthesis,
            "totalRounds": total_rounds,
            "durationMs": round((time.monotonic() - start_time) * 1000),
            "knowledgeBaseContextIncluded": kb_included,
            **summary,
        }

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    @staticmethod
    def _emit(on_progress: Callable[[dict[str, Any]], None] | None, event: dict[str, Any]) -> None:
        if on_progress:
            try:
                on_progress(event)
            except Exception:  # noqa: BLE001
                pass

    async def _safe_generate(
        self,
        participant: dict[str, Any],
        messages: list[dict[str, str]],
        options: dict[str, Any],
        participant_key: str,
        system_extra: str = "",
    ) -> str:
        system_prompt = participant.get("systemPrompt") or settings.default_system_instruction
        if system_extra:
            system_prompt = f"{system_prompt}{system_extra}"
        try:
            return await self.client.generate_content(
                participant["model"],
                messages,
                temperature=participant.get("temperature"),
                system_instruction=system_prompt,
                api_key=options.get("apiKey"),
            )
        except Exception as exc:  # noqa: BLE001
            enc = participant_key or participant.get("id", "unknown")
            logger.error("ConsiliumEngine", f"Error querying model {participant['model']} ({enc}): {exc}")
            return f"[Error querying model {participant['model']}: {exc}]"

    def create_turn(
        self, rnd: int, participant: dict[str, Any], prompt: str, content: str, duration_ms: float
    ) -> dict[str, Any]:
        prompt_tokens = ModelRegistry.estimate_tokens(prompt)
        completion_tokens = ModelRegistry.estimate_tokens(content)
        cost = ModelRegistry.calculate_cost(participant["model"], prompt_tokens, completion_tokens)
        return {
            "round": rnd,
            "participantId": participant.get("id", participant.get("name", "agent")),
            "name": participant.get("name") or participant.get("id", "Agent"),
            "model": participant["model"],
            "role": participant.get("title"),
            "content": content,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "durationMs": round(duration_ms),
            "promptTokens": prompt_tokens,
            "completionTokens": completion_tokens,
            "totalTokens": prompt_tokens + completion_tokens,
            "cost": cost,
        }

    @staticmethod
    def _fmt_token_cost(value: float, symbol: str) -> str:
        return f"{symbol}0.00 (100% Free Quota)" if value == 0 else f"{symbol}{value:.4f}"

    def calculate_cost_summary(
        self,
        turns: list[dict[str, Any]],
        synthesis: str | None = None,
        synth_model: str | None = None,
        synthesis_prompt: str | None = None,
    ) -> dict[str, Any]:
        total_prompt_tokens = 0
        total_completion_tokens = 0
        total_cost_usd = 0.0
        total_cost_eur = 0.0
        model_stats: dict[str, dict[str, float]] = {}

        for t in turns:
            p = t.get("promptTokens") or 0
            c = t.get("completionTokens") or 0
            total_prompt_tokens += p
            total_completion_tokens += c
            cost = t.get("cost")
            if cost:
                total_cost_usd += cost.get("costUSD", 0)
                total_cost_eur += cost.get("costEUR", 0)
            stat = model_stats.setdefault(
                t["model"], {"tokens": 0.0, "costUSD": 0.0, "costEUR": 0.0}
            )
            stat["tokens"] += p + c
            stat["costUSD"] += cost.get("costUSD", 0) if cost else 0
            stat["costEUR"] += cost.get("costEUR", 0) if cost else 0

        if synthesis and synth_model and synthesis_prompt:
            sp = ModelRegistry.estimate_tokens(synthesis_prompt)
            sc = ModelRegistry.estimate_tokens(synthesis)
            s_cost = ModelRegistry.calculate_cost(synth_model, sp, sc)
            total_prompt_tokens += sp
            total_completion_tokens += sc
            total_cost_usd += s_cost["costUSD"]
            total_cost_eur += s_cost["costEUR"]
            stat = model_stats.setdefault(synth_model, {"tokens": 0.0, "costUSD": 0.0, "costEUR": 0.0})
            stat["tokens"] += sp + sc
            stat["costUSD"] += s_cost["costUSD"]
            stat["costEUR"] += s_cost["costEUR"]

        total_tokens = total_prompt_tokens + total_completion_tokens
        models = [
            {
                "model": model,
                "tokens": round(stat["tokens"]),
                "costUSD": stat["costUSD"],
                "costEUR": stat["costEUR"],
                "formattedUSD": self._fmt_token_cost(stat["costUSD"], "$"),
                "formattedEUR": self._fmt_token_cost(stat["costEUR"], "\u20ac"),
            }
            for model, stat in model_stats.items()
        ]

        return {
            "totalPromptTokens": total_prompt_tokens,
            "totalCompletionTokens": total_completion_tokens,
            "totalTokens": total_tokens,
            "totalCostUSD": total_cost_usd,
            "totalCostEUR": total_cost_eur,
            "costSummary": {
                "totalPromptTokens": total_prompt_tokens,
                "totalCompletionTokens": total_completion_tokens,
                "totalTokens": total_tokens,
                "totalCostUSD": total_cost_usd,
                "totalCostEUR": total_cost_eur,
                "formattedUSD": self._fmt_token_cost(total_cost_usd, "$"),
                "formattedEUR": self._fmt_token_cost(total_cost_eur, "\u20ac"),
                "models": models,
            },
        }