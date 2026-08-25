import { collectSecretValues, getEnv } from '../config/env.js';

/**
 * Outbound secret scrubbing. Anything the bot is about to say in Discord (or write to a
 * log) passes through here, so a compromised prompt or a confused model still cannot leak
 * a configured credential.
 */

let secretValues: string[] = [];

/** Well-known credential shapes, redacted even if they are not our own keys. */
const SECRET_PATTERNS: RegExp[] = [
  /AIza[0-9A-Za-z_-]{30,}/g, // Google API key
  /\b[MNO][A-Za-z\d]{23,27}\.[\w-]{6}\.[\w-]{27,}\b/g, // Discord bot token
  /\bsk-[A-Za-z0-9]{20,}\b/g, // OpenAI-style key
  /\bBSA[A-Za-z0-9_-]{20,}\b/g, // Brave Search key
  /\btvly-[A-Za-z0-9_-]{16,}\b/g, // Tavily key
  /\bghp_[A-Za-z0-9]{30,}\b/g, // GitHub token
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack token
];

export function initRedaction(values: string[] = collectSecretValues(getEnv())): void {
  secretValues = [...new Set(values.filter((value) => value.length >= 12))].sort((a, b) => b.length - a.length);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replace every configured secret value and known credential shape with `[redacted]`. */
export function redact(text: string): string {
  if (!text) return text;
  let output = text;
  for (const value of secretValues) {
    output = output.replace(new RegExp(escapeRegex(value), 'g'), '[redacted]');
  }
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, '[redacted]');
  }
  return output;
}

export function containsSecret(text: string): boolean {
  return redact(text) !== text;
}

/** For status displays: prove a key is configured without revealing any of it. */
export function maskKey(value: string | undefined): string {
  if (!value) return 'not set';
  if (value.length <= 8) return 'set';
  return `set (…${value.slice(-4)})`;
}

/** Test hook. */
export function resetRedaction(): void {
  secretValues = [];
}
