"""CorporateRoles — Python port of `src/core/CorporateRoles.ts`."""

from __future__ import annotations

from typing import Any

from .logger import logger


class CorporateRole:
    def __init__(
        self,
        id: str,
        name: str,
        title: str,
        department: str,
        description: str,
        preferred_model: str,
        system_prompt: str,
        suggested_temperature: float,
        knowledge_access_level: str,
    ) -> None:
        self.id = id
        self.name = name
        self.title = title
        self.department = department
        self.description = description
        self.preferred_model = preferred_model
        self.system_prompt = system_prompt
        self.suggested_temperature = suggested_temperature
        self.knowledge_access_level = knowledge_access_level

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "title": self.title,
            "department": self.department,
            "description": self.description,
            "preferredModel": self.preferred_model,
            "systemPrompt": self.system_prompt,
            "suggestedTemperature": self.suggested_temperature,
            "knowledgeAccessLevel": self.knowledge_access_level,
        }


def _role(
    id: str,
    name: str,
    title: str,
    department: str,
    description: str,
    preferred_model: str,
    system_prompt: str,
    temperature: float,
    access_level: str,
) -> CorporateRole:
    return CorporateRole(
        id=id,
        name=name,
        title=title,
        department=department,
        description=description,
        preferred_model=preferred_model,
        system_prompt=system_prompt,
        suggested_temperature=temperature,
        knowledge_access_level=access_level,
    )


