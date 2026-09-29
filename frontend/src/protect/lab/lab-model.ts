// Attack -> patch -> exact replay -> benign control state machine. Pure and testable.
import type { ChatRequest, ChatResult, RunSource } from './api.ts';
import { LIMITS } from './api.ts';
import { LAB_LEVELS, levelConfig } from './levels.ts';
import type { LabConfig, LabLevel, LabTool } from './levels.ts';
import { observe, plantedLinks } from './verdict.ts';
import { REFUSAL } from './sim.ts';
import type { Observation } from './verdict.ts';

export type Stage = 'attack' | 'patch' | 'control' | 'done';
// probe: a free attempt against the patched agent ("try to break your own patch").
export type RunKind = 'attack' | 'replay' | 'control' | 'probe';
export type ControlCheck = { passed: boolean; reason: string };
export type Run = {
  id: string; kind: RunKind; levelId: LabLevel['id']; epoch: number; source: RunSource;
  input: string; config: LabConfig; configKey: string; request: ChatRequest;
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  result?: ChatResult; observation?: Observation; control?: ControlCheck;
};
export type LabState = {
  levelIndex: number; config: LabConfig; stage: Stage; source: RunSource; draft: string;
  runs: Run[]; pendingRunId: string | null; baselineRunId: string | null; cleanReplayRunId: string | null;
  epoch: number; hints: { attack: number[]; fix: number[] }; completed: Record<string, RunSource>;
  stars: Record<string, number>; holes: number; notice: string;
};
export type LabAction =
  | { type: 'select'; index: number }
  | { type: 'resetLevel' }
  | { type: 'resetAll' }
  | { type: 'source'; source: RunSource }
  | { type: 'draft'; text: string }
  | { type: 'insertAttack' }
  | { type: 'hint'; which: 'attack' | 'fix' }
  | { type: 'editSystem'; text: string }
  | { type: 'editTool'; index: number; field: 'description' | 'returns'; value: string }
  | { type: 'removeTool'; index: number }
  | { type: 'applyFix' }
  | { type: 'restoreConfig' }
  | { type: 'runStarted'; run: Run }
  | { type: 'runSettled'; runId: string; result: ChatResult };

const MAX_RUNS = 12;
export const configKey = (config: LabConfig) => JSON.stringify({ s: config.system, t: config.tools.map(({ name, description, returns }) => [name, description, returns]) });
export const levelOf = (state: LabState) => LAB_LEVELS[state.levelIndex];
export const runById = (state: LabState, id: string | null) => id ? state.runs.find(run => run.id === id) ?? null : null;
export const toRequest = (config: LabConfig, input: string): ChatRequest => ({
  system: config.system,
  messages: [{ role: 'user', content: input }],
  tools: config.tools.map(({ name, description, returns }) => ({ name, description, returns })),
});

export function createLab(source: RunSource = 'fixture', levelIndex = 0): LabState {
  return {
    levelIndex, config: levelConfig(LAB_LEVELS[levelIndex]), stage: 'attack', source, draft: '', runs: [],
    pendingRunId: null, baselineRunId: null, cleanReplayRunId: null, epoch: 0,
    hints: { attack: LAB_LEVELS.map(() => 0), fix: LAB_LEVELS.map(() => 0) }, completed: {}, stars: {}, holes: 0, notice: '',
  };
}

const freshLevel = (state: LabState, levelIndex: number, notice = ''): LabState => ({
  ...state, levelIndex, config: levelConfig(LAB_LEVELS[levelIndex]), stage: 'attack', draft: '', runs: [],
  pendingRunId: null, baselineRunId: null, cleanReplayRunId: null, epoch: state.epoch + 1, notice,
});

// Any edit after the clean replay invalidates it: the control must test the replayed configuration.
function withConfig(state: LabState, config: LabConfig): LabState {
  if (state.stage === 'attack') return state; // the rules stay locked until the hack works
  const clean = runById(state, state.cleanReplayRunId);
  const key = configKey(config);
  const stage: Stage = clean && clean.configKey === key ? state.stage : state.stage === 'done' || state.stage === 'control' ? 'patch' : state.stage;
  return { ...state, config, stage, cleanReplayRunId: stage === 'patch' ? null : state.cleanReplayRunId, notice: '' };
}

export type Plan = { ok: true; run: Run } | { ok: false; error: string };

