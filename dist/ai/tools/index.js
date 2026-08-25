import { child } from '../../logging/logger.js';
import { errorMessage } from '../../util/async.js';
import { terminalTools } from './finish.js';
import { knowledgeTools } from './knowledge.js';
import { ticketTools } from './ticket.js';
import { webTools } from './web.js';
const log = child('ai:tools');
export * from './types.js';
export { respondToUser, escalateToAdmin } from './finish.js';
/** Every tool the bot can ever expose. Nothing else is callable. */
export const ALL_TOOLS = [...knowledgeTools, ...webTools, ...ticketTools, ...terminalTools];
/**
 * Build the toolset for one conversation. Availability is decided here, up front, from real
 * server state and the asker's permissions — never from anything the model says.
 */
export function buildToolset(ctx, options = {}) {
    const available = ALL_TOOLS.filter((tool) => {
        if (webTools.includes(tool) && options.offerWeb === false)
            return false;
        return tool.available ? tool.available(ctx) : true;
    });
    const byName = new Map(available.map((tool) => [tool.spec.name, tool]));
    return {
        specs: available.map((tool) => tool.spec),
        isTerminal: (name) => byName.get(name)?.terminal === true,
        has: (name) => byName.has(name),
        async invoke(name, args) {
            const tool = byName.get(name);
            if (!tool)
                return { error: `Unknown tool "${name}". Use only the tools provided.` };
            if (tool.terminal || !tool.run)
                return { error: `${name} is handled by the system, not callable here.` };
            try {
                return await tool.run(args, ctx);
            }
            catch (error) {
                log.warn({ tool: name, err: errorMessage(error) }, 'tool failed');
                return { error: `Tool ${name} failed: ${errorMessage(error)}` };
            }
        },
    };
}
//# sourceMappingURL=index.js.map