import { neutralizeEnvelope } from './injection.js';

/**
 * Trust tiers. The prompt is assembled from blocks whose tier is stated explicitly, and
 * every block below `system` is wrapped in an envelope that marks it as *data*.
 *
 *   system  > incident > server_policy > server_knowledge
 *           > ticket_context > web_content > user_content
 */
export type TrustTier =
  | 'system'
  | 'incident'
  | 'server_policy'
  | 'server_knowledge'
  | 'ticket_context'
  | 'web_content'
  | 'user_content';

export const TRUST_ORDER: TrustTier[] = [
  'system',
  'incident',
  'server_policy',
  'server_knowledge',
  'ticket_context',
  'web_content',
  'user_content',
];

export function trustRank(tier: TrustTier): number {
  return TRUST_ORDER.indexOf(tier);
}

/** True when `a` outranks `b` and should win a conflict. */
export function outranks(a: TrustTier, b: TrustTier): boolean {
  return trustRank(a) < trustRank(b);
}

export interface EnvelopeOptions {
  /** Extra attributes rendered on the opening tag, e.g. `{ source: 'example.com' }`. */
  attributes?: Record<string, string | number | boolean | undefined>;
  /** Hard character cap; content is truncated with a visible marker. */
  maxChars?: number;
}

function renderAttributes(attributes: Record<string, string | number | boolean | undefined>): string {
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => ` ${key}="${String(value).replace(/"/g, "'").slice(0, 200)}"`)
    .join('');
}

/**
 * Wrap untrusted text in a labelled envelope. Angle brackets and invisible characters
 * inside `content` are neutralised so the payload cannot forge a closing tag or open a
 * fake system block.
 */
export function envelope(tag: string, content: string, options: EnvelopeOptions = {}): string {
  const max = options.maxChars ?? 4000;
  let body = neutralizeEnvelope(content.trim());
  if (body.length > max) body = `${body.slice(0, max)}\n…[truncated]`;
  const attrs = renderAttributes({ untrusted: true, ...(options.attributes ?? {}) });
  return `<${tag}${attrs}>\n${body}\n</${tag}>`;
}

/** Envelope for trusted-but-still-data content (our own DB rows): no `untrusted` flag. */
export function dataBlock(tag: string, content: string, options: EnvelopeOptions = {}): string {
  const max = options.maxChars ?? 4000;
  let body = neutralizeEnvelope(content.trim());
  if (body.length > max) body = `${body.slice(0, max)}\n…[truncated]`;
  const attrs = renderAttributes(options.attributes ?? {});
  return `<${tag}${attrs}>\n${body}\n</${tag}>`;
}
