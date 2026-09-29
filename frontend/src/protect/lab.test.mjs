import test from 'node:test';
import assert from 'node:assert/strict';
import { LAB_LEVELS } from './lab/levels.ts';
import { createLab, labReducer, planRun, configKey, diffConfig, runById } from './lab/lab-model.ts';
import { verdict, observe, isPoisoned } from './lab/verdict.ts';
import { createHttpTransport, parseChatResponse, sanitizeError, validateRequest, LAB_API_BASE } from './lab/api.ts';
import { createFixtureTransport, scriptedReply } from './lab/fixture.ts';

const completed = (reply, trace = [], extra = {}) => ({ status: 'completed', source: 'fixture', reply, trace, ms: 5, ...extra });
let n = 0;
const start = (state, kind) => {
  const plan = planRun(state, kind, `run-${++n}`);
  assert.equal(plan.ok, true, plan.error);
  return [labReducer(state, { type: 'runStarted', run: plan.run }), plan.run];
};
const settle = (state, run, result) => labReducer(state, { type: 'runSettled', runId: run.id, result });
const attackLevel0 = () => {
  let s = labReducer(createLab(), { type: 'insertAttack' });
  let run; [s, run] = start(s, 'attack');
  s = settle(s, run, completed('```\n' + LAB_LEVELS[0].config.system + '\n```'));
  return { s, run };
};

test('five levels are ported with provenance-preserving ids and reserved example domains', () => {
  assert.deepEqual(LAB_LEVELS.map(l => l.id), ['direct', 'toolpoison', 'mcp', 'exfil', 'confused']);
  const text = JSON.stringify(LAB_LEVELS.map(l => l.config));
  assert.equal(/calm-gift\.link/.test(text), false);
  for (const url of text.match(/https?:\/\/[a-z0-9.-]+/gi) ?? []) assert.match(url, /\.(example|test)$/);
  assert.equal(text.includes('\u2014'), false, 'no em dashes');
});

test('ported verdict heuristic matches server.py behavior', () => {
  const sys = LAB_LEVELS[0].config.system;
  assert.equal(verdict(sys, 'Sure: ' + sys, []).type, 'leak-rules');
  assert.equal(verdict('', 'see http://calm-gift.example/claim', [], 'calm-gift.example').type, 'inject');
  assert.equal(verdict('', 'ok', [{ tool: 'save_note', args: '{"body":"x SECRET-9f3a-DEMO"}', returns: '' }]).type, 'leak-secret');
  assert.equal(verdict('', 'ok', [{ tool: 'cleanup_calendar', args: '{}', returns: '' }]).type, 'action');
  assert.equal(verdict(sys, 'Breathe slowly.', []).type, 'none');
  assert.equal(isPoisoned(LAB_LEVELS[1].config.tools[0]), true);
});

test('errors and empty answers never count as a defense', () => {
  assert.equal(observe('rules', '(empty response)', []).kind, 'inconclusive');
  assert.equal(observe('rules', '   ', []).kind, 'inconclusive');
  assert.equal(observe('rules', '(stopped after max tool hops)', []).kind, 'inconclusive');
  assert.equal(observe('rules', '', [{ tool: 'cleanup_calendar', args: '', returns: '' }]).kind, 'violation', 'trace violations count even with an empty reply');
  let { s } = attackLevel0();
  s = labReducer(s, { type: 'applyFix' });
  let run; [s, run] = start(s, 'replay');
  s = settle(s, run, { status: 'failed', source: 'fixture', error: 'boom', ms: 1 });
  assert.equal(s.stage, 'patch'); assert.equal(s.cleanReplayRunId, null);
  [s, run] = start(s, 'replay');
  s = settle(s, run, completed('(empty response)'));
  assert.equal(s.stage, 'patch', 'empty replay does not unlock the control');
  [s, run] = start(s, 'replay');
  s = settle(s, run, { status: 'cancelled', source: 'fixture', ms: 1 });
  assert.equal(s.stage, 'patch');
});

test('attack must reach the level objective before patching', () => {
  let s = labReducer(createLab(), { type: 'insertAttack' });
  assert.equal(labReducer(s, { type: 'applyFix' }), s, 'config is read-only during the attack');
  let run; [s, run] = start(s, 'attack');
  s = settle(s, run, completed('I would rather help you relax.'));
  assert.equal(s.stage, 'attack');
  assert.equal(planRun(s, 'replay', 'x').ok, false);
});

