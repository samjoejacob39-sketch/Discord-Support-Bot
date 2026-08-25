import { TIMINGS } from '../../config/constants.js';
import { withTimeout } from '../../util/async.js';
import { hostOf, type SearchOptions, type SearchProvider, type SearchResult } from '../searchProvider.js';

const FRESHNESS: Record<string, string | undefined> = { day: 'pd', week: 'pw', month: 'pm', any: undefined };

interface BraveResponse {
  web?: { results?: { title?: string; url?: string; description?: string; age?: string; page_age?: string }[] };
}

/** Brave Search API — https://api.search.brave.com/app/keys */
export class BraveSearchProvider implements SearchProvider {
  readonly name = 'brave';
  readonly enabled = true;

  constructor(private readonly apiKey: string) {}

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query.slice(0, 400));
    url.searchParams.set('count', String(Math.min(options.count ?? 5, 10)));
    const freshness = FRESHNESS[options.recency ?? 'any'];
    if (freshness) url.searchParams.set('freshness', freshness);

    const response = await withTimeout(
      fetch(url, {
        headers: { Accept: 'application/json', 'X-Subscription-Token': this.apiKey },
      }),
      TIMINGS.webSearchTimeoutMs,
    );
    if (!response.ok) throw new Error(`Brave search failed with HTTP ${response.status}`);

    const body = (await response.json()) as BraveResponse;
    return (body.web?.results ?? [])
      .filter((item) => typeof item.url === 'string')
      .map((item) => ({
        title: item.title ?? item.url ?? 'Untitled',
        url: item.url as string,
        snippet: (item.description ?? '').replace(/<[^>]+>/g, ''),
        publishedAt: item.page_age ?? item.age,
        host: hostOf(item.url as string),
      }));
  }
}
