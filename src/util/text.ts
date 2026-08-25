import { DISCORD_LIMITS } from '../config/constants.js';

/** Split text into Discord-sized chunks, preferring paragraph then line then word breaks. */
export function chunkMessage(text: string, limit = DISCORD_LIMITS.messageLength): string[] {
  const clean = text.trim();
  if (clean.length <= limit) return clean.length > 0 ? [clean] : [];

  const chunks: string[] = [];
  let rest = clean;

  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    let cut = window.lastIndexOf('\n\n');
    if (cut < limit * 0.5) cut = window.lastIndexOf('\n');
    if (cut < limit * 0.5) cut = window.lastIndexOf(' ');
    if (cut < limit * 0.5) cut = limit;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

export function truncate(text: string, max: number, suffix = '…'): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - suffix.length)).trimEnd() + suffix;
}

/** Collapse a long body into a one-line preview for lists and embeds. */
export function preview(text: string, max = 120): string {
  return truncate(text.replace(/\s+/g, ' ').trim(), max);
}

const DURATION_UNITS: Record<string, number> = {
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
  w: 604_800_000,
  week: 604_800_000,
  weeks: 604_800_000,
};

/** Parse `30m`, `6h`, `3d`, `2 weeks` → milliseconds. Returns null when unparseable. */
export function parseDuration(input: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*([a-z]+)\s*$/i.exec(input);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = DURATION_UNITS[(match[2] ?? '').toLowerCase()];
  if (!unit || !Number.isFinite(amount) || amount <= 0) return null;
  const ms = amount * unit;
  return ms > 0 && ms <= 365 * 86_400_000 ? Math.round(ms) : null;
}

export function formatDuration(ms: number): string {
  if (ms < 0) return 'expired';
  const units: [number, string][] = [
    [86_400_000, 'd'],
    [3_600_000, 'h'],
    [60_000, 'm'],
    [1000, 's'],
  ];
  const parts: string[] = [];
  let rest = ms;
  for (const [size, label] of units) {
    const value = Math.floor(rest / size);
    if (value > 0) {
      parts.push(`${value}${label}`);
      rest -= value * size;
    }
    if (parts.length === 2) break;
  }
  return parts.length > 0 ? parts.join(' ') : '0s';
}

/** Discord relative timestamp, e.g. `<t:1712345678:R>`. */
export function relativeTimestamp(epochMs: number): string {
  return `<t:${Math.floor(epochMs / 1000)}:R>`;
}

export function shortTimestamp(epochMs: number): string {
  return `<t:${Math.floor(epochMs / 1000)}:f>`;
}

/** Strip Discord mentions/emoji markup so learned text stays readable in prompts. */
export function stripDiscordMarkup(text: string): string {
  return text
    .replace(/<a?:(\w+):\d+>/g, ':$1:')
    .replace(/<@!?(\d+)>/g, '@user')
    .replace(/<@&(\d+)>/g, '@role')
    .replace(/<#(\d+)>/g, '#channel')
    .trim();
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