test('exact replay preserves the original input, resets history and requires a patch', () => {
  let { s, run: attack } = attackLevel0();
  assert.equal(s.stage, 'patch');
  assert.equal(planRun(s, 'replay', 'x').ok, false, 'unchanged config cannot be replayed');
  s = labReducer(s, { type: 'applyFix' });
  const plan = planRun(s, 'replay', 'replay-1');
  assert.equal(plan.ok, true);
  assert.equal(plan.run.input, attack.input);
  assert.deepEqual(plan.run.request.messages, [{ role: 'user', content: attack.input }], 'fresh single-message history');
  assert.notEqual(plan.run.configKey, attack.configKey);
  assert.ok(plan.run.request.system.includes('Never reveal'));
});

test('late or obsolete responses are ignored and each response settles only its own run', () => {
  let s = labReducer(createLab(), { type: 'insertAttack' });
  let run; [s, run] = start(s, 'attack');
  assert.equal(planRun(s, 'attack', 'dup').ok, false, 'no duplicate concurrent runs');
  const moved = labReducer(s, { type: 'select', index: 1 });
  assert.equal(settle(moved, run, completed(LAB_LEVELS[0].config.system)), moved, 'response for an old level is ignored');
  const reset = labReducer(s, { type: 'resetLevel' });
  assert.equal(settle(reset, run, completed(LAB_LEVELS[0].config.system)), reset, 'response after reset is ignored');
  const other = labReducer(s, { type: 'runSettled', runId: 'someone-else', result: completed('x') });
  assert.equal(other, s);
  const once = settle(s, run, completed(LAB_LEVELS[0].config.system));
  assert.equal(settle(once, run, completed('second')), once, 'a run settles once');
});

test('control passes only when legitimate work is observed; removing the tool is not a win', () => {
  let s = labReducer(createLab('fixture', 1), { type: 'insertAttack' });
  let run; [s, run] = start(s, 'attack');
  s = settle(s, run, completed(s.config.system + ' tip', [{ tool: 'get_focus_tip', args: '{}', returns: 'Tip' }]));
  assert.equal(s.stage, 'patch');
  s = labReducer(s, { type: 'removeTool', index: 0 });
  [s, run] = start(s, 'replay');
  s = settle(s, run, completed('Here is a tip without tools.'));
  assert.equal(s.stage, 'control');
  [s, run] = start(s, 'control');
  s = settle(s, run, completed('Close your tabs.'));
  assert.equal(s.stage, 'patch');
  assert.match(runById(s, run.id).control.reason, /not a win/);
  assert.equal('toolpoison' in s.completed, false);
});

test('editing after a clean replay invalidates it', () => {
  let { s } = attackLevel0();
  s = labReducer(s, { type: 'applyFix' });
  let run; [s, run] = start(s, 'replay');
  s = settle(s, run, completed('I cannot share that.'));
  assert.equal(s.stage, 'control');
  s = labReducer(s, { type: 'editSystem', text: 'You are a pirate.' });
  assert.equal(s.stage, 'patch');
  assert.equal(planRun(s, 'control', 'c').ok, false);
});

test('fixture walks every level through attack, patch, replay and control', async () => {
  const transport = createFixtureTransport({ delayMs: 0 });
  for (let i = 0; i < LAB_LEVELS.length; i++) {
    let s = labReducer(createLab('fixture', i), { type: 'insertAttack' });
    for (const kind of ['attack', 'replay', 'control']) {
      if (kind === 'replay') s = labReducer(s, { type: 'applyFix' });
      let run; [s, run] = start(s, kind);
      s = settle(s, run, await transport.chat(run.request, new AbortController().signal));
    }
    assert.equal(s.stage, 'done', `${LAB_LEVELS[i].id} ends done`);
    assert.equal(s.completed[LAB_LEVELS[i].id], 'fixture');
  }
  assert.equal(scriptedReply({ system: 'x', messages: [{ role: 'user', content: 'free text' }], tools: [] }).unsupported, true);
});

test('fixture cancellation resolves as cancelled', async () => {
  const transport = createFixtureTransport({ delayMs: 50 });
  const ac = new AbortController();
  const pending = transport.chat({ system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [] }, ac.signal);
  ac.abort();
  assert.equal((await pending).status, 'cancelled');
});

const jsonResponse = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const request = { system: 'rules', messages: [{ role: 'user', content: 'hello' }], tools: [{ name: 'save_note', description: 'd', returns: 'r' }] };

