import type { SearchResult } from './searchProvider.js';

/**
 * Source-quality ranking. Primary sources (status pages, vendor docs, release notes) beat
 * aggregators and content farms, so the bot quotes the thing that is actually
 * authoritative rather than the first page a search engine returned.
 */

const HIGH_TRUST: { pattern: RegExp; score: number; label: string }[] = [
  { pattern: /(^|\.)status\.|(^|\.)statuspage\.io$|(^|\.)status\.io$|(^|\.)incident\./i, score: 45, label: 'status page' },
  { pattern: /^discordstatus\.com$|^status\.discord\.com$/i, score: 55, label: 'official status page' },
  { pattern: /(^|\.)docs\.|(^|\.)developer\.|(^|\.)developers\.|(^|\.)learn\./i, score: 35, label: 'official docs' },
  { pattern: /^github\.com$|^raw\.githubusercontent\.com$/i, score: 30, label: 'source repository' },
  { pattern: /^(www\.)?npmjs\.com$|^pypi\.org$|^crates\.io$|^hub\.docker\.com$/i, score: 28, label: 'package registry' },
  { pattern: /(^|\.)support\.|(^|\.)help\.|(^|\.)kb\./i, score: 22, label: 'vendor support' },
  { pattern: /(^|\.)blog\.|(^|\.)news\.|(^|\.)announcements?\./i, score: 18, label: 'official announcement' },
  { pattern: /\.gov$|\.gov\.[a-z]{2}$|\.edu$/i, score: 20, label: 'institutional' },
  { pattern: /^en\.wikipedia\.org$/i, score: 12, label: 'encyclopedia' },
];

const LOW_TRUST: { pattern: RegExp; score: number }[] = [
  { pattern: /^(www\.)?(pinterest|quora|answers|ehow|wikihow|coursehero|scribd)\./i, score: -30 },
  { pattern: /(^|\.)blogspot\.|(^|\.)wordpress\.com$|(^|\.)medium\.com$|(^|\.)substack\.com$/i, score: -12 },
  { pattern: /^(www\.)?reddit\.com$|(^|\.)stackexchange\.com$|^(www\.)?stackoverflow\.com$/i, score: -4 },
  { pattern: /(^|\.)(cracked|nulled|warez|freedownload)/i, score: -60 },
];

export interface ScoredResult extends SearchResult {
  score: number;
  quality: string;
}

const OUTAGE_INTENT = /\b(outage|down|offline|status|incident|degraded|not working)\b/i;
const VERSION_INTENT = /\b(version|release|changelog|update|latest|patch)\b/i;

export function scoreResult(result: SearchResult, query = '', index = 0): ScoredResult {
  let score = 100 - index * 6; // preserve some of the engine's own ordering
  let quality = 'general';

  for (const rule of HIGH_TRUST) {
    if (rule.pattern.test(result.host)) {
      score += rule.score;
      quality = rule.label;
      break;
    }
  }
  for (const rule of LOW_TRUST) {
    if (rule.pattern.test(result.host)) {
      score += rule.score;
      quality = 'low-signal';
      break;
    }
  }

  if (OUTAGE_INTENT.test(query) && /status|incident/i.test(`${result.host}${result.url}`)) score += 25;
  if (VERSION_INTENT.test(query) && /releases?|changelog|tags/i.test(result.url)) score += 20;
  if (result.publishedAt) score += 4;

  return { ...result, score, quality };
}

/** Highest-quality results first, de-duplicated by host+path. */
export function rankResults(results: SearchResult[], query = ''): ScoredResult[] {
  const seen = new Set<string>();
  const scored: ScoredResult[] = [];

  results.forEach((result, index) => {
    const key = `${result.host}${new URL(result.url, 'https://x').pathname}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    scored.push(scoreResult(result, query, index));
  });

  return scored.sort((a, b) => b.score - a.score);
}
