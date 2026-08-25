/**
 * Internal confidence handling. The level never reaches the member: it decides whether the bot
 * answers, hedges, or hands over to a human (spec §25 — guessing is worse than escalating).
 */
export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export function parseConfidence(value: unknown, fallback: Confidence = 'medium'): Confidence {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  return (CONFIDENCE_LEVELS as readonly string[]).includes(normalized) ? (normalized as Confidence) : fallback;
}

/** Phrases that mean "get me a person" regardless of how the model felt about its answer. */
const HUMAN_REQUEST_PATTERNS = [
  /\b(human|person|real (person|human)|someone real)\b/i,
  /\b(speak|talk|chat|connect|put me through|transfer)\b[^.?!]{0,24}\b(to|with|me to)?\s*(an?\s+)?(human|person|admin|administrator|moderator|mod|staff|support (team|agent)|agent|owner)\b/i,
  /\b(admin|moderator|mod|staff)\b[^.?!]{0,16}\b(please|help|now|here)\b/i,
  /\b(i want|i need|can i get|get me|give me|is there)\b[^.?!]{0,24}\b(human|person|admin|moderator|staff|agent)\b/i,
  /\b(stop|no more)\b[^.?!]{0,16}\b(bot|ai|robot)\b/i,
  /\b(escalate|ticket to staff|open a ticket with staff)\b/i,
];

export function requestsHuman(text: string): boolean {
  return HUMAN_REQUEST_PATTERNS.some((pattern) => pattern.test(text));
}

/** Frustration signals used to de-escalate and to prefer a human sooner (§43). */
const FRUSTRATION_PATTERNS = [
  /\b(useless|garbage|trash|stupid|idiot|nonsense|ridiculous)\b/i,
  /\b(this is|that'?s)\s+(not helping|no help|unacceptable|a joke)\b/i,
  /\b(i (already|just) (said|told you|explained))\b/i,
  /\b(fed up|sick of|tired of|frustrat(ed|ing)|angry|furious)\b/i,
  /\b(wtf|wth|ffs)\b/i,
  /(!{3,})/,
];

export function looksFrustrated(text: string): boolean {
  if (FRUSTRATION_PATTERNS.some((pattern) => pattern.test(text))) return true;
  const letters = text.replace(/[^a-z]/gi, '');
  // Sustained shouting, not a single acronym.
  return letters.length >= 12 && letters === letters.toUpperCase();
}

export interface EscalationJudgement {
  escalate: boolean;
  reason: string;
}

/**
 * Deterministic guard applied *after* the model answers, so a low-confidence reply or a repeated
 * failure cannot slip through even if the model tried to answer anyway.
 */
export function judgeAfterAnswer(input: {
  confidence: Confidence;
  attemptsUsed: number;
  maxAttempts: number;
  userText: string;
}): EscalationJudgement {
  if (requestsHuman(input.userText)) return { escalate: true, reason: 'The member asked to speak to a human.' };
  if (input.confidence === 'low') {
    return { escalate: true, reason: 'The AI was not confident enough to answer reliably.' };
  }
  if (input.attemptsUsed >= input.maxAttempts && input.confidence !== 'high') {
    return {
      escalate: true,
      reason: `The AI has tried ${input.attemptsUsed} times without resolving the issue.`,
    };
  }
  if (looksFrustrated(input.userText) && input.confidence !== 'high') {
    return { escalate: true, reason: 'The member is frustrated and the AI cannot answer confidently.' };
  }
  return { escalate: false, reason: '' };
}
