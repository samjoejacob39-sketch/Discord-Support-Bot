import type { KnowledgeVisibility } from '../db/types.js';

export interface CategoryDefinition {
  slug: string;
  label: string;
  emoji: string;
  /** Shown to the classifier so it can pick sensibly. */
  hint: string;
  defaultVisibility?: KnowledgeVisibility;
}

export const CATEGORIES: CategoryDefinition[] = [
  { slug: 'general', label: 'General Knowledge', emoji: '📘', hint: 'Background facts that are not specific to the service.' },
  { slug: 'service', label: 'Service Information', emoji: '🧩', hint: 'What the product/service is, how it works, links, features.' },
  { slug: 'faq', label: 'FAQ', emoji: '❓', hint: 'A question members ask often, plus its answer.' },
  { slug: 'troubleshooting', label: 'Troubleshooting', emoji: '🛠️', hint: 'A known problem and the steps that fix it.' },
  { slug: 'rules', label: 'Rules', emoji: '📜', hint: 'Community rules and moderation expectations.' },
  { slug: 'policies', label: 'Policies', emoji: '⚖️', hint: 'Business policy: refunds, warranties, data handling, bans.' },
  { slug: 'terminology', label: 'Terminology', emoji: '🔤', hint: 'What a community-specific word or abbreviation means.' },
  { slug: 'commands', label: 'Commands', emoji: '⌨️', hint: 'Bot/game/panel commands members can run.' },
  { slug: 'pricing', label: 'Pricing', emoji: '💳', hint: 'Prices, plans, billing cycles, payment methods.' },
  { slug: 'accounts', label: 'Account Information', emoji: '👤', hint: 'Licences, logins, account recovery, verification.' },
  {
    slug: 'staff',
    label: 'Internal Staff Instructions',
    emoji: '🔒',
    hint: 'How staff/the bot should behave. Guides the bot but is never quoted to members.',
    defaultVisibility: 'staff',
  },
  { slug: 'incidents', label: 'Current / Temporary Information', emoji: '🚨', hint: 'An outage, maintenance window or other temporary situation with an end date.' },
  { slug: 'other', label: 'Other', emoji: '🗂️', hint: 'Anything that does not fit another category.' },
];

const BY_SLUG = new Map(CATEGORIES.map((category) => [category.slug, category]));

export const CATEGORY_SLUGS = CATEGORIES.map((category) => category.slug);

export function getCategory(slug: string): CategoryDefinition {
  return BY_SLUG.get(slug) ?? BY_SLUG.get('other')!;
}

export function isCategory(slug: string): boolean {
  return BY_SLUG.has(slug);
}

export function categoryLabel(slug: string): string {
  const category = getCategory(slug);
  return `${category.emoji} ${category.label}`;
}

/** Compact catalogue for the classifier prompt. */
export function categoryCatalogue(): string {
  return CATEGORIES.map((category) => `- ${category.slug}: ${category.hint}`).join('\n');
}

/** Discord slash-command choices (max 25, we have 13). */
export function categoryChoices(): { name: string; value: string }[] {
  return CATEGORIES.map((category) => ({ name: `${category.emoji} ${category.label}`, value: category.slug }));
}
