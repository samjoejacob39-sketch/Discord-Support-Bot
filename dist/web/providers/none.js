import { SearchUnavailableError } from '../searchProvider.js';
/** Used when no search API is configured. Fails loudly rather than silently guessing. */
export class NoopSearchProvider {
    name = 'none';
    enabled = false;
    async search() {
        throw new SearchUnavailableError();
    }
}
//# sourceMappingURL=none.js.map