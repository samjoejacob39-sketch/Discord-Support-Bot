import { TIMINGS } from '../../config/constants.js';
import { withTimeout } from '../../util/async.js';
import { hostOf, type SearchOptions, type SearchProvider, type SearchResult } from '../searchProvider.js';

const RESULT_BLOCK = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

function decode(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** DuckDuckGo's redirect wrapper hides the real URL in `uddg`. */
function unwrap(href: string): string {
  try {
    const url = new URL(href, 'https://duckduckgo.com');
    const target = url.searchParams.get('uddg');
    return target ? decodeURIComponent(target) : url.toString();
  } catch {
    return href;
  }
}

/**
 * Keyless fallback that scrapes the DuckDuckGo HTML endpoint. Best-effort by design:
 * it can break whenever their markup changes, which is why it is not the default.
 */
export class DuckDuckGoSearchProvider implements SearchProvider {
  readonly name = 'duckduckgo';
  readonly enabled = true;

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const url = new URL('https://html.duckduckgo.com/html/');
    url.searchParams.set('q', query.slice(0, 400));
    if (options.recency === 'day') url.searchParams.set('df', 'd');
    else if (options.recency === 'week') url.searchParams.set('df', 'w');
    else if (options.recency === 'month') url.searchParams.set('df', 'm');

    const response = await withTimeout(
      fetch(url, { headers: { 'User-Agent': 'ShinchatHelper/1.0 (+support bot)' } }),
      TIMINGS.webSearchTimeoutMs,
    );
    if (!response.ok) throw new Error(`DuckDuckGo search failed with HTTP ${response.status}`);

    const html = await response.text();
    const results: SearchResult[] = [];
    const limit = Math.min(options.count ?? 5, 10);

    for (const match of html.matchAll(RESULT_BLOCK)) {
      const href = unwrap(match[1] ?? '');
      if (!href.startsWith('http')) continue;
      results.push({
        title: decode(match[2] ?? '') || href,
        url: href,
        snippet: decode(match[3] ?? ''),
        host: hostOf(href),
      });
      if (results.length >= limit) break;
    }
    return results;
  }
}
