import { PROMPT_BUDGET } from '../config/constants.js';
import { dataBlock } from '../security/trust.js';
import { relativeTimestamp } from '../util/text.js';
import { categoryLabel } from './categories.js';
/**
 * Retrieve what the bot should know for one question:
 * active incidents (always — they outrank stale documentation) plus the best relevance
 * matches, deduplicated and capped by a character budget.
 */
export function retrieveKnowledge(store, guildId, query, options = {}) {
    const incidents = store.knowledge.activeIncidents(guildId);
    const matches = store.knowledge.search(guildId, query, options.matchLimit ?? 6);
    const seen = new Set(incidents.map((entry) => entry.id));
    const uniqueMatches = matches.filter((entry) => !seen.has(entry.id) && (seen.add(entry.id), true));
    const budget = options.charBudget ?? PROMPT_BUDGET.knowledgeChars;
    const used = [];
    let spent = 0;
    for (const entry of [...incidents, ...uniqueMatches]) {
        const cost = entry.title.length + entry.content.length + 40;
        if (spent + cost > budget && used.length > 0)
            break;
        used.push(entry);
        spent += cost;
    }
    return { incidents, matches: uniqueMatches, used };
}
function renderEntry(entry) {
    const flags = [`id=${entry.id}`, `category=${entry.category}`];
    if (entry.kind !== 'permanent')
        flags.push(`kind=${entry.kind}`);
    if (entry.visibility === 'staff')
        flags.push('staff_only=true');
    if (entry.expiresAt)
        flags.push(`expires_at=${new Date(entry.expiresAt).toISOString()}`);
    return `[${flags.join(' ')}] ${entry.title}\n${entry.content}`;
}
/**
 * Render retrieved knowledge as prompt blocks. Incidents are a separate, higher-precedence
 * block; staff-only notes are labelled so the model uses them without quoting them.
 */
export function renderKnowledgeBlocks(result) {
    const blocks = [];
    if (result.incidents.length > 0) {
        blocks.push(dataBlock('active_incidents', result.incidents.map(renderEntry).join('\n\n'), {
            attributes: { precedence: 'above_general_knowledge' },
            maxChars: PROMPT_BUDGET.knowledgeChars,
        }));
    }
    const general = result.used.filter((entry) => !result.incidents.some((incident) => incident.id === entry.id));
    if (general.length > 0) {
        blocks.push(dataBlock('server_knowledge', general.map(renderEntry).join('\n\n'), {
            attributes: { authority: 'server_specific' },
            maxChars: PROMPT_BUDGET.knowledgeChars,
        }));
    }
    return blocks;
}
/** One-line-per-entry list for staff-facing embeds. */
export function summariseEntries(entries) {
    if (entries.length === 0)
        return '_Nothing yet._';
    return entries
        .map((entry) => {
        const badges = [
            entry.kind === 'incident' ? '🚨' : entry.kind === 'temporary' ? '⏳' : '',
            entry.visibility === 'staff' ? '🔒' : '',
            entry.flagged ? '⚠️' : '',
            entry.status !== 'active' ? `(${entry.status})` : '',
        ]
            .filter(Boolean)
            .join(' ');
        const expiry = entry.expiresAt ? ` · expires ${relativeTimestamp(entry.expiresAt)}` : '';
        return `\`#${entry.id}\` ${badges} **${entry.title}**\n${categoryLabel(entry.category)}${expiry}`;
    })
        .join('\n\n');
}
//# sourceMappingURL=retrieval.js.map