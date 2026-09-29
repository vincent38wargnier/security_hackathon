// Simulation transport. Deterministic, local, not a model. Every result is labelled
// source: 'fixture' and the UI shows it as "Simulation". It is never used as a
// fallback for a failed live call; the player must choose it explicitly.
import type { ChatRequest, ChatResult, LabTransport } from './api.ts';
import { validateRequest } from './api.ts';
import { simulate } from './sim.ts';

// The Simulation answers any text with the rule-based practice AI in sim.ts.
export const scriptedReply = (request: ChatRequest) => simulate(request);

export function createFixtureTransport(options: { delayMs?: number } = {}): LabTransport {
  const delayMs = options.delayMs ?? 700;
  return {
    source: 'fixture',
    async health() { return { state: 'key-configured', model: 'practice-ai-simulation' }; },
    chat(request, signal) {
      const invalid = validateRequest(request);
      if (invalid) return Promise.resolve<ChatResult>({ status: 'failed', source: 'fixture', error: invalid, ms: 0 });
      return new Promise<ChatResult>(resolve => {
        if (signal.aborted) return resolve({ status: 'cancelled', source: 'fixture', ms: 0 });
        const started = Date.now();
        const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve({ status: 'completed', source: 'fixture', ...scriptedReply(request), ms: Date.now() - started }); }, delayMs);
        const onAbort = () => { clearTimeout(timer); resolve({ status: 'cancelled', source: 'fixture', ms: Date.now() - started }); };
        signal.addEventListener('abort', onAbort, { once: true });
      });
    },
  };
}
