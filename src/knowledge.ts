/**
 * Knowledge base abstraction for the consilium engine.
 *
 * The engine can ground its deliberation in corporate facts. Hosts inject
 * their own search backend (SQLite FTS5, ChromaDB, Qdrant, markdown corpus);
 * a no-op provider is used when none is supplied.
 */

export interface KnowledgeDocument {
  id: string;
  title: string;
  category: string;
  content: string;
  source?: string;
  tags?: string[];
  relevanceScore?: number;
}

export interface KnowledgeSearchOptions {
  category?: string;
  limit?: number;
  minScore?: number;
}

export interface KnowledgeSource {
  search(query: string, options?: KnowledgeSearchOptions): Promise<KnowledgeDocument[]>;
  formatContextForPrompt(docs: KnowledgeDocument[]): string;
}

export class EmptyKnowledgeSource implements KnowledgeSource {
  public async search(_query: string, _options?: KnowledgeSearchOptions): Promise<KnowledgeDocument[]> {
    return [];
  }

  public formatContextForPrompt(_docs: KnowledgeDocument[]): string {
    return '';
  }
}

export class StaticKnowledgeSource implements KnowledgeSource {
  private readonly docs: KnowledgeDocument[];

  constructor(docs: KnowledgeDocument[]) {
    this.docs = docs;
  }

  public async search(query: string, options: KnowledgeSearchOptions = {}): Promise<KnowledgeDocument[]> {
    const limit = options.limit ?? 5;
    const tokens = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
    if (tokens.length === 0) return this.docs.slice(0, limit);

    const scored = this.docs
      .map((doc) => {
        const haystack = `${doc.title} ${doc.content} ${(doc.tags ?? []).join(' ')}`.toLowerCase();
        const score = tokens.reduce((acc, tok) => acc + (haystack.includes(tok) ? 1 : 0), 0);
        return { doc, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(({ doc }) => doc);
  }

  public formatContextForPrompt(docs: KnowledgeDocument[]): string {
    if (docs.length === 0) return '';
    return docs
      .map(
        (d) =>
          `[${d.category}] ${d.title}\n${d.content}${d.source ? `\nSource: ${d.source}` : ''}`
      )
      .join('\n\n---\n\n');
  }
}