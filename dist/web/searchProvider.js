export function hostOf(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    }
    catch {
        return '';
    }
}
export class SearchUnavailableError extends Error {
    constructor(message = 'Web search is not configured for this bot.') {
        super(message);
        this.name = 'SearchUnavailableError';
    }
}
//# sourceMappingURL=searchProvider.js.map