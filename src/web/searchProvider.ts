export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  /** ISO date when the provider reports one. */
  publishedAt?: string;
  /** Hostname, used for source-quality ranking. */
  host: string;
}

export type Recency = 'day' | 'week' | 'month' | 'any';

export interface SearchOptions {
  count?: number;
  recency?: Recency;
}

export interface SearchProvider {
  readonly name: string;
  readonly enabled: boolean;
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export class SearchUnavailableError extends Error {
  constructor(message = 'Web search is not configured for this bot.') {
    super(message);
    this.name = 'SearchUnavailableError';
  }
}