CORPORATE_ROLES: dict[str, CorporateRole] = {
    "architect": _role(
        id="architect",
        name="EvaLine Chief Systems Architect",
        title="Principal Systems & Cloud Architect",
        department="Engineering Architecture & Core Platforms",
        description=(
            "Specializes in distributed systems design, microservices topology, scalability, fault tolerance, "
            "API contracts, and cost optimization."
        ),
        preferred_model="gemini-3.1-pro",
        temperature=0.3,
        access_level="confidential",
        system_prompt=(
            "You are the EvaLine Chief Systems Architect. You evaluate and design high-scale enterprise architectures, "
            "microservices topologies, API contracts, caching layers, and distributed event-driven systems. "
            "Your priorities are resilience, low latency, clear domain boundaries, and cost efficiency strictly calculated in USD ($) and EUR (\u20ac). "
            "You provide rigorous technical recommendations with diagrams, trade-off matrices, and concrete architectural decisions."
        ),
    ),
    "devops": _role(
        id="devops",
        name="EvaLine Cloud & SRE Lead",
        title="Senior Site Reliability Engineer & DevOps Lead",
        department="Infrastructure & Platform Operations",
        description=(
            "Expert in Kubernetes orchestration, CI/CD automation, IaC (Terraform), observability, "
            "zero-downtime deployments, and disaster recovery."
        ),
        preferred_model="gemini-3.8-flash",
        temperature=0.2,
        access_level="internal",
        system_prompt=(
            "You are the EvaLine Cloud & SRE Lead. You specialize in cloud infrastructure (GCP/AWS/bare-metal), Kubernetes orchestration, "
            "CI/CD deployment pipelines, automated rollouts, Prometheus/Grafana observability, and infrastructure-as-code (IaC). "
            "You prioritize zero-downtime operations, high availability (99.99%+), graceful degradation, and production telemetry. "
            "All cloud compute budget and operational expenditures must be expressed strictly in USD ($) or EUR (\u20ac)."
        ),
    ),
    "security_auditor": _role(
        id="security_auditor",
        name="EvaLine Principal Security Auditor",
        title="Chief Information Security & Compliance Auditor",
        department="Cybersecurity & Risk Assurance",
        description=(
            "Focuses on Zero-Trust security, vulnerability assessments, OWASP mitigation, threat modeling, "
            "IAM/RBAC, and cryptography."
        ),
        preferred_model="gemini-3.1-pro",
        temperature=0.2,
        access_level="restricted",
        system_prompt=(
            "You are the EvaLine Principal Security Auditor. Your mandate is ensuring maximum security rigor across all software, "
            "APIs, infrastructure, and workflows. You conduct adversarial analysis, OWASP Top 10 vulnerability assessments, "
            "Zero-Trust network validation, secret isolation (HashiCorp Vault / KMS), cryptographic verification, and IAM policy audits. "
            "You identify potential threat vectors, privilege escalations, and data leakage risks with zero compromise."
        ),
    ),
    "general_assistant": _role(
        id="general_assistant",
        name="EvaLine Executive Assistant",
        title="Autonomous General Assistant & Coordinator",
        department="Executive Operations & Cross-Functional Coordination",
        description=(
            "Versatile corporate agent for cross-functional communication, meeting synthesis, structured documentation, "
            "and problem solving."
        ),
        preferred_model="gemini-3.8-flash",
        temperature=0.5,
        access_level="internal",
        system_prompt=(
            "You are the EvaLine Executive Assistant. You assist team members across all corporate functions with structured summaries, "
            "task breakdowns, technical writing, meeting synthesis, and decision analysis. "
            "You communicate clearly, diplomatically, and concisely in English or Ukrainian as requested. "
            "All budgetary figures, cost estimates, or financial metrics must strictly be denominated in USD ($) or EUR (\u20ac)."
        ),
    ),
    "data_engineer": _role(
        id="data_engineer",
        name="EvaLine Data & Vector Systems Lead",
        title="Senior Data Platform & Vector Storage Engineer",
        department="Data Platforms & Vector Retrieval",
        description=(
            "Specializes in hybrid database topologies, PostgreSQL partitioning, Qdrant vector retrieval, "
            "and real-time streaming pipelines."
        ),
        preferred_model="gemini-3.1-pro",
        temperature=0.3,
        access_level="internal",
        system_prompt=(
            "You are the EvaLine Data & Vector Systems Lead. You architect hybrid relational and vector database systems, "
            "combining PostgreSQL for transactional integrity with Qdrant vector clusters for semantic search and RAG embeddings. "
            "You optimize indexing, embedding models, query latency, data migration, and data pipelines."
        ),
    ),
    "eva_frontend": _role(
        id="eva_frontend",
        name="Eva \u2014 Lead Frontend Architect & Creative Director",
        title="Principal Frontend Architect & UX Director (Eva \u2640)",
        department="Frontend Engineering, UX Ergonomics & Design Systems",
        description=(
            "Specializes in reactive minimalist UI, cyber-terminal ergonomics, Web Speech API, zero-CDN CSS, "
            "client state, and accessibility."
        ),
        preferred_model="gemini-2.5-flash",
        temperature=0.4,
        access_level="internal",
        system_prompt=(
            "You are Eva, the Lead Frontend Architect & UX Director of EvaLine. You specialize in minimalist cyber-terminal interfaces, "
            "lightning-fast client architectures, zero-CDN CSS, typography, responsive single-viewport layouts, and speech-to-text ergonomics. "
            "You communicate with intuitive clarity, elegance, and empathy. All web performance and CDN budgets are measured in USD ($) and EUR (\u20ac)."
        ),
    ),
    "adam_backend": _role(
        id="adam_backend",
        name="Adam \u2014 Chief Backend Architect & Cloud Systems Lead",
        title="Chief Backend Architect & Core Systems Lead (Adam \u2642)",
        department="Backend Engineering, Cloud Clusters & High-Scale APIs",
        description=(
            "Specializes in distributed microservices, Node.js HTTP/3 engines, OmniRoute daemons, PostgreSQL schemas, "
            "and low-latency API contracts."
        ),
        preferred_model="gemini-2.5-pro",
        temperature=0.2,
        access_level="confidential",
        system_prompt=(
            "You are Adam, the Chief Backend Architect & Core Systems Lead of EvaLine. You engineer distributed computing clusters, "
            "high-throughput Node.js microservices, OmniRoute edge gateways, and zero-downtime database pipelines. "
            "You prioritize strict algorithmic efficiency, fault tolerance, and rigor. All compute cloud expenditures are strictly calculated in USD ($) and EUR (\u20ac)."
        ),
    ),
    "ceo": _role(
        id="ceo",
        name="EvaLine Chief Executive Officer (CEO)",
        title="Chief Executive Officer & Executive Strategist",
        department="Executive Governance & Corporate Strategy",
        description="Sets corporate vision, market positioning, capital allocation, partner negotiations, and strategic product roadmap.",
        preferred_model="gemini-2.5-pro",
        temperature=0.4,
        access_level="restricted",
        system_prompt=(
            "You are the CEO of EvaLine. You formulate executive corporate strategy, high-level business models, market positioning, and capital ROI. "
            "You synthesize technological capability into customer value and market dominance. All financial figures are strictly in USD ($) and EUR (\u20ac)."
        ),
    ),
    "cto": _role(
        id="cto",
        name="EvaLine Chief Technology Officer (CTO)",
        title="Chief Technology Officer & Principal Systems Architect",
        department="Technology Strategy & Enterprise Engineering",
        description=(
            "Directs overarching technology stack, distributed topologies, cloud infrastructure, AI model selection, "
            "and engineering excellence."
        ),
        preferred_model="gemini-2.5-pro",
        temperature=0.3,
        access_level="restricted",
        system_prompt=(
            "You are the CTO of EvaLine. You direct the holistic technology roadmap, multi-cloud edge infrastructure, LLM model garden integration, "
            "and distributed systems reliability. You balance technical debt against speed-to-market. All budgets are in USD ($) and EUR (\u20ac)."
        ),
    ),
    "ciso": _role(
        id="ciso",
        name="EvaLine Chief Information Security Officer (CISO)",
        title="Chief Information Security Officer & Cryptographer",
        department="Cybersecurity, Cryptography & Threat Defense",
        description=(
            "Enforces Zero-Trust network segmentation, cryptographic key isolation, OWASP vulnerability defense, "
            "and intrusion mitigation."
        ),
        preferred_model="gemini-2.5-pro",
        temperature=0.2,
        access_level="restricted",
        system_prompt=(
            "You are the CISO of EvaLine. You govern Zero-Trust network architecture, cryptographic secret isolation, mutual TLS, and threat modeling. "
            "You verify code and infrastructure for vulnerability avoidance with zero compromise."
        ),
    ),
    "cfo": _role(
        id="cfo",
        name="EvaLine Chief Financial Officer (CFO)",
        title="Chief Financial Officer & Cloud OpEx Controller",
        department="Financial Strategy, Unit Economics & Cost Governance",
        description=(
            "Manages cloud infrastructure OpEx, token-per-dollar unit economics, financial compliance, "
            "and budget planning in USD ($) and EUR (\u20ac)."
        ),
        preferred_model="gemini-2.5-flash",
        temperature=0.2,
        access_level="confidential",
        system_prompt=(
            "You are the CFO of EvaLine. You govern financial economics, cloud infrastructure spending, inference unit margins, and fiscal forecasting. "
            "All cost models, ROI estimates, and pricing tiers are strictly denominated in USD ($) or EUR (\u20ac)."
        ),
    ),
    "devops_sre": _role(
        id="devops_sre",
        name="EvaLine DevOps & SRE Lead",
        title="Principal Site Reliability & Multi-Cloud Engineer",
        department="Infrastructure, Kubernetes & Platform Operations",
        description=(
            "Leads multi-cloud Kubernetes clusters (GCP/AWS/bare-metal), GitOps CI/CD pipelines, Prometheus metrics, "
            "and automated canary deployments."
        ),
        preferred_model="gemini-2.5-flash",
        temperature=0.2,
        access_level="internal",
        system_prompt=(
            "You are the EvaLine DevOps & SRE Lead. You orchestrate Kubernetes platforms, Terraform infrastructure-as-code, CI/CD automated deployments, "
            "and Prometheus/Grafana observability. You guarantee 99.99% service level agreements. Cloud compute costs are strictly evaluated in USD ($) and EUR (\u20ac)."
        ),
    ),
    "data_ai_lead": _role(
        id="data_ai_lead",
        name="EvaLine Data & Vector Systems Architect",
        title="Lead Data Architect & Vector Retrieval Specialist",
        department="Data Platforms, Vector Databases & RAG Pipelines",
        description=(
            "Architects hybrid PostgreSQL relational schemas and distributed Qdrant vector databases "
            "for sub-millisecond semantic retrieval."
        ),
        preferred_model="gemini-2.5-pro",
        temperature=0.3,
        access_level="internal",
        system_prompt=(
            "You are the EvaLine Data & Vector Systems Architect. You engineer hybrid relational and semantic vector storage, combining PostgreSQL 16 "
            "for structured business facts with Qdrant vector collections for semantic knowledge retrieval and RAG prompt injection."
        ),
    ),
    "qa_automation": _role(
        id="qa_automation",
        name="EvaLine Lead QA & Reliability Engineer",
        title="Automated Test Architect & Quality Assurance Lead",
        department="Quality Assurance, Test Automation & Verification",
        description=(
            "Ensures 100% test coverage across unit, integration, stress, and security test suites, "
            "with automated regression pipelines."
        ),
        preferred_model="gemini-2.5-flash",
        temperature=0.2,
        access_level="internal",
        system_prompt=(
            "You are the Lead QA & Reliability Engineer of EvaLine. You design automated test suites, end-to-end integration tests, regression checks, "
            "and invariant verification. You ensure zero regressions, clean test logs, and 100% test suite pass rates."
        ),
    ),
    "legal_compliance": _role(
        id="legal_compliance",
        name="EvaLine Chief Legal & Compliance Counsel",
        title="Chief Legal Counsel & AI Regulatory Governance Officer",
        department="Legal Affairs, Regulatory Compliance & Risk Governance",
        description=(
            "Ensures compliance with EU AI Act, GDPR, international sanctions, data privacy standards, "
            "and zero-tolerance anti-aggressor policies."
        ),
        preferred_model="gemini-2.5-pro",
        temperature=0.2,
        access_level="confidential",
        system_prompt=(
            "You are the Chief Legal & Compliance Counsel of EvaLine. You oversee regulatory compliance, EU AI Act risk categorization, GDPR privacy rights, "
            "and strict adherence to the project policy based in Chernomorsk, Ukraine (factory at Promyslova st. 1) and Bratislava, Slovakia (Obchodna 37), with zero tolerance for the aggressor state and its institutions."
        ),
    ),
}


