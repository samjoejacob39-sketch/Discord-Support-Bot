import type { SupportMode } from '../config/constants.js';

export type { SupportMode };

export interface GuildRow {
  guildId: string;
  name: string | null;
  joinedAt: number;
  leftAt: number | null;
}

export interface GuildSettings {
  guildId: string;
  supportMode: SupportMode;
  aiEnabled: boolean;
  trustedRoleId: string | null;
  adminPingRoleId: string | null;
  supportChannelIds: string[];
  supportCategoryIds: string[];
  escalationChannelId: string | null;
  personaNote: string | null;
  maxAiAttempts: number;
  updatedAt: number;
}

export interface ShinAdmin {
  guildId: string;
  userId: string;
  addedBy: string;
  addedAt: number;
}

export type KnowledgeKind = 'permanent' | 'temporary' | 'incident';
export type KnowledgeStatus = 'active' | 'inactive' | 'expired';
export type KnowledgeVisibility = 'public' | 'staff';

export interface KnowledgeEntry {
  id: number;
  guildId: string;
  category: string;
  kind: KnowledgeKind;
  status: KnowledgeStatus;
  visibility: KnowledgeVisibility;
  title: string;
  content: string;
  priority: number;
  flagged: boolean;
  expiresAt: number | null;
  createdBy: string;
  createdAt: number;
  updatedBy: string | null;
  updatedAt: number;
}

export interface NewKnowledgeEntry {
  guildId: string;
  category: string;
  kind: KnowledgeKind;
  visibility?: KnowledgeVisibility;
  title: string;
  content: string;
  priority?: number;
  flagged?: boolean;
  expiresAt?: number | null;
  createdBy: string;
}

export const TICKET_STATES = [
  'NEW',
  'AI_ACTIVE',
  'WAITING_FOR_ADMIN',
  'ADMIN_ACTIVE',
  'AI_PAUSED',
  'RESOLVED',
  'CLOSED',
] as const;
export type TicketState = (typeof TICKET_STATES)[number];

export interface Ticket {
  id: number;
  guildId: string;
  channelId: string;
  parentId: string | null;
  openerUserId: string;
  subject: string | null;
  state: TicketState;
  aiAttempts: number;
  escalationCount: number;
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
  closedAt: number | null;
}

export type AuthorKind = 'user' | 'bot' | 'admin';

export interface TicketMessage {
  id: number;
  ticketId: number;
  guildId: string;
  discordMessageId: string | null;
  authorId: string;
  authorKind: AuthorKind;
  content: string;
  createdAt: number;
}

export interface TicketSummary {
  id: number;
  ticketId: number;
  guildId: string;
  summary: string;
  throughMessageId: number;
  createdAt: number;
}

export interface TicketFact {
  id: number;
  ticketId: number;
  guildId: string;
  label: string;
  value: string;
  createdAt: number;
}

export type EscalationTrigger =
  | 'ai_low_confidence'
  | 'ai_requested'
  | 'user_requested'
  | 'attempt_limit'
  | 'provider_failure'
  | 'admin_forced';

export interface Escalation {
  id: number;
  ticketId: number;
  guildId: string;
  trigger: EscalationTrigger;
  reason: string;
  summary: string | null;
  recommendedAction: string | null;
  notifiedUserIds: string[];
  createdAt: number;
  resolvedAt: number | null;
  resolvedBy: string | null;
}

export interface AuditEntry {
  id: number;
  guildId: string;
  actorId: string;
  action: string;
  target: string | null;
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface AiInteractionRecord {
  guildId: string;
  ticketId: number | null;
  userId: string;
  model: string;
  confidence: string | null;
  escalated: boolean;
  usedWeb: boolean;
  toolCalls: string[];
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
}
