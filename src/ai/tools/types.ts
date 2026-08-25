import type { Store } from '../../db/repositories/index.js';
import type { KnowledgeEntry, Ticket } from '../../db/types.js';
import type { TicketService } from '../../tickets/service.js';
import type { WebService } from '../../web/service.js';
import type { AIToolSpec } from '../provider.js';

export interface WebCitation {
  title: string;
  url: string;
  host: string;
}

/**
 * Everything a tool is allowed to touch. There is no generic "run code" surface: a tool can
 * only reach the guild it was created for, and the guild id is never taken from model output.
 */
export interface ToolContext {
  store: Store;
  web: WebService;
  tickets: TicketService;
  guildId: string;
  ticket: Ticket;
  /** The member who asked. Used for history scoping and logging, never for authorisation. */
  userId: string;
  askerIsStaff: boolean;
  question: string;
  /** Filled in as tools run, so the agent can report sources and telemetry afterwards. */
  knowledgeUsed: KnowledgeEntry[];
  citations: WebCitation[];
  usedWeb: boolean;
}

export interface ToolDefinition {
  spec: AIToolSpec;
  /** Terminal tools end the agent loop; the loop, not the tool, decides what to do. */
  terminal?: boolean;
  /** Gate: a tool that is not available is never even offered to the model. */
  available?: (ctx: ToolContext) => boolean;
  run?: (args: Record<string, unknown>, ctx: ToolContext) => Promise<Record<string, unknown>>;
}

/** Small helpers for reading model-supplied arguments defensively. */
export function argString(args: Record<string, unknown>, key: string, fallback = ''): string {
  const value = args[key];
  return typeof value === 'string' ? value.trim() : fallback;
}

export function argNumber(args: Record<string, unknown>, key: string, fallback: number): number {
  const value = args[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

export function argStringArray(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value === 'string' && value.trim() !== '') return [value.trim()];
  return [];
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
