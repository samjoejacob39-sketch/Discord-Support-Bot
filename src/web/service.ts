import type { Env } from '../config/env.js';
import { child } from '../logging/logger.js';
import { fetchWebpage, type FetchedPage } from './fetcher.js';
import { BraveSearchProvider } from './providers/brave.js';
import { DuckDuckGoSearchProvider } from './providers/duckduckgo.js';
import { NoopSearchProvider } from './providers/none.js';
import { TavilySearchProvider } from './providers/tavily.js';
import { rankResults, type ScoredResult } from './sourceQuality.js';
import type { SearchOptions, SearchProvider } from './searchProvider.js';

const log = child('web');

export function createSearchProvider(env: Env): SearchProvider {
  switch (env.WEB_SEARCH_PROVIDER) {
    case 'brave':
      return env.BRAVE_SEARCH_API_KEY ? new BraveSearchProvider(env.BRAVE_SEARCH_API_KEY) : new NoopSearchProvider();
    case 'tavily':
      return env.TAVILY_API_KEY ? new TavilySearchProvider(env.TAVILY_API_KEY) : new NoopSearchProvider();
    case 'duckduckgo':
      return new DuckDuckGoSearchProvider();
    default:
      return new NoopSearchProvider();
  }
}

/** Signals that a question may need *current* information rather than stable knowledge. */
const RECENCY_SIGNALS = [
  /\b(today|tonight|right now|currently|at the moment|this (week|month|morning|afternoon)|just now|recently|latest|newest|current)\b/i,
  /\b(outage|down|offline|degraded|incident|status|maintenance)\b/i,
  /\b(version|release|changelog|update|patch|deprecat(ed|ion))\b/i,
  /\b(price|pricing|cost)s?\b.*\b(now|today|current)\b/i,
  /\b(is|are|has|have|did)\b.*\b(changed|happened|released|announced)\b/i,
  /\b(check|verify|look ?up|search)\b/i,
  /\b20(2[5-9]|[3-9]\d)\b/,
];

/**
 * Cheap gate deciding whether the web tool is even offered to the model. Stable general
 * knowledge never reaches the network; the model still chooses whether to call the tool.
 */
export function shouldOfferWebSearch(question: string): boolean {
  return RECENCY_SIGNALS.some((pattern) => pattern.test(question));
}

export interface WebSearchOutcome {
  provider: string;
  query: string;
  results: ScoredResult[];
}

export class WebService {
  constructor(
    private readonly provider: SearchProvider,
    private readonly fetchEnabled: boolean,
  ) {}

  get searchEnabled(): boolean {
    return this.provider.enabled;
  }

  get providerName(): string {
    return this.provider.name;
  }

  get fetchAllowed(): boolean {
    return this.fetchEnabled;
  }

  async search(query: string, options: SearchOptions = {}): Promise<WebSearchOutcome> {
    const raw = await this.provider.search(query, options);
    const results = rankResults(raw, query).slice(0, options.count ?? 5);
    log.debug({ provider: this.provider.name, query, count: results.length }, 'web search');
    return { provider: this.provider.name, query, results };
  }

  async fetch(url: string): Promise<FetchedPage> {
    if (!this.fetchEnabled) throw new Error('Web page fetching is disabled for this bot.');
    return fetchWebpage(url);
  }
}

export function createWebService(env: Env): WebService {
  const provider = createSearchProvider(env);
  log.info({ search: provider.name, fetch: env.WEB_FETCH_ENABLED }, 'web service ready');
  return new WebService(provider, env.WEB_FETCH_ENABLED);
}
