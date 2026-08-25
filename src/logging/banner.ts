/**
 * The startup banner.
 *
 * Structured JSON is the right thing for a log aggregator and the wrong thing for a human
 * watching a terminal, so the two are separated: pino still emits machine-readable lines for
 * everything that happens afterwards, while this writes one readable block straight to stdout
 * when the bot comes up. It is the first thing an operator — or someone being shown the
 * project — actually looks at.
 */

const WIDTH = 60;

/** Colour only when a real terminal is attached, so piped output and journald stay clean. */
const tty = process.stdout.isTTY === true;
const ESC = String.fromCharCode(27);
const paint = (code: string, text: string): string => (tty ? ESC + "[" + code + "m" + text + ESC + "[0m" : text);

const dim = (text: string): string => paint('2', text);
const bold = (text: string): string => paint('1', text);
const cyan = (text: string): string => paint('36', text);
const green = (text: string): string => paint('32', text);
const yellow = (text: string): string => paint('33', text);

export interface BannerFacts {
  botTag: string;
  guildCount: number;
  provider: string;
  model: string;
  webSearch: string;
  webFetch: boolean;
  database: string;
  environment: string;
  degraded?: string | undefined;
}

/** Pad to the banner's inner width, measuring the text before any colour codes are added. */
function row(label: string, value: string, colour: (text: string) => string = (t) => t): string {
  const plain = `  ${label.padEnd(13)}${value}`;
  const padding = ' '.repeat(Math.max(0, WIDTH - plain.length));
  return `${dim('│')}  ${bold(label.padEnd(13))}${colour(value)}${padding}${dim('│')}`;
}

function divider(left: string, right: string): string {
  return dim(`${left}${'─'.repeat(WIDTH)}${right}`);
}

function centred(text: string, colour: (t: string) => string): string {
  const left = Math.max(0, Math.floor((WIDTH - text.length) / 2));
  const right = Math.max(0, WIDTH - text.length - left);
  return `${dim('│')}${' '.repeat(left)}${colour(text)}${' '.repeat(right)}${dim('│')}`;
}

/**
 * Render the banner as lines. Kept separate from printing so a test can assert on the content
 * without capturing stdout.
 */
export function renderBanner(facts: BannerFacts): string[] {
  const search = facts.webSearch === 'none' ? 'off' : facts.webSearch;
  const lines = [
    '',
    divider('┌', '┐'),
    centred('SHINCHAT HELPER', (t) => bold(cyan(t))),
    centred('Discord AI Support & Knowledge Bot', dim),
    divider('├', '┤'),
    row('Status', `● ONLINE  ${facts.botTag}`, green),
    row('Servers', String(facts.guildCount)),
    row('AI', `${facts.provider} · ${facts.model}`),
    row('Web', `search ${search} · fetch ${facts.webFetch ? 'on' : 'off'}`),
    row('Database', facts.database),
    row('Mode', facts.environment),
  ];

  if (facts.degraded) {
    lines.push(divider('├', '┤'), row('Warning', facts.degraded, yellow));
  }

  lines.push(
    divider('├', '┤'),
    centred('Ask in any ticket channel — no command needed.', dim),
    divider('└', '┘'),
    '',
  );
  return lines;
}

/** Write the banner to stdout, bypassing the logger so no JSON wrapping gets in the way. */
export function printBanner(facts: BannerFacts): void {
  process.stdout.write(`${renderBanner(facts).join('\n')}\n`);
}