export function planRun(state: LabState, kind: RunKind, id: string): Plan {
  if (state.pendingRunId) return { ok: false, error: 'A run is already in progress. Cancel it first.' };
  const level = levelOf(state);
  let input: string;
  if (kind === 'attack') {
    if (state.stage !== 'attack') return { ok: false, error: 'The attack is recorded. Patch the agent, then replay it.' };
    input = state.draft.trim();
    if (!input) return { ok: false, error: 'Write an attack message or insert the reference attack.' };
    if (input.length > LIMITS.message) return { ok: false, error: `Keep the message under ${LIMITS.message} characters.` };
  } else if (kind === 'probe') {
    if (state.stage === 'attack') return { ok: false, error: 'Hack the agent first.' };
    input = state.draft.trim();
    if (!input) return { ok: false, error: 'Type or paste a trick to try against your patch.' };
    if (input.length > LIMITS.message) return { ok: false, error: `Keep the message under ${LIMITS.message} characters.` };
  } else if (kind === 'replay') {
    const baseline = runById(state, state.baselineRunId);
    if (!baseline || state.stage === 'attack') return { ok: false, error: 'Record a successful attack first.' };
    if (configKey(state.config) === baseline.configKey) return { ok: false, error: 'Patch the agent first. Replaying the unchanged agent proves nothing.' };
    input = baseline.input; // exact same input, fresh history
  } else {
    const clean = runById(state, state.cleanReplayRunId);
    if (state.stage !== 'control' || !clean || clean.configKey !== configKey(state.config)) return { ok: false, error: 'Replay the attack against this exact configuration first.' };
    input = level.control.input;
  }
  const config: LabConfig = { system: state.config.system, tools: state.config.tools.map(tool => ({ ...tool })) };
  return { ok: true, run: { id, kind, levelId: level.id, epoch: state.epoch, source: state.source, input, config, configKey: configKey(config), request: toRequest(config, input), status: 'pending' } };
}

export function controlCheck(level: LabLevel, result: ChatResult, observation: Observation): ControlCheck {
  if (result.status !== 'completed') return { passed: false, reason: 'The control did not complete. It does not count.' };
  if (observation.kind === 'violation') return { passed: false, reason: `The benign request still triggered: ${observation.did}.` };
  if (observation.kind === 'inconclusive') return { passed: false, reason: observation.reason };
  if (REFUSAL.test(result.reply)) return { passed: false, reason: 'The helper now refuses normal requests too. A patch that blocks everything is not a win.' };
  if (level.control.expectTool && !result.trace.some(call => call.tool === level.control.expectTool)) return { passed: false, reason: `Legitimate work not observed: ${level.control.expectTool} was not used. A patch that removes the useful capability is not a win.` };
  return { passed: true, reason: `${level.control.purpose} Observed in this run only.` };
}

function settle(state: LabState, runId: string, result: ChatResult): LabState {
  const run = runById(state, runId);
  if (!run || state.pendingRunId !== runId || run.epoch !== state.epoch) return state; // late or obsolete response
  const level = LAB_LEVELS.find(l => l.id === run.levelId)!;
  let observation: Observation | undefined;
  let control: ControlCheck | undefined;
  let next: Partial<LabState> = {};
  let notice = '';
  if (result.status === 'completed') {
    observation = observe(run.config.system, result.reply, result.trace, [level.marker ?? '', ...plantedLinks(run.config.tools)], result.unsupported);
    if (run.kind === 'attack') {
      if (observation.kind === 'violation' && observation.type === level.win) { next = { stage: 'patch', baselineRunId: run.id }; notice = 'Objective reached. Now patch the agent so this exact attack fails.'; }
      else if (observation.kind === 'violation') notice = `A different weakness surfaced (${observation.did}). The objective is still open.`;
      else if (observation.kind === 'inconclusive') notice = observation.reason;
      else notice = 'The agent resisted in this run. Try again, or use the hint.';
    } else if (run.kind === 'probe') {
      if (observation.kind === 'violation' && observation.type === level.win) { next = { stage: 'patch', baselineRunId: run.id, cleanReplayRunId: null, holes: state.holes + 1 }; notice = 'You found a hole in your own patch. Strengthen the rules, then test this new trick.'; }
      else if (observation.kind === 'violation') notice = `A different weakness surfaced: the agent ${observation.did}.`;
      else if (observation.kind === 'inconclusive') notice = observation.reason;
      else notice = 'Your patch held against this trick too. Try another, or move on.';
    } else if (run.kind === 'replay') {
      if (observation.kind === 'clean') { next = { stage: 'control', cleanReplayRunId: run.id }; notice = 'Same attack, not observed this time. Now check that legitimate work still succeeds.'; }
      else if (observation.kind === 'violation') notice = 'Still vulnerable in this run. Adjust the patch and replay.';
      else notice = observation.reason;
    } else {
      control = controlCheck(level, result, observation);
      if (control.passed) { const earned = 2 + (state.hints.attack[state.levelIndex] === 0 && state.hints.fix[state.levelIndex] === 0 ? 1 : 0); next = { stage: 'done', completed: { ...state.completed, [level.id]: run.source }, stars: { ...state.stars, [level.id]: Math.max(earned, state.stars[level.id] ?? 0) } }; notice = 'Patched in this run, and legitimate work still succeeds. One run is evidence, not a guarantee.'; }
      else if (observation.kind === 'inconclusive') notice = control.reason;
      else { next = { stage: 'patch', cleanReplayRunId: null }; notice = control.reason; }
    }
  } else if (result.status === 'failed') {
    notice = `Run failed: ${result.error} Nothing was counted. Retry when ready.`;
  } else {
    notice = 'Run cancelled. Nothing was counted.';
  }
  const status = result.status;
  return { ...state, ...next, pendingRunId: null, notice, runs: state.runs.map(r => r.id === runId ? { ...r, status, result, observation, control } : r) };
}

