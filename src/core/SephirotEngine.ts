import { ConsiliumEngine, ConsiliumParticipant, ConsiliumResult } from './ConsiliumEngine.js';
import { ChatHistoryStore } from './ChatHistoryStore.js';
import { I18nEngine } from './I18nEngine.js';
import { Config } from './Config.js';
import { logger } from './Logger.js';
import { applyPersonaPolicy } from './PersonaPolicy.js';

export type VoicePersona = 'eva' | 'adam' | 'neutral';

/**
 * One node of the Sephirot decision tree (Tree of Life) mapped onto a
 * consilium agent. `stage` groups nodes into execution waves:
 *   1 = crown level (vision/strategy/analysis) — runs first each round
 *   2 = middle pillar + lateral sephirot (growth/security/design/devops/comms)
 *   3 = foundation + kingdom (data/execution) — closes the loop
 */
export interface SephirotRole {
  id: string;
  sephira: string;
  nameEn: string;
  nameUk: string;
  nameRu: string;
  title: string;
  parentIds: string[];
  model: string;
  systemPrompt: string;
  voicePersona: VoicePersona;
  stage: 1 | 2 | 3;
}

export const SEPHIROT_ROLES: SephirotRole[] = [
  {
    id: 'kether',
    sephira: 'Kether (Корона / Кетер)',
    nameEn: 'Kether — Vision',
    nameUk: 'Кетер — Бачення',
    nameRu: 'Кетер — Видение',
    title: 'Vision / CEO-Vision',
    parentIds: [],
    model: 'gemini-3.1-pro',
    systemPrompt:
      'You are KETHER, the Crown — the vision seed of the Sephirot decision tree. ' +
      'You state the God-level intent: the single highest goal, success criteria and non-negotiables for the topic. ' +
      'Be brief (max 150 words). You have no parents; you originate the intention that splits into force and form below you.',
    voicePersona: 'neutral',
    stage: 1,
  },
  {
    id: 'chokmah',
    sephira: 'Chokmah (Мудрість / Мудрость)',
    nameEn: 'Chokmah — Strategy',
    nameUk: 'Хокма — Стратегія',
    nameRu: 'Хокма — Стратегия',
    title: 'Strategy',
    parentIds: ['kether'],
    model: 'gemini-3.8-flash',
    systemPrompt:
      'You are CHOKMAH, Wisdom — the force/flash side of Kether\'s intent. ' +
      'You convert the vision into 2-3 bold strategic options with trade-offs. ' +
      'You receive input from Kether. Be concrete and decisive (max 150 words).',
    voicePersona: 'neutral',
    stage: 1,
  },
  {
    id: 'binah',
    sephira: 'Binah (Розуміння / Понимание)',
    nameEn: 'Binah — Analysis',
    nameUk: 'Біна — Аналіз',
    nameRu: 'Бина — Анализ',
    title: 'Analysis / Critique',
    parentIds: ['kether'],
    model: 'omniroute/deepseek-r1',
    systemPrompt:
      'You are BINAH, Understanding — the form/critique side of Kether\'s intent. ' +
      'You stress-test the vision and each strategy: risks, costs, failure modes, hidden assumptions. ' +
      'You receive input from Kether. Be rigorous and specific (max 150 words).',
    voicePersona: 'neutral',
    stage: 1,
  },
  {
    id: 'chesed',
    sephira: 'Chesed (Милосердя / Милосердие)',
    nameEn: 'Chesed — Growth',
    nameUk: 'Хесед — Зростання',
    nameRu: 'Хесед — Рост',
    title: 'Growth / Marketing',
    parentIds: ['chokmah'],
    model: 'gemini-2.5-flash',
    systemPrompt:
      'You are CHESED, Mercy/Expansion — the growth axis. ' +
      'Given vision, strategy and critique, propose the expansion path: market, adoption, marketing leverage. ' +
      'You receive input from Chokmah and Binah (via the round flow). Be brief (max 120 words).',
    voicePersona: 'neutral',
    stage: 2,
  },
  {
    id: 'gevurah',
    sephira: 'Gevurah (Суворість / Строгость)',
    nameEn: 'Gevurah — Severity',
    nameUk: 'Гевура — Суворість',
    nameRu: 'Гвура — Строгость',
    title: 'Security / Compliance',
    parentIds: ['binah'],
    model: 'opencode/zen-security-auditor',
    systemPrompt:
      'You are GEVURAH, Severity — the constraining axis. ' +
      'Given vision, strategy and critique, define security, legal and compliance boundaries that MUST hold. ' +
      'You receive input from Binah. Say exactly what is forbidden and what evidence is required (max 120 words).',
    voicePersona: 'neutral',
    stage: 2,
  },
  {
    id: 'tiferet',
    sephira: 'Tiferet (Краса / Красота)',
    nameEn: 'Tiferet — Harmony (Adam)',
    nameUk: 'Тиферет — Краса (Адам)',
    nameRu: 'Тиферет — Красота (Адам)',
    title: 'Design / Harmony',
    parentIds: ['chesed', 'gevurah'],
    model: 'gemini-2.5-pro',
    systemPrompt:
      'You are TIFERET, Beauty — the balancing heart of the tree, voiced by ADAM (male persona, warm and precise). ' +
      'You harmonize growth (Chesed) and severity (Gevurah) into one balanced design direction that still serves the vision. ' +
      'Speak as the human-interface Adam. Be brief (max 120 words).',
    voicePersona: 'adam',
    stage: 2,
  },
  {
    id: 'netzach',
    sephira: 'Netzach (Вічність / Вечность)',
    nameEn: 'Netzach — Endurance',
    nameUk: 'Нецах — Вічність',
    nameRu: 'Нецах — Вечность',
    title: 'Persistence / DevOps',
    parentIds: ['tiferet'],
    model: 'opencode/zen-devops-k8s',
    systemPrompt:
      'You are NETZACH, Endurance — the persistence axis. ' +
      'Given the balanced design, define what must survive time: deployment, reliability, uptime, iteration cadence, rollback. ' +
      'You receive input from Tiferet. Be brief (max 120 words).',
    voicePersona: 'neutral',
    stage: 2,
  },
  {
    id: 'hod',
    sephira: 'Hod (Слава / Слава)',
    nameEn: 'Hod — Splendor (Eve)',
    nameUk: 'Ход — Слава (Єва)',
    nameRu: 'Ход — Слава (Ева)',
    title: 'Communication / Docs',
    parentIds: ['netzach'],
    model: 'opencode/zen-docs-writer',
    systemPrompt:
      'You are HOD, Splendor — the communication axis, voiced by EVE (female persona, clear and empathetic). ' +
      'You translate the emerging plan into precise human language: docs, messages, naming, what users will see and read. ' +
      'Speak as the human-interface Eve. Be brief (max 120 words).',
    voicePersona: 'eva',
    stage: 2,
  },
  {
    id: 'yesod',
    sephira: 'Yesod (Основа / Основание)',
    nameEn: 'Yesod — Foundation',
    nameUk: 'Єсод — Основа',
    nameRu: 'Йесод — Основание',
    title: 'Foundation / Data / Memory',
    parentIds: ['hod'],
    model: 'omniroute/deepseek-v3',
    systemPrompt:
      'You are YESOD, Foundation — the data and memory axis. ' +
      'Given the full plan, define the data layer: what is stored, what is remembered, what metrics prove progress. ' +
      'You receive input from Hod. Be brief (max 120 words).',
    voicePersona: 'neutral',
    stage: 3,
  },
  {
    id: 'malkuth',
    sephira: 'Malkuth (Царство / Царство)',
    nameEn: 'Malkuth — Kingdom',
    nameUk: 'Малкут — Царство',
    nameRu: 'Малкут — Царство',
    title: 'Execution / Production',
    parentIds: ['yesod'],
    model: 'gemini-3.1-flash',
    systemPrompt:
      'You are MALKUTH, Kingdom — the execution plane where intention becomes reality. ' +
      'Produce the final actionable production plan: concrete first steps, owners, deadlines. Close the Vision-Strategy-Execution-Feedback loop. ' +
      'You receive input from Yesod (and everything above it). Be brief (max 150 words).',
    voicePersona: 'neutral',
    stage: 3,
  },
];

