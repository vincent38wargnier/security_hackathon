import { canDecide, scenarios } from './model.ts';
import type { GameAction, GameState } from './model.ts';

export const TRAINING_PROTOCOL = 'compass.training.v1';
export const MAX_PROPOSAL_BYTES = 16 * 1024;
export type AgentProposal = { protocol: typeof TRAINING_PROTOCOL; challengeId: string; scenarioId: string; choiceId: string; reason: string };
export type ProposalResult = { ok: true } | { ok: false; error: string };

export function getChallenge(state: GameState, challengeId: string) {
  if (state.phase !== 'playing') return null;
  const scenario = scenarios[state.level];
  return {
    protocol: TRAINING_PROTOCOL,
    challengeId,
    scenarioId: scenario.id,
    evidence: scenario.evidence.map(({ id, title, kind, body }) => ({ id, title, kind, body })),
    choices: scenario.choices.map(({ id, label, detail }) => ({ id, label, detail })),
  };
}

export function parseProposal(input: unknown, state: GameState, challengeId: string): AgentProposal {
  if (state.phase !== 'playing') throw new Error('Start or resume an incident before proposing.');
  let value: unknown = input;
  if (typeof value === 'string') {
    if (new TextEncoder().encode(value).byteLength > MAX_PROPOSAL_BYTES) throw new Error('Proposal must be 16 KB or smaller.');
    try { value = JSON.parse(value); } catch { throw new Error('Import a valid JSON proposal.'); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Proposal must be a plain object.');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error('Proposal must be a plain object.');
  const fields = ['protocol', 'challengeId', 'scenarioId', 'choiceId', 'reason'];
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.includes(key))) throw new Error('Use only protocol, challengeId, scenarioId, choiceId, and reason.');
  const record: Record<string, string> = {};
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string') throw new Error('Every proposal field must be a plain string.');
    record[field] = descriptor.value;
  }
  if (record.protocol !== TRAINING_PROTOCOL) throw new Error('Unsupported proposal protocol.');
  if (record.challengeId !== challengeId) throw new Error('This challenge has expired. Export the current challenge again.');
  const scenario = scenarios[state.level];
  if (record.scenarioId !== scenario.id) throw new Error('This proposal belongs to a different incident.');
  if (!scenario.choices.some(choice => choice.id === record.choiceId)) throw new Error('Choose an available choiceId for this incident.');
  if (!record.reason.trim() || record.reason.length > 1000) throw new Error('Reason must contain 1 to 1000 characters.');
  return { protocol: TRAINING_PROTOCOL, challengeId, scenarioId: record.scenarioId, choiceId: record.choiceId, reason: record.reason };
}

// Only the two-method API is published. Confirmation stays in the player UI.
export function createTrainingBridge(readState: () => GameState, onProposal: (proposal: AgentProposal | null) => void, challengeId = crypto.randomUUID()) {
  let active = true;
  let pending: AgentProposal | null = null;
  const clear = () => { pending = null; onProposal(null); };
  const api = Object.freeze({
    getChallenge: () => active ? getChallenge(readState(), challengeId) : null,
    propose: (input: unknown): ProposalResult => {
      if (!active) return { ok: false, error: 'This bridge is no longer active. Get the current window.compassTraining bridge.' };
      try {
        const proposal = parseProposal(input, readState(), challengeId);
        pending = proposal;
        onProposal({ ...proposal });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Invalid proposal.' };
      }
    },
  });
  return {
    api,
    clear,
    confirm: (): GameAction | null => {
      if (!active || !pending || !canDecide(readState())) return null;
      try {
        const proposal = parseProposal(pending, readState(), challengeId);
        clear();
        return { type: 'choose', id: proposal.choiceId };
      } catch { clear(); return null; }
    },
    dispose: () => { active = false; pending = null; },
  };
}

export type TrainingAPI = ReturnType<typeof createTrainingBridge>['api'];
