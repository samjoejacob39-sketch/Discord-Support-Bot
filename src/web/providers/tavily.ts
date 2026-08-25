import { TIMINGS } from '../../config/constants.js';
import { withTimeout } from '../../util/async.js';
import { hostOf, type SearchOptions, type SearchProvider, type SearchResult } from '../searchProvider.js';

const TIME_RANGE: Record<string, string | undefined> = { day: 'day', week: 'week', month: 'month', any: undefined };

interface TavilyResponse {
  results?: { title?: string; url?: string; content?: string; published_date?: string }[];
}

/** Tavily — a search API built for LLM use: https://app.tavily.com */
export class TavilySearchProvider implements SearchProvider {
  readonly name = 'tavily';
  readonly enabled = true;

  constructor(private readonly apiKey: string) {}

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const body: Record<string, unknown> = {
      query: query.slice(0, 400),
      max_results: Math.min(options.count ?? 5, 10),
      search_depth: 'basic',
      include_answer: false,
    };
    const range = TIME_RANGE[options.recency ?? 'any'];
    if (range) body.time_range = range;

    const response = await withTimeout(
      fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      }),
      TIMINGS.webSearchTimeoutMs,
    );
    if (!response.ok) throw new Error(`Tavily search failed with HTTP ${response.status}`);

    const parsed = (await response.json()) as TavilyResponse;
    return (parsed.results ?? [])
      .filter((item) => typeof item.url === 'string')
      .map((item) => ({
        title: item.title ?? item.url ?? 'Untitled',
        url: item.url as string,
        snippet: (item.content ?? '').slice(0, 600),
        publishedAt: item.published_date,
        host: hostOf(item.url as string),
      }));
  }
}
