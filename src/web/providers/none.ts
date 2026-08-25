import { SearchUnavailableError, type SearchProvider } from '../searchProvider.js';

/** Used when no search API is configured. Fails loudly rather than silently guessing. */
export class NoopSearchProvider implements SearchProvider {
  readonly name = 'none';
  readonly enabled = false;

  async search(): Promise<never> {
    throw new SearchUnavailableError();
  }
}
