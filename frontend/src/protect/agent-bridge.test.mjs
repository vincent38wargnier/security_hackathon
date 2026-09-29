import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrainingBridge as createBridge, getChallenge as challenge, parseProposal as parse, MAX_PROPOSAL_BYTES } from './agent-bridge.ts';
import { createGame, gameReducer, scenarios } from './model.ts';

const challengeId = 'test-run-1';
const getChallenge = state => challenge(state, challengeId);
const parseProposal = (input, state) => parse(input, state, challengeId);
const createTrainingBridge = (read, update) => createBridge(read, update, challengeId);
const playing = () => gameReducer(createGame(), { type: 'start' });
const valid = () => ({ protocol: 'compass.training.v1', challengeId, scenarioId: 'brief', choiceId: 'extract', reason: 'Keep requirements without granting privileges.' });

test('challenge is an isolated allowlisted snapshot without answer keys', () => {
  const challenge = getChallenge(playing());
  assert.deepEqual(Object.keys(challenge).sort(), ['challengeId', 'choices', 'evidence', 'protocol', 'scenarioId']);
  assert.deepEqual(Object.keys(challenge.evidence[0]).sort(), ['body', 'id', 'kind', 'title']);
  assert.deepEqual(Object.keys(challenge.choices[0]).sort(), ['detail', 'id', 'label']);
  assert.equal(JSON.stringify(challenge).includes('consequence'), false);
  challenge.choices[0].label = 'mutated';
  assert.notEqual(scenarios[0].choices[0].label, 'mutated');
  assert.equal(getChallenge(createGame()), null);
});

test('accepts bounded plain proposals and JSON without executing malicious text', () => {
  const proposal = { ...valid(), reason: '<img src=x onerror="globalThis.pwned=true">' };
  assert.deepEqual(parseProposal(JSON.stringify(proposal), playing()), proposal);
  assert.equal(globalThis.pwned, undefined);
  assert.equal(parseProposal({ ...valid(), reason: 'x'.repeat(1000) }, playing()).reason.length, 1000);
});

test('rejects malformed, primitive, missing, unknown, symbol and prototype fields', () => {
  for (const input of ['{', 'null', '[]', 1, null, {}, [], { ...valid(), execute: true }, { ...valid(), correct: true }, { ...valid(), [Symbol('hidden')]: 1 }, JSON.parse('{"protocol":"compass.training.v1","scenarioId":"brief","choiceId":"extract","reason":"ok","__proto__":{}}'), Object.assign(Object.create({ inherited: true }), valid())]) {
    assert.throws(() => parseProposal(input, playing()));
  }
});

test('does not invoke input getters', () => {
  let invoked = false;
  const input = valid();
  Object.defineProperty(input, 'reason', { get() { invoked = true; return 'secret'; } });
  assert.throws(() => parseProposal(input, playing()), /plain string/);
  assert.equal(invoked, false);
});

test('rejects stale scenario, unavailable choice, wrong protocol and non-playing state', () => {
  for (const input of [{ ...valid(), scenarioId: 'export' }, { ...valid(), choiceId: 'once' }, { ...valid(), protocol: 'other' }, { ...valid(), reason: 3 }]) assert.throws(() => parseProposal(input, playing()));
  for (const phase of ['briefing', 'feedback', 'complete']) assert.throws(() => parseProposal(valid(), { ...playing(), phase }));
});

test('enforces UTF-8 file byte cap and reason character limit', () => {
  for (const reason of ['', '   ', 'x'.repeat(1001)]) assert.throws(() => parseProposal({ ...valid(), reason }, playing()));
  assert.throws(() => parseProposal(' '.repeat(MAX_PROPOSAL_BYTES) + JSON.stringify(valid()), playing()), /16 KB/);
  assert.throws(() => parseProposal(JSON.stringify({ ...valid(), reason: '界'.repeat(6000) }), playing()), /16 KB/);
  const json = JSON.stringify(valid());
  assert.deepEqual(parseProposal(json + ' '.repeat(MAX_PROPOSAL_BYTES - json.length), playing()), valid());
});

test('proposal never chooses; confirmation requires inspection and is single use', () => {
  let state = playing();
  let shown;
  const bridge = createTrainingBridge(() => state, proposal => { shown = proposal; });
  assert.deepEqual(Object.keys(bridge.api).sort(), ['getChallenge', 'propose']);
  assert.deepEqual(bridge.api.propose(valid()), { ok: true });
  assert.equal(state.receipts.length, 0);
  assert.equal(bridge.confirm(), null);
  assert.equal(shown.choiceId, 'extract');
  state = gameReducer(state, { type: 'inspect', id: 'brief-file' });
  const action = bridge.confirm();
  assert.deepEqual(action, { type: 'choose', id: 'extract' });
  assert.equal(state.receipts.length, 0);
  state = gameReducer(state, action);
  assert.equal(state.receipts.length, 1);
  assert.equal(bridge.confirm(), null);
});

test('confirmation revalidates current scenario and requires every evidence item', () => {
  let state = { ...playing(), level: 2, inspected: ['safe-call'] };
  const bridge = createTrainingBridge(() => state, () => {});
  assert.equal(bridge.api.propose({ ...valid(), scenarioId: 'permission', choiceId: 'once' }).ok, true);
  assert.equal(bridge.confirm(), null);
  state = { ...state, inspected: ['safe-call', 'safe-policy'] };
  assert.deepEqual(bridge.confirm(), { type: 'choose', id: 'once' });
  bridge.api.propose({ ...valid(), scenarioId: 'permission', choiceId: 'once' });
  state = { ...playing(), inspected: ['brief-file'] };
  assert.equal(bridge.confirm(), null);
});

test('dismissal, disposal and retained old handles cannot apply a proposal', () => {
  const state = { ...playing(), inspected: ['brief-file'] };
  const bridge = createTrainingBridge(() => state, () => {});
  const proposal = valid();
  bridge.api.propose(proposal);
  proposal.choiceId = 'trust';
  assert.deepEqual(bridge.confirm(), { type: 'choose', id: 'extract' });
  bridge.api.propose(valid());
  bridge.clear();
  assert.equal(bridge.confirm(), null);
  bridge.api.propose(valid());
  bridge.dispose();
  assert.equal(bridge.api.getChallenge(), null);
  assert.equal(bridge.api.propose(valid()).ok, false);
  assert.equal(bridge.confirm(), null);
});

test('run-scoped challenge nonce rejects the same scenario from an earlier run', () => {
  const state = playing();
  const first = createBridge(() => state, () => {});
  const second = createBridge(() => state, () => {});
  assert.notEqual(first.api.getChallenge().challengeId, second.api.getChallenge().challengeId);
  const proposal = { ...valid(), challengeId: first.api.getChallenge().challengeId };
  assert.equal(first.api.propose(proposal).ok, true);
  assert.equal(second.api.propose(proposal).ok, false);
  assert.throws(() => parseProposal({ ...valid(), challengeId: 'earlier-run' }, state), /expired/);
});