export interface SephirotRunOptions {
  rounds?: number;
  synthesizerModel?: string;
  useKnowledgeBase?: boolean;
}

export interface SephirotStatus {
  running: boolean;
  topic: string;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  rounds?: number;
  error?: string;
  synthesis?: string;
}

const SEPHIROT_SESSION_ID = 'sephirot';
const DEFAULT_SYNTHESIZER_MODEL = 'gemini-3.1-pro';

export class SephirotEngine {
  private static status: SephirotStatus = { running: false, topic: '' };

  /**
   * Maps the 10 Sephirot nodes onto ConsiliumParticipant shapes accepted by
   * ConsiliumEngine (id/model/name/title/systemPrompt/temperature). Nodes are
   * emitted in BFS tree order so each consilium round walks the tree top-down:
   * crown level (vision/strategy/analysis) speaks first, the middle tree second,
   * foundation/execution last.
   */
  public static buildParticipants(topic: string): ConsiliumParticipant[] {
    return SEPHIROT_ROLES.map((node) => {
      const parents = node.parentIds.map((pid) => SEPHIROT_ROLES.find((n) => n.id === pid)?.sephira || pid);
      const upstream = parents.length
        ? ` You receive input from: ${parents.join(', ')}.`
        : ' You are the root of the tree.';
      // PersonaPolicy: TIFERET (ADAM voice) and HOD (EVE voice) get their
      // identity lock; neutral nodes stay neutral (ROLE SPLIT rule only).
      const persona = node.voicePersona === 'adam' ? 'adam' : node.voicePersona === 'eva' ? 'eva' : undefined;
      return {
        id: `sephira-${node.id}`,
        model: node.model,
        name: node.nameEn,
        title: node.title,
        systemPrompt: applyPersonaPolicy(
          `${node.systemPrompt}${upstream} Topic under deliberation: "${topic}".`,
          persona
        ),
        temperature: node.voicePersona === 'neutral' ? 0.4 : 0.6,
      };
    });
  }