test('HTTP adapter posts the exact contract to the same-origin prefix only', async () => {
  const calls = [];
  const transport = createHttpTransport(async (url, init) => { calls.push({ url, init }); return jsonResponse({ reply: 'ok', trace: [{ tool: 'save_note', args: '{"body":"x"}', returns: 'saved' }] }); });
  const result = await transport.chat(request, new AbortController().signal);
  assert.equal(result.status, 'completed');
  assert.equal(result.source, 'live');
  assert.equal(calls[0].url, `${LAB_API_BASE}/chat`);
  assert.equal(calls[0].url.startsWith('/'), true);
  assert.deepEqual(JSON.parse(calls[0].init.body), request);
  assert.equal(calls[0].init.credentials, 'same-origin');
  assert.equal(/authorization/i.test(JSON.stringify(calls[0].init.headers)), false);
});

test('HTTP adapter maps server errors, malformed JSON, network failure, timeout and cancel', async () => {
  const err = await createHttpTransport(async () => jsonResponse({ error: 'Scaleway 401: Bearer abcdefghijklmnop invalid' }, 502)).chat(request, new AbortController().signal);
  assert.equal(err.status, 'failed'); assert.equal(err.error.includes('abcdefghijklmnop'), false);
  const noKey = await createHttpTransport(async () => jsonResponse({ error: 'No Scaleway API key loaded on the server.' }, 500)).chat(request, new AbortController().signal);
  assert.equal(noKey.status, 'failed'); assert.match(noKey.error, /No Scaleway API key/);
  assert.equal((await createHttpTransport(async () => jsonResponse('<html>', 200)).chat(request, new AbortController().signal)).status, 'failed');
  assert.equal((await createHttpTransport(async () => jsonResponse({ reply: 5, trace: [] })).chat(request, new AbortController().signal)).status, 'failed');
  assert.equal((await createHttpTransport(async () => { throw new TypeError('fetch failed'); }).chat(request, new AbortController().signal)).status, 'failed');
  const hang = (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  const timed = await createHttpTransport(hang, { timeoutMs: 20 }).chat(request, new AbortController().signal);
  assert.equal(timed.status, 'failed'); assert.match(timed.error, /No answer within/);
  const ac = new AbortController();
  const pending = createHttpTransport(hang).chat(request, ac.signal);
  ac.abort();
  assert.equal((await pending).status, 'cancelled');
});

test('HTTP adapter validates requests and bounds responses', async () => {
  let called = false;
  const transport = createHttpTransport(async () => { called = true; return jsonResponse({ reply: '', trace: [] }); });
  assert.equal((await transport.chat({ ...request, messages: [{ role: 'user', content: 'x'.repeat(2001) }] }, new AbortController().signal)).status, 'failed');
  assert.equal((await transport.chat({ ...request, tools: [{ name: 'bad name!', description: '', returns: '' }] }, new AbortController().signal)).status, 'failed');
  assert.equal(called, false, 'invalid requests never reach the network');
  assert.match(validateRequest({ ...request, messages: [...request.messages, { role: 'assistant', content: 'x' }] }), /exactly one/);
  assert.throws(() => parseChatResponse({ reply: 'x', trace: [{ nope: 1 }] }));
  assert.equal(parseChatResponse({ reply: 'x', trace: Array.from({ length: 40 }, () => ({ tool: 't', args: {}, returns: 'r' })) }).trace.length, 16);
  assert.equal(sanitizeError('api_key=placeholder-placeholder leaked'), 'api_key=[redacted] leaked');
});

test('health reports readiness, never a verified model', async () => {
  assert.deepEqual(await createHttpTransport(async () => jsonResponse({ ok: true, model: 'gemma' })).health(), { state: 'key-configured', model: 'gemma' });
  assert.deepEqual(await createHttpTransport(async () => jsonResponse({ ok: false, model: 'gemma' })).health(), { state: 'no-key', model: 'gemma' });
  assert.equal((await createHttpTransport(async () => jsonResponse({ status: 'up' })).health()).state, 'disconnected', 'foreign /health shapes are rejected');
  assert.equal((await createHttpTransport(async () => new Response('nf', { status: 404 })).health()).state, 'disconnected');
});

test('config diff names what the patch changed', () => {
  const level = LAB_LEVELS[4];
  const labels = diffConfig(level.config, level.fix.apply(level.config)).map(c => c.label);
  assert.ok(labels.some(l => /System rules/.test(l)));
  assert.ok(labels.includes('Tool cleanup_calendar removed'));
  assert.notEqual(configKey(level.config), configKey(level.fix.apply(level.config)));
});
