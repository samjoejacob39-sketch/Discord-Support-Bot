import { TIMINGS } from '../../config/constants.js';
import { withTimeout } from '../../util/async.js';
import { hostOf } from '../searchProvider.js';
const TIME_RANGE = { day: 'day', week: 'week', month: 'month', any: undefined };
/** Tavily — a search API built for LLM use: https://app.tavily.com */
export class TavilySearchProvider {
    apiKey;
    name = 'tavily';
    enabled = true;
    constructor(apiKey) {
        this.apiKey = apiKey;
    }
    async search(query, options = {}) {
        const body = {
            query: query.slice(0, 400),
            max_results: Math.min(options.count ?? 5, 10),
            search_depth: 'basic',
            include_answer: false,
        };
        const range = TIME_RANGE[options.recency ?? 'any'];
        if (range)
            body.time_range = range;
        const response = await withTimeout(fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
        }), TIMINGS.webSearchTimeoutMs);
        if (!response.ok)
            throw new Error(`Tavily search failed with HTTP ${response.status}`);
        const parsed = (await response.json());
        return (parsed.results ?? [])
            .filter((item) => typeof item.url === 'string')
            .map((item) => ({
            title: item.title ?? item.url ?? 'Untitled',
            url: item.url,
            snippet: (item.content ?? '').slice(0, 600),
            publishedAt: item.published_date,
            host: hostOf(item.url),
        }));
    }
}
//# sourceMappingURL=tavily.js.map