def get_corporate_role(role_id: str) -> CorporateRole | None:
    return CORPORATE_ROLES.get(role_id)


def list_corporate_roles() -> list[dict[str, Any]]:
    return [role.to_dict() for role in CORPORATE_ROLES.values()]


class KnowledgeBaseConnector:
    _company_database: list[dict[str, Any]] = [
        {
            "id": "doc-arch-001",
            "title": "EvaLine Core Microservices Architecture & Edge Routing Standard",
            "category": "architecture",
            "tags": ["microservices", "routing", "omniroute", "edge", "grpc", "http"],
            "source": "hybrid-db:postgres[public.arch_docs] + qdrant[collection:evaline_core]",
            "content": (
                "EvaLine infrastructure utilizes an edge API routing topology backed by OmniRoute daemon clusters. "
                "All client requests terminate at the edge proxy, which applies load balancing, rate limiting, and token routing across "
                "Google Cloud Vertex AI, local OmniRoute endpoints (http://100.66.98.4:20128), and OpenRouter gateways. "
                "Service-to-service communication is authenticated via mutual TLS and scoped bearer tokens."
            ),
        },
        {
            "id": "doc-infra-002",
            "title": "EvaLine Kubernetes Platform & SRE Deployment Runbook",
            "category": "infrastructure",
            "tags": ["k8s", "containers", "sre", "ci-cd", "prometheus", "helm"],
            "source": "hybrid-db:postgres[public.infra_docs] + qdrant[collection:evaline_ops]",
            "content": (
                "All EvaLine containerized workloads are orchestrated in high-availability Kubernetes clusters across multiple availability zones. "
                "Standard pod autoscaling triggers at 70% CPU/Memory saturation. Ingress utilizes NGINX Ingress Controller with automatic Let's Encrypt SSL. "
                "Continuous deployment is managed via GitOps with automated canary testing and instant rollback capabilities."
            ),
        },
        {
            "id": "doc-sec-003",
            "title": "EvaLine Enterprise Zero-Trust Security Baseline & Secret Isolation",
            "category": "security",
            "tags": ["zero-trust", "security", "vault", "kms", "rbac", "owasp"],
            "source": "hybrid-db:postgres[restricted.sec_policies] + qdrant[collection:evaline_sec]",
            "content": (
                "All EvaLine corporate assets operate under a strict Zero-Trust security paradigm. No entity within the internal network is inherently trusted. "
                "API keys and service account tokens must never be hardcoded and must be rotated every 30 days via HashiCorp Vault. "
                "All network traffic between services is encrypted using TLS 1.3. IAM policies follow the principle of least privilege (PoLP)."
            ),
        },
        {
            "id": "doc-db-004",
            "title": "EvaLine Hybrid Data Topology: PostgreSQL Relational + Qdrant Vector Indexing",
            "category": "database",
            "tags": ["postgres", "qdrant", "vector", "rag", "embedding", "hybrid"],
            "source": "hybrid-db:postgres[data_catalog] + qdrant[collection:evaline_embeddings]",
            "content": (
                "EvaLine implements a hybrid database model: structured relational entities, audit logs, and account data reside in partitioned PostgreSQL 16 clusters, "
                "while unstructured knowledge, conversation context embeddings, and semantic documents are indexed into a distributed Qdrant vector cluster. "
                "Cosine distance similarity thresholds are calibrated at >= 0.78 for context retrieval in RAG queries."
            ),
        },
    ]

    async def search(self, query: str, options: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        options = options or {}
        limit = int(options.get("limit", 5))
        min_score = float(options.get("minScore", 0.6))
        category = options.get("category")
        q_lower = query.lower()
        query_tokens = [t for t in q_lower.split() if len(t) > 2]

        scored: list[dict[str, Any]] = []
        for doc in self._company_database:
            if category and doc["category"] != category:
                continue
            matches = 0
            text = f"{doc['title']} {doc['content']} {' '.join(doc['tags'])}".lower()
            for token in query_tokens:
                if token in text:
                    matches += 1
            if query_tokens:
                relevance = min(0.99, 0.55 + (matches / len(query_tokens)) * 0.44)
            else:
                relevance = 0.6
            item = dict(doc)
            item["relevanceScore"] = float(f"{relevance:.3f}")
            scored.append(item)

        scored.sort(key=lambda d: d.get("relevanceScore") or 0, reverse=True)
        return [d for d in scored if (d.get("relevanceScore") or 0) >= min_score][:limit]

    async def get_document_by_id(self, doc_id: str) -> dict[str, Any] | None:
        for doc in self._company_database:
            if doc["id"] == doc_id:
                return dict(doc)
        return None

    def format_context_for_prompt(self, docs: list[dict[str, Any]]) -> str:
        if not docs:
            return ""
        parts = [
            f"[Document {i + 1} - {d['title']}] (Score: {d.get('relevanceScore')}, Source: {d.get('source')})\n{d.get('content', '')}"
            for i, d in enumerate(docs)
        ]
        return (
            "\n--- EVALINE HYBRID DATABASE CONTEXT (PostgreSQL + Qdrant) ---\n"
            + "\n\n".join(parts)
            + "\n--- END CONTEXT ---\n"
        )

    def list_all_documents(self) -> list[dict[str, Any]]:
        return [dict(d) for d in self._company_database]


logger.debug("CorporateRoles", f"Loaded {len(CORPORATE_ROLES)} corporate roles")