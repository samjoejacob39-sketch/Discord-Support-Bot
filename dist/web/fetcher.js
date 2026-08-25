import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { TIMINGS } from '../config/constants.js';
import { child } from '../logging/logger.js';
import { withTimeout } from '../util/async.js';
const log = child('web:fetch');
export const MAX_FETCH_BYTES = 512 * 1024;
export const MAX_REDIRECTS = 3;
const ALLOWED_PORTS = new Set(['', '80', '443']);
const ALLOWED_CONTENT_TYPES = [
    'text/html',
    'application/xhtml+xml',
    'text/plain',
    'text/markdown',
    'application/json',
    'application/xml',
    'text/xml',
];
export class UnsafeUrlError extends Error {
    constructor(message) {
        super(message);
        this.name = 'UnsafeUrlError';
    }
}
function ipv4ToInt(address) {
    const parts = address.split('.');
    if (parts.length !== 4)
        return null;
    let value = 0;
    for (const part of parts) {
        const octet = Number(part);
        if (!Number.isInteger(octet) || octet < 0 || octet > 255)
            return null;
        value = value * 256 + octet;
    }
    return value;
}
const BLOCKED_V4 = [
    ['0.0.0.0', 8], // "this network"
    ['10.0.0.0', 8], // private
    ['100.64.0.0', 10], // CGNAT
    ['127.0.0.0', 8], // loopback
    ['169.254.0.0', 16], // link-local (incl. cloud metadata)
    ['172.16.0.0', 12], // private
    ['192.0.0.0', 24], // IETF protocol assignments
    ['192.0.2.0', 24], // TEST-NET-1
    ['192.88.99.0', 24], // 6to4 relay
    ['192.168.0.0', 16], // private
    ['198.18.0.0', 15], // benchmarking
    ['198.51.100.0', 24], // TEST-NET-2
    ['203.0.113.0', 24], // TEST-NET-3
    ['224.0.0.0', 4], // multicast
    ['240.0.0.0', 4], // reserved
];
/** True when an IP literal points somewhere the bot must never reach (SSRF guard). */
export function isBlockedAddress(address) {
    const family = isIP(address);
    if (family === 0)
        return true;
    if (family === 4) {
        const value = ipv4ToInt(address);
        if (value === null)
            return true;
        return BLOCKED_V4.some(([network, bits]) => {
            const base = ipv4ToInt(network);
            if (base === null)
                return false;
            const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
            return (value & mask) === (base & mask);
        });
    }
    const normalized = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
    if (mapped?.[1])
        return isBlockedAddress(mapped[1]);
    if (normalized === '::' || normalized === '::1')
        return true;
    if (/^f[cd][0-9a-f]{2}:/.test(normalized))
        return true; // unique-local fc00::/7
    if (/^fe[89ab][0-9a-f]:/.test(normalized))
        return true; // link-local fe80::/10
    if (/^ff[0-9a-f]{2}:/.test(normalized))
        return true; // multicast
    if (/^(64:ff9b|2002:|2001:0?db8)/.test(normalized))
        return true; // translation/doc ranges
    return false;
}
/** Parse and structurally validate a URL before any DNS or network activity. */
export function assertSafeUrlShape(raw) {
    let url;
    try {
        url = new URL(raw.trim());
    }
    catch {
        throw new UnsafeUrlError('That is not a valid URL.');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new UnsafeUrlError('Only http and https URLs can be fetched.');
    }
    if (!ALLOWED_PORTS.has(url.port)) {
        throw new UnsafeUrlError('Only the standard web ports (80/443) can be fetched.');
    }
    if (url.username || url.password) {
        throw new UnsafeUrlError('URLs with embedded credentials are not fetched.');
    }
    if (url.hostname.endsWith('.local') || url.hostname === 'localhost') {
        throw new UnsafeUrlError('Local hostnames cannot be fetched.');
    }
    return url;
}
/** Resolve the hostname and reject if any address is private/loopback/reserved. */
export async function assertResolvesPublicly(url) {
    if (isIP(url.hostname) !== 0) {
        if (isBlockedAddress(url.hostname))
            throw new UnsafeUrlError('That address is not publicly routable.');
        return;
    }
    let addresses;
    try {
        addresses = await withTimeout(lookup(url.hostname, { all: true, verbatim: true }), 5000);
    }
    catch {
        throw new UnsafeUrlError(`Could not resolve ${url.hostname}.`);
    }
    if (addresses.length === 0)
        throw new UnsafeUrlError(`Could not resolve ${url.hostname}.`);
    for (const entry of addresses) {
        if (isBlockedAddress(entry.address)) {
            throw new UnsafeUrlError('That hostname resolves to a private or reserved address.');
        }
    }
}
const HTML_ENTITIES = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&#x27;': "'",
    '&nbsp;': ' ',
    '&mdash;': '—',
    '&ndash;': '–',
    '&hellip;': '…',
};
/** Very small HTML→text reducer: drops non-content elements and collapses whitespace. */
export function htmlToText(html) {
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    const text = html
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<(script|style|noscript|svg|canvas|iframe|template)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<(nav|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote)>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<li[^>]*>/gi, '• ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/&[a-z#0-9]+;/gi, (entity) => HTML_ENTITIES[entity.toLowerCase()] ?? ' ')
        .replace(/[ \t ]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .split('\n')
        .map((line) => line.trim())
        .filter((line, index, lines) => line.length > 0 || lines[index - 1] !== '')
        .join('\n')
        .trim();
    return { title: titleMatch?.[1]?.replace(/\s+/g, ' ').trim(), text };
}
async function readCapped(response) {
    const reader = response.body?.getReader();
    if (!reader)
        return { body: '', truncated: false };
    const decoder = new TextDecoder('utf-8', { fatal: false });
    let received = 0;
    let body = '';
    let truncated = false;
    while (received < MAX_FETCH_BYTES) {
        const { done, value } = await reader.read();
        if (done)
            break;
        if (!value)
            continue;
        received += value.byteLength;
        if (received > MAX_FETCH_BYTES) {
            const keep = value.subarray(0, value.byteLength - (received - MAX_FETCH_BYTES));
            body += decoder.decode(keep, { stream: false });
            truncated = true;
            break;
        }
        body += decoder.decode(value, { stream: true });
    }
    await reader.cancel().catch(() => undefined);
    return { body, truncated };
}
/**
 * Fetch a public webpage with SSRF protection: every hop is shape-checked and DNS-checked
 * before the request is made, redirects are followed manually, and the body is size- and
 * time-capped. The returned text is *data* — callers must wrap it as untrusted content.
 */
export async function fetchWebpage(rawUrl) {
    let target = assertSafeUrlShape(rawUrl);
    const requestedUrl = target.toString();
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        await assertResolvesPublicly(target);
        const response = await withTimeout(fetch(target, {
            redirect: 'manual',
            headers: {
                'User-Agent': 'ShinchatHelper/1.0 (Discord support bot; +https://github.com/)',
                Accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.1',
                'Accept-Language': 'en',
            },
        }), TIMINGS.webFetchTimeoutMs);
        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location');
            await response.body?.cancel().catch(() => undefined);
            if (!location)
                throw new UnsafeUrlError('Redirect without a destination.');
            if (hop === MAX_REDIRECTS)
                throw new UnsafeUrlError('Too many redirects.');
            target = assertSafeUrlShape(new URL(location, target).toString());
            continue;
        }
        const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
        if (!response.ok) {
            await response.body?.cancel().catch(() => undefined);
            throw new Error(`The page returned HTTP ${response.status}.`);
        }
        if (!ALLOWED_CONTENT_TYPES.some((allowed) => contentType.includes(allowed))) {
            await response.body?.cancel().catch(() => undefined);
            throw new Error(`Unsupported content type: ${contentType || 'unknown'}.`);
        }
        const { body, truncated } = await readCapped(response);
        const isHtml = contentType.includes('html') || contentType.includes('xml');
        const parsed = isHtml ? htmlToText(body) : { text: body.trim(), title: undefined };
        log.debug({ url: target.toString(), bytes: body.length, truncated }, 'fetched page');
        return {
            requestedUrl,
            finalUrl: target.toString(),
            host: target.hostname.replace(/^www\./, ''),
            status: response.status,
            contentType,
            title: parsed.title,
            text: parsed.text,
            truncated,
        };
    }
    throw new UnsafeUrlError('Too many redirects.');
}
//# sourceMappingURL=fetcher.js.map