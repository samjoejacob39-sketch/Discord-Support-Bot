import { neutralizeEnvelope } from './injection.js';
export const TRUST_ORDER = [
    'system',
    'incident',
    'server_policy',
    'server_knowledge',
    'ticket_context',
    'web_content',
    'user_content',
];
export function trustRank(tier) {
    return TRUST_ORDER.indexOf(tier);
}
/** True when `a` outranks `b` and should win a conflict. */
export function outranks(a, b) {
    return trustRank(a) < trustRank(b);
}
function renderAttributes(attributes) {
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
export function envelope(tag, content, options = {}) {
    const max = options.maxChars ?? 4000;
    let body = neutralizeEnvelope(content.trim());
    if (body.length > max)
        body = `${body.slice(0, max)}\n…[truncated]`;
    const attrs = renderAttributes({ untrusted: true, ...(options.attributes ?? {}) });
    return `<${tag}${attrs}>\n${body}\n</${tag}>`;
}
/** Envelope for trusted-but-still-data content (our own DB rows): no `untrusted` flag. */
export function dataBlock(tag, content, options = {}) {
    const max = options.maxChars ?? 4000;
    let body = neutralizeEnvelope(content.trim());
    if (body.length > max)
        body = `${body.slice(0, max)}\n…[truncated]`;
    const attrs = renderAttributes(options.attributes ?? {});
    return `<${tag}${attrs}>\n${body}\n</${tag}>`;
}
//# sourceMappingURL=trust.js.map