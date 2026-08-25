import { describe, expect, it } from 'vitest';
import { DISCORD_LIMITS } from '../src/config/constants.js';
import {
  chunkMessage,
  formatDuration,
  parseDuration,
  pluralize,
  preview,
  relativeTimestamp,
  shortTimestamp,
  stripDiscordMarkup,
  truncate,
} from '../src/util/text.js';
import {
  CATEGORY_SLUGS,
  categoryCatalogue,
  categoryChoices,
  categoryLabel,
  getCategory,
  isCategory,
} from '../src/knowledge/categories.js';
import { summariseEntries } from '../src/knowledge/retrieval.js';
import { fatalLines } from '../src/util/exit.js';

describe('message chunking respects Discord limits (§31, §45)', () => {
  it('leaves a short message alone and drops an empty one', () => {
    expect(chunkMessage('Hello there.')).toEqual(['Hello there.']);
    expect(chunkMessage('   ')).toEqual([]);
  });

  it('never emits a chunk over the limit and loses no words', () => {
    const paragraph = `${'This is a sentence about refunds. '.repeat(40)}\n\n${'And another paragraph about billing. '.repeat(40)}`;
    const chunks = chunkMessage(paragraph, 500);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(500);
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toContain('This is a sentence about refunds.');
    expect(chunks.join(' ')).toContain('And another paragraph about billing.');
  });

  it('prefers a paragraph break over cutting mid-word', () => {
    const text = `${'a'.repeat(300)}\n\n${'b'.repeat(300)}`;
    const chunks = chunkMessage(text, 400);
    expect(chunks[0]).toBe('a'.repeat(300));
    expect(chunks[1]).toBe('b'.repeat(300));
  });

  it('still splits text with no whitespace at all', () => {
    const chunks = chunkMessage('x'.repeat(2500), 1000);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((chunk) => chunk.length <= 1000)).toBe(true);
    expect(chunks.join('').length).toBe(2500);
  });

  it('defaults to Discord’s real message ceiling', () => {
    expect(DISCORD_LIMITS.messageLength).toBe(2000);
    for (const chunk of chunkMessage('word '.repeat(1200))) {
      expect(chunk.length).toBeLessThanOrEqual(DISCORD_LIMITS.messageLength);
    }
  });
});

describe('text helpers', () => {
  it('truncates with an ellipsis and never past the maximum', () => {
    expect(truncate('short', 10)).toBe('short');
    const cut = truncate('a'.repeat(50), 10);
    expect(cut).toHaveLength(10);
    expect(cut.endsWith('…')).toBe(true);
    expect(truncate('hello world', 8, '...')).toBe('hello...');
  });

  it('flattens whitespace for one-line previews', () => {
    expect(preview('  line one\n\nline   two  ')).toBe('line one line two');
    expect(preview('x'.repeat(200)).length).toBe(120);
  });

  it('cleans Discord markup without mangling ordinary text', () => {
    expect(stripDiscordMarkup('hi <@123> and <@!456> in <#789> with <@&12> <:wave:99>')).toBe(
      'hi @user and @user in #channel with @role :wave:',
    );
    expect(stripDiscordMarkup('a < b and 3 > 2')).toBe('a < b and 3 > 2');
  });

  it('embeds the count in a pluralised phrase exactly once', () => {
    expect(pluralize(1, 'entry', 'entries')).toBe('1 entry');
    expect(pluralize(3, 'entry', 'entries')).toBe('3 entries');
    expect(pluralize(0, 'ticket')).toBe('0 tickets');
  });

  it('renders Discord timestamp markup from epoch milliseconds', () => {
    expect(relativeTimestamp(1_700_000_000_123)).toBe('<t:1700000000:R>');
    expect(shortTimestamp(1_700_000_000_123)).toBe('<t:1700000000:f>');
  });
});

