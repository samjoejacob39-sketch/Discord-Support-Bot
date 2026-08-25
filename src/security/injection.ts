/**
 * Prompt-injection heuristics.
 *
 * These are *signals*, never enforcement: nothing in the prompt is executed because it
 * looks safe, and nothing is silently deleted because it looks suspicious. Suspicious
 * `/learn` entries are stored but flagged, and the admin is told that server knowledge is
 * treated as policy data and can never override system safety rules.
 */

const INJECTION_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /ignore\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+(instructions|prompts|rules)/i, label: 'override-instructions' },
  { pattern: /disregard\s+(your|all|the)\s+(rules|instructions|guidelines|system)/i, label: 'override-instructions' },
  { pattern: /(reveal|show|print|expose|leak|dump|repeat)\s+(me\s+)?(your\s+|the\s+)?(system\s+)?(prompt|instructions|rules|configuration)/i, label: 'prompt-extraction' },
  { pattern: /(reveal|show|give|send|print|leak|dump)\s+(me\s+)?(the\s+|your\s+|our\s+)?(api[\s_-]?keys?|tokens?|secrets?|credentials?|passwords?|env(ironment)?\s+variables?)/i, label: 'secret-extraction' },
  { pattern: /you\s+are\s+now\s+(a|an|the)\s+/i, label: 'role-reassignment' },
  { pattern: /\b(developer|debug|god|admin)\s+mode\b/i, label: 'role-reassignment' },
  { pattern: /(pretend|act\s+as\s+if|imagine)\s+(you\s+)?(are|have)\s+no\s+(rules|restrictions|guidelines)/i, label: 'jailbreak' },
  { pattern: /\bDAN\b.{0,20}\b(mode|jailbreak)\b/i, label: 'jailbreak' },
  { pattern: /(new|updated)\s+system\s+(prompt|instructions?)\s*[:=]/i, label: 'fake-system-turn' },
  { pattern: /^\s*(system|assistant)\s*[:>]/im, label: 'fake-system-turn' },
  { pattern: /<\/?(system|system_instructions?|safety_rules)>/i, label: 'tag-spoofing' },
  { pattern: /i\s+am\s+(the\s+)?(owner|admin|administrator|developer)\b.{0,60}\b(so|therefore|now)\b/i, label: 'authority-claim' },
];

export interface InjectionScan {
  suspicious: boolean;
  labels: string[];
}

export function scanForInjection(text: string): InjectionScan {
  const labels = new Set<string>();
  for (const { pattern, label } of INJECTION_PATTERNS) {
    if (pattern.test(text)) labels.add(label);
  }
  return { suspicious: labels.size > 0, labels: [...labels] };
}

/** Zero-width and bidirectional control characters used to smuggle hidden instructions. */
const HIDDEN_CHARS = /[​-‏‪-‮⁠-⁤﻿]/g;

/**
 * Neutralise characters that could break out of the XML-ish envelopes used to mark
 * untrusted content in the prompt. Content is preserved; only the delimiters are made
 * unspoofable.
 */
export function neutralizeEnvelope(text: string): string {
  return text.replace(HIDDEN_CHARS, '').replace(/</g, '‹').replace(/>/g, '›');
}

/** Warning shown to an admin whose /learn text looks like an override attempt. */
export function injectionWarning(labels: string[]): string {
  const explanations: Record<string, string> = {
    'override-instructions': 'it tries to override the bot’s instructions',
    'prompt-extraction': 'it asks the bot to reveal its own instructions',
    'secret-extraction': 'it asks the bot to reveal secrets or credentials',
    'role-reassignment': 'it tries to reassign the bot’s role',
    jailbreak: 'it looks like a jailbreak attempt',
    'fake-system-turn': 'it imitates a system message',
    'tag-spoofing': 'it imitates the bot’s internal formatting',
    'authority-claim': 'it asserts authority to bypass rules',
  };
  const reasons = labels.map((label) => explanations[label] ?? label);
  return `Stored, but flagged: ${reasons.join(', ')}. Server knowledge is used as **policy data**, so it can never override the bot’s safety, privacy or secret-handling rules.`;
}