  public static async runSephirotConsilium(
    topic: string,
    options: SephirotRunOptions = {}
  ): Promise<ConsiliumResult> {
    const cleanTopic = (topic || '').trim();
    if (!cleanTopic) throw new Error('Sephirot consilium requires a non-empty topic');

    const rounds = Math.max(1, Math.min(options.rounds ?? 3, 4));
    const synthesizerModel = options.synthesizerModel || DEFAULT_SYNTHESIZER_MODEL;
    const participants = this.buildParticipants(cleanTopic);

    this.status = { running: true, topic: cleanTopic, startedAt: Date.now(), rounds };

    const engine = new ConsiliumEngine(Config.geminiApiKey || undefined);
    try {
      const result = await engine.run({
        mode: 'consilium',
        prompt: this.buildPrompt(cleanTopic),
        participants,
        rounds,
        synthesizerModel,
        useKnowledgeBase: options.useKnowledgeBase ?? true,
      });

      this.status = {
        running: false,
        topic: cleanTopic,
        startedAt: this.status.startedAt,
        finishedAt: Date.now(),
        durationMs: result.durationMs,
        rounds,
        synthesis: result.synthesis,
      };

      this.persistResult(cleanTopic, result);
      return result;
    } catch (err: any) {
      this.status = {
        running: false,
        topic: cleanTopic,
        startedAt: this.status.startedAt,
        finishedAt: Date.now(),
        error: err.message,
      };
      throw err;
    }
  }

  /**
   * The 10-node consilium prompt: explains the decision hierarchy so every
   * agent knows where it sits in the Sephirot tree.
   */
  private static buildPrompt(topic: string): string {
    const tree = SEPHIROT_ROLES.map((n) => {
      const parents = n.parentIds.length ? n.parentIds.join(' + ') : '(root)';
      return `- ${n.id} [stage ${n.stage}] (${n.sephira}) ← parents: ${parents}`;
    }).join('\n');
    return (
      `Sephirot consilium on the topic: "${topic}".\n\n` +
      `Ten agents are arranged on the Tree of Life decision hierarchy:\n${tree}\n\n` +
      `Deliberate across the Tetraxis axes — Vision → Strategy → Execution → Feedback — ` +
      `respecting the parent-child flow: intention (Kether) splits into force (Chokmah) and form (Binah), ` +
      `growth (Chesed) is bounded by severity (Gevurah), balanced by beauty (Tiferet), sustained by endurance (Netzach), ` +
      `communicated by splendor (Hod), grounded in data (Yesod) and executed in the kingdom (Malkuth).`
    );
  }

  /**
   * Fire-and-forget persistence + status, mirroring how ChatRouter persists
   * consilium runs into the shared chat-history DB.
   */
  private static persistResult(topic: string, result: ConsiliumResult): void {
    try {
      const store = ChatHistoryStore.getInstance();
      const lang = I18nEngine.getLocale();
      store.appendMessage({ sessionId: SEPHIROT_SESSION_ID, role: 'user', content: topic, model: 'sephirot', lang });
      if (result.synthesis) {
        store.appendMessage({ sessionId: SEPHIROT_SESSION_ID, role: 'assistant', content: result.synthesis, model: 'sephirot', lang });
      }
    } catch (err: any) {
      logger.warn('SephirotEngine', `History persistence skipped: ${err.message}`);
    }
  }

  public static getStatus(): SephirotStatus {
    return { ...this.status };
  }

  /**
   * Synchronous entrypoint used by ModelCommand. Long runs (minutes) are
   * launched in the background and tracked via getStatus(), so /sephirot
   * returns immediately with an acknowledgement, like /consilium does in the
   * web/CLI async paths.
   */
  public static startAsyncRun(topic: string, options: SephirotRunOptions = {}): string {
    if (this.status.running) {
      return `[SEPHIROT] Уже запущено: "${this.status.topic}" (з ${new Date(this.status.startedAt || 0).toISOString()}). Статус: /sephirot status`;
    }
    const cleanTopic = (topic || '').trim();
    if (!cleanTopic) {
      return 'Використання: /sephirot <тема>. Статус: /sephirot status';
    }
    void this.runSephirotConsilium(cleanTopic, options).catch((err: any) => {
      logger.error('SephirotEngine', `Background sephirot run failed: ${err.message}`);
    });
    return (
      ` SEPHIROT CONSILIUM — запущено (10 сфер Дерева Життя, Tetraxis loops).\n` +
      `  Тема: "${cleanTopic}"\n` +
      `  Це може тривати кілька хвилин. Прогрес/результат: /sephirot status\n` +
      `  Синтез буде збережено в сесії "sephirot" чат-історії (/history, /search).`
    );
  }
}