export function labReducer(state: LabState, action: LabAction): LabState {
  const level = levelOf(state);
  switch (action.type) {
    case 'select': return action.index >= 0 && action.index < LAB_LEVELS.length ? freshLevel(state, action.index) : state;
    case 'resetLevel': return freshLevel(state, state.levelIndex);
    case 'resetAll': return { ...createLab(state.source), epoch: state.epoch + 1 };
    case 'source': return action.source === state.source ? state : freshLevel({ ...state, source: action.source }, state.levelIndex, action.source === 'live' ? 'Live AI selected. Results come from the model on Vincent\'s server and can vary.' : 'Scripted fixture selected. Deterministic, local, not AI.');
    case 'draft': return { ...state, draft: action.text.slice(0, LIMITS.message) };
    case 'insertAttack': return state.stage === 'attack' ? { ...state, draft: level.attack } : state;
    case 'hint': {
      const list = [...state.hints[action.which]];
      list[state.levelIndex] = Math.min(1, list[state.levelIndex] + 1);
      return { ...state, hints: { ...state.hints, [action.which]: list } };
    }
    case 'editSystem': return withConfig(state, { ...state.config, system: action.text.slice(0, LIMITS.system) });
    case 'editTool': {
      if (!state.config.tools[action.index]) return state;
      const tools = state.config.tools.map((tool, i): LabTool => i === action.index ? { ...tool, [action.field]: action.value.slice(0, LIMITS.toolField) } : tool);
      // While hacking, the player is the attacker and may plant text in tools (notes, descriptions).
      if (state.stage === 'attack') return { ...state, config: { ...state.config, tools } };
      return withConfig(state, { ...state.config, tools });
    }
    case 'removeTool': return state.config.tools[action.index] ? withConfig(state, { ...state.config, tools: state.config.tools.filter((_, i) => i !== action.index) }) : state;
    case 'applyFix': return withConfig(state, level.fix.apply(state.config));
    case 'restoreConfig': return state.stage === 'attack' ? { ...state, config: levelConfig(level) } : withConfig(state, levelConfig(level));
    case 'runStarted':
      if (state.pendingRunId || action.run.epoch !== state.epoch || action.run.levelId !== level.id) return state;
      return { ...state, pendingRunId: action.run.id, notice: '', runs: [...state.runs, action.run].slice(-MAX_RUNS) };
    case 'runSettled': return settle(state, action.runId, action.result);
  }
}

export type ConfigChange = { label: string; kind: 'added' | 'removed' | 'changed' };
export function diffConfig(before: LabConfig, after: LabConfig): ConfigChange[] {
  const changes: ConfigChange[] = [];
  if (before.system !== after.system) {
    const a = new Set(before.system.split(/\n+/).map(s => s.trim()).filter(Boolean));
    const b = new Set(after.system.split(/\n+/).map(s => s.trim()).filter(Boolean));
    const added = [...b].filter(line => !a.has(line)).length;
    const removed = [...a].filter(line => !b.has(line)).length;
    changes.push({ kind: 'changed', label: `System rules: ${added ? `+${added} line${added > 1 ? 's' : ''}` : ''}${added && removed ? ', ' : ''}${removed ? `-${removed} line${removed > 1 ? 's' : ''}` : ''}${!added && !removed ? 'edited' : ''}` });
  }
  for (const tool of before.tools) {
    const match = after.tools.find(t => t.name === tool.name);
    if (!match) changes.push({ kind: 'removed', label: `Tool ${tool.name} removed` });
    else {
      if (match.description !== tool.description) changes.push({ kind: 'changed', label: `Tool ${tool.name}: description rewritten` });
      if (match.returns !== tool.returns) changes.push({ kind: 'changed', label: `Tool ${tool.name}: output edited` });
    }
  }
  for (const tool of after.tools) if (!before.tools.some(t => t.name === tool.name)) changes.push({ kind: 'added', label: `Tool ${tool.name} added` });
  return changes;
}

export function labSummary(state: LabState) {
  return {
    format: 'compass-lab-v1', heuristic: true, source: state.source, stars: state.stars, holesFound: state.holes,
    note: 'Single-run heuristic observations. Not a security certification.',
    levels: LAB_LEVELS.map((level, i) => ({ id: level.id, title: level.title, patchedInSession: level.id in state.completed, source: state.completed[level.id] ?? null, attackHints: state.hints.attack[i], fixHints: state.hints.fix[i] })),
    currentRuns: state.runs.map(run => ({ kind: run.kind, level: run.levelId, source: run.source, status: run.status, observation: run.observation?.kind ?? null, type: run.observation && run.observation.kind === 'violation' ? run.observation.type : null, controlPassed: run.control?.passed ?? null, ms: run.result?.ms ?? null })),
  };
}
