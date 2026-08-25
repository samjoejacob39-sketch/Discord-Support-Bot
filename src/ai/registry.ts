import type { Env } from '../config/env.js';
import { child } from '../logging/logger.js';
import type { AIProvider } from './provider.js';
import { GeminiProvider } from './providers/gemini.js';
import { MockProvider } from './providers/mock.js';

const log = child('ai');

/** Factory for the configured provider. The only place that decides which vendor runs. */
export function createProvider(env: Env): AIProvider {
  if (env.AI_PROVIDER === 'mock') {
    log.warn('using mock AI provider — replies are canned');
    return new MockProvider();
  }
  if (!env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is required for AI_PROVIDER=gemini');
  }
  return new GeminiProvider({
    apiKey: env.GEMINI_API_KEY,
    mainModel: env.GEMINI_MODEL,
    fastModel: env.GEMINI_FAST_MODEL,
  });
}

let singleton: AIProvider | undefined;

export function initProvider(env: Env): AIProvider {
  singleton = createProvider(env);
  log.info({ provider: singleton.name, model: singleton.modelFor('main') }, 'AI provider ready');
  return singleton;
}

export function getProvider(): AIProvider {
  if (!singleton) throw new Error('AI provider not initialised — call initProvider() during bootstrap.');
  return singleton;
}

export function setProvider(provider: AIProvider): void {
  singleton = provider;
}