describe('duration parsing for temporary knowledge (§19, §20)', () => {
  it('accepts the shapes an admin would actually type', () => {
    expect(parseDuration('30m')).toBe(1_800_000);
    expect(parseDuration('90 mins')).toBe(5_400_000);
    expect(parseDuration('6h')).toBe(21_600_000);
    expect(parseDuration('12 hours')).toBe(43_200_000);
    expect(parseDuration('3d')).toBe(259_200_000);
    expect(parseDuration('2 weeks')).toBe(1_209_600_000);
    expect(parseDuration('1.5h')).toBe(5_400_000);
  });

  it('rejects nonsense and refuses an unbounded lifetime', () => {
    for (const input of ['', 'soon', '5', 'm', '0h', '-3d', '10 fortnights', '3 days please', '400d', '60 weeks']) {
      expect(parseDuration(input), input).toBeNull();
    }
    // Exactly one year is still allowed; beyond it is not.
    expect(parseDuration('365d')).toBe(365 * 86_400_000);
    expect(parseDuration('366d')).toBeNull();
  });

  it('formats a remaining lifetime compactly', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(-1)).toBe('expired');
    expect(formatDuration(90_000)).toBe('1m 30s');
    expect(formatDuration(90_061_000)).toBe('1d 1h');
  });
});

describe('the knowledge catalogue is coherent (§6)', () => {
  it('exposes unique slugs with a label, emoji and classifier hint each', () => {
    expect(new Set(CATEGORY_SLUGS).size).toBe(CATEGORY_SLUGS.length);
    expect(CATEGORY_SLUGS.length).toBeGreaterThanOrEqual(10);

    for (const slug of CATEGORY_SLUGS) {
      const category = getCategory(slug);
      expect(category.slug, slug).toBe(slug);
      expect(category.label, slug).not.toHaveLength(0);
      expect(category.emoji, slug).not.toHaveLength(0);
      expect(category.hint, slug).not.toHaveLength(0);
      expect(isCategory(slug)).toBe(true);
    }

    // Staff instructions default to staff-only visibility, so they guide the bot
    // without ever being quoted back to a member (§6).
    expect(getCategory('staff').defaultVisibility).toBe('staff');
  });

  it('falls back to a real category for an unknown slug and lists every slug for the classifier', () => {
    expect(isCategory('definitely-not-a-category')).toBe(false);
    expect(getCategory('definitely-not-a-category').slug).toBe('other');
    expect(categoryLabel('policies')).toContain('Policies');

    const catalogue = categoryCatalogue();
    for (const slug of CATEGORY_SLUGS) expect(catalogue).toContain(slug);

    // Discord allows at most 25 choices on an option.
    const choices = categoryChoices();
    expect(choices).toHaveLength(CATEGORY_SLUGS.length);
    expect(choices.length).toBeLessThanOrEqual(25);
    expect(choices.map((choice) => choice.value)).toEqual([...CATEGORY_SLUGS]);
  });

  it('summarises an empty knowledge set honestly', () => {
    expect(summariseEntries([])).toContain('Nothing yet');
  });
});

describe('a first-run operator gets a readable failure (§60)', () => {
  it('prints a multi-line configuration error one key per line, dropping blanks', () => {
    const lines: string[] = [];
    fatalLines({ fatal: (message: string) => lines.push(message) }, 'startup failed', [
      'Invalid environment configuration:',
      '  - LOG_LEVEL: expected one of "trace"|"info"',
      '',
      '  - DISCORD_TOKEN: required',
    ].join('\n'));

    expect(lines[0]).toBe('startup failed');
    expect(lines).toHaveLength(4);
    expect(lines.some((line) => line.includes('LOG_LEVEL'))).toBe(true);
    expect(lines.some((line) => line.includes('DISCORD_TOKEN'))).toBe(true);
    // No escaped newline blob — each line stands on its own.
    for (const line of lines) expect(line).not.toContain('\n');
  });
});
