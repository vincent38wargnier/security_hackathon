import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createHttpTransport } from './api';
import type { Health, LabTransport } from './api';
import { createFixtureTransport } from './fixture';
import { configKey, createLab, diffConfig, labReducer, labSummary, levelOf, planRun, runById } from './lab-model';
import type { LabState, Run, RunKind } from './lab-model';
import { LAB_LEVELS } from './levels';
import { DANGER, isPoisoned, WIN_LABEL } from './verdict';
import type { Observation } from './verdict';
import './lab.css';

// Live mode is only offered in development (Vite proxy to Vincent's local server) or when a
// deployment explicitly opts in after Vincent's server-side limits exist. Public builds stay offline.
export const LIVE_ALLOWED = import.meta.env.DEV || import.meta.env.VITE_LAB_LIVE === '1';
type LabWindow = Window & { render_lab_to_text?: () => string };
type HealthView = Health | { state: 'checking' };

const STEPS: readonly string[] = ['Attack', 'Patch', 'Replay', 'Control'];
function currentStep(state: LabState) {
  if (state.stage === 'attack') return 0;
  if (state.stage === 'patch') return configKey(state.config) === runById(state, state.baselineRunId)?.configKey ? 1 : 2;
  if (state.stage === 'control') return 3;
  return 4;
}

const kindLabel: Record<RunKind, string> = { attack: 'Attack', replay: 'Exact replay', control: 'Benign control' };

function observationText(run: Run): { tone: 'risk' | 'safe' | 'neutral'; title: string; detail: string } {
  if (run.status === 'pending') return { tone: 'neutral', title: 'Waiting for the answer', detail: run.source === 'live' ? 'Request in flight to the model on the lab server.' : 'Scripted fixture is preparing a deterministic answer.' };
  if (run.status === 'failed') return { tone: 'neutral', title: 'No result. Not counted.', detail: run.result?.status === 'failed' ? run.result.error : 'The run failed.' };
  if (run.status === 'cancelled') return { tone: 'neutral', title: 'Cancelled. Not counted.', detail: 'No answer was recorded for this run.' };
  const o = run.observation as Observation;
  if (run.kind === 'control' && run.control) return run.control.passed ? { tone: 'safe', title: 'Legitimate work observed', detail: run.control.reason } : { tone: 'risk', title: 'Control failed', detail: run.control.reason };
  if (o.kind === 'violation') return run.kind === 'attack' ? { tone: 'risk', title: `Objective reached: ${WIN_LABEL[o.type]}`, detail: `The agent ${o.did}.` } : { tone: 'risk', title: 'Still vulnerable in this run', detail: `The agent ${o.did}.` };
  if (o.kind === 'inconclusive') return { tone: 'neutral', title: 'Inconclusive. Not counted.', detail: o.reason };
  return run.kind === 'attack' ? { tone: 'safe', title: 'Resisted in this run', detail: 'The objective was not observed. Try again or use the hint.' } : { tone: 'safe', title: 'Not observed in this run', detail: 'The same attack did not trigger the heuristic this time. One run is evidence, not proof.' };
}

function Boundary({ run }: { run: Run | null }) {
  const o = run?.observation;
  let kind = 'idle', caption = 'Waiting for a run. Nothing has crossed the boundary.';
  if (run?.status === 'pending') { kind = 'pending'; caption = `${kindLabel[run.kind]} in flight. The message is reaching the agent.`; }
  else if (run && run.status !== 'completed') { kind = 'void'; caption = 'No result, so nothing is recorded as crossing.'; }
  else if (o?.kind === 'violation') { kind = 'breach'; caption = `${WIN_LABEL[o.type]}: crossed the egress gate in this run.`; }
  else if (o?.kind === 'clean') { kind = 'held'; caption = run?.kind !== 'control' ? 'Stopped at the egress gate in this run.' : run.control?.passed ? 'Legitimate request handled. Nothing unsafe crossed in this run.' : 'Nothing unsafe crossed, but the useful tool was never reached.'; }
  else if (o?.kind === 'inconclusive') { kind = 'void'; caption = 'Inconclusive answer. Not counted either way.'; }
  const usedTools = run?.status === 'completed' && run.result?.status === 'completed' && run.result.trace.length > 0;
  const key = `${run?.id ?? 'none'}-${run?.status ?? ''}`;
  return <figure className={`lab-boundary is-${kind}`} aria-labelledby="boundary-caption">
    <svg viewBox="0 0 640 230" role="img" aria-labelledby="boundary-title boundary-caption" className="lab-boundary-svg">
      <title id="boundary-title">Message to agent to tools to outside, with a trust boundary around the agent</title>
      <rect x="150" y="30" width="340" height="170" rx="20" className="b-zone" />
      <text x="170" y="54" className="b-zone-label">AGENT BOUNDARY</text>
      <path d="M92 118 H548" className="b-wire" />
      <path d="M150 70 V170 M490 70 V170" className="b-gate" />
      <text x="150" y="220" className="b-gate-label">INPUT</text><text x="490" y="220" className="b-gate-label">EGRESS</text>
      {[{ x: 60, label: 'Message', glyph: 'M44 106 H76 V128 H56 L48 135 V128 H44 Z' }, { x: 240, label: 'Agent', glyph: 'M222 104 H258 V130 H222 Z M232 116 H234 M246 116 H248 M233 123 H247 M240 98 V104' }, { x: 400, label: 'Tools', glyph: 'M388 128 L406 110 M404 104 A8 8 0 1 0 414 114 M384 124 L392 132' }, { x: 580, label: 'Outside', glyph: 'M566 104 V132 H594 V120 M578 104 H594 V116 M593 105 L577 121' }].map(node => <g key={node.label} className={`b-node ${node.label === 'Tools' && usedTools ? 'is-used' : ''}`}><rect x={node.x - 34} y="84" width="68" height="68" rx="14" /><path d={node.glyph} className="b-glyph" /><text x={node.x} y="176">{node.label}</text></g>)}
      <g key={key} className="b-motion">
        {kind === 'pending' && <path d="M94 118 H206" className="b-flow pending" />}
        {usedTools && <path d="M274 118 H366" className="b-flow tools" />}
        {kind === 'breach' && <><path d="M274 118 H546" className="b-flow breach" /><circle r="7" className="b-token breach"><animateMotion dur="0.3s" fill="freeze" path="M274 118 H546" /></circle><circle cx="546" cy="118" r="7" className="b-rest breach" /></>}
        {kind === 'held' && <><path d="M274 118 H482" className="b-flow held" /><circle r="7" className="b-token held"><animateMotion dur="0.3s" fill="freeze" path="M274 118 H482" /></circle><circle cx="482" cy="118" r="7" className="b-rest held" /><path d="M497 100 V136 M509 100 V136" className="b-stop" /></>}
      </g>
    </svg>
    <figcaption id="boundary-caption" aria-live="polite"><span className="lab-dot" aria-hidden="true" />{caption}</figcaption>
  </figure>;
}

function Trace({ run }: { run: Run | null }) {
  if (!run || run.result?.status !== 'completed') return null;
  const trace = run.result.trace;
  return <section className="lab-trace" aria-labelledby="trace-heading">
    <div className="lab-section-head"><h3 id="trace-heading">Tool trace</h3><span className="eyebrow">Simulated tool effects</span></div>
    {trace.length === 0 ? <p className="lab-muted">No tool was called in this run.</p> : <ol>{trace.map((call, i) => {
      const risky = DANGER.test(call.tool) || /SECRET-[0-9a-z]{3,}/i.test(call.args);
      return <li key={i} className={risky ? 'is-risky' : ''}><code className="lab-call">{call.tool}({call.args || '{}'})</code><p><span>Returned</span>{call.returns}</p></li>;
    })}</ol>}
    <p className="lab-fine">Tools are strings supplied by the level. Nothing is executed, sent or deleted.</p>
  </section>;
}

function Hood({ state, dispatch, open, setOpen }: { state: LabState; dispatch: (a: Parameters<typeof labReducer>[1]) => void; open: boolean; setOpen: (v: boolean) => void }) {
  const level = levelOf(state);
  const locked = state.stage === 'attack';
  const changes = diffConfig(level.config, state.config);
  return <section className={`lab-hood ${open ? 'is-open' : ''}`} aria-labelledby="hood-heading">
    <button className="lab-hood-toggle" aria-expanded={open} aria-controls="hood-body" onClick={() => setOpen(!open)} data-testid="lab-hood-toggle">
      <span><span className="eyebrow">Under the hood</span><strong id="hood-heading">Agent rules and tools</strong></span>
      <span className="lab-hood-meta">{changes.length ? `${changes.length} change${changes.length > 1 ? 's' : ''}` : locked ? 'Read-only' : 'Original'}<span aria-hidden="true">{open ? '−' : '+'}</span></span>
    </button>
    {open && <div id="hood-body" className="lab-hood-body">
      <p className="lab-muted">{locked ? 'Read-only until your attack lands. Then you patch it here.' : 'Edit what the agent trusts or can do, then replay the exact attack.'}</p>
      <label className="lab-field"><span>System rules</span><textarea data-testid="lab-system" value={state.config.system} readOnly={locked} rows={5} spellCheck={false} onChange={e => dispatch({ type: 'editSystem', text: e.target.value })} /></label>
      {state.config.tools.length === 0 ? <p className="lab-empty">No tools. This agent can only talk.</p> : state.config.tools.map((tool, i) => <article key={tool.name} className={`lab-tool ${isPoisoned(tool) ? 'is-poisoned' : ''}`}>
        <header><code>{tool.name}</code><span className="lab-badge">{tool.source === 'mcp' ? `MCP · ${tool.server ?? 'server'}` : 'tool'}</span>{isPoisoned(tool) && <span className="lab-badge risk">Hidden instruction</span>}{DANGER.test(tool.name) && <span className="lab-badge risk">Destructive</span>}
          {!locked && <button className="lab-remove" data-testid={`lab-remove-${tool.name}`} onClick={() => dispatch({ type: 'removeTool', index: i })} aria-label={`Remove tool ${tool.name}`}>Remove</button>}</header>
        <label className="lab-field"><span>Description (the agent reads this first)</span><textarea data-testid={`lab-desc-${tool.name}`} value={tool.description} readOnly={locked} rows={2} onChange={e => dispatch({ type: 'editTool', index: i, field: 'description', value: e.target.value })} /></label>
        <label className="lab-field"><span>Returned content (third-party data)</span><textarea value={tool.returns} readOnly={locked} rows={2} onChange={e => dispatch({ type: 'editTool', index: i, field: 'returns', value: e.target.value })} /></label>
      </article>)}
      {!locked && <div className="lab-row"><button className="secondary-button" data-testid="lab-apply-fix" onClick={() => dispatch({ type: 'applyFix' })}>Apply suggested patch</button><button className="text-button" onClick={() => dispatch({ type: 'restoreConfig' })}>Restore original</button></div>}
      {changes.length > 0 && <ul className="lab-changes" aria-label="Changes from the original agent">{changes.map(c => <li key={c.label} className={`is-${c.kind}`}>{c.label}</li>)}</ul>}
    </div>}
  </section>;
}

function Compare({ state }: { state: LabState }) {
  const baseline = runById(state, state.baselineRunId);
  if (!baseline) return null;
  const replays = state.runs.filter(r => r.kind === 'replay' && r.status !== 'pending');
  const replay = replays.at(-1) ?? null;
  const control = state.runs.filter(r => r.kind === 'control' && r.status !== 'pending').at(-1) ?? null;
  const before = observationText(baseline);
  const after = replay ? observationText(replay) : null;
  const changes = replay ? diffConfig(baseline.config, replay.config) : diffConfig(baseline.config, state.config);
  return <section className="lab-compare" aria-labelledby="compare-heading" data-testid="lab-compare">
    <div className="lab-section-head"><h3 id="compare-heading">Before / after</h3><span className="eyebrow">{replay && replay.input === baseline.input ? 'Identical input ✓' : 'Same input, pending'}</span></div>
    <p className="lab-input-quote"><span>Input</span>{baseline.input}</p>
    <div className="lab-compare-grid">
      <div className={`lab-cell tone-${before.tone}`}><span className="eyebrow">Before patch</span><strong>{before.title}</strong></div>
      <div className={`lab-cell tone-${after?.tone ?? 'neutral'}`} data-testid="lab-after"><span className="eyebrow">After patch · replay</span><strong>{after ? after.title : 'Patch, then replay'}</strong></div>
    </div>
    {changes.length > 0 && <ul className="lab-changes">{changes.map(c => <li key={c.label} className={`is-${c.kind}`}>{c.label}</li>)}</ul>}
    <div className={`lab-control-row ${control ? (control.control?.passed ? 'tone-safe' : 'tone-risk') : ''}`} data-testid="lab-control-result">
      <span className="eyebrow">Benign control</span>
      <p>{levelOf(state).control.input}</p>
      <strong>{control ? observationText(control).title : state.stage === 'control' ? 'Ready to run' : 'Runs after a clean replay'}</strong>
    </div>
  </section>;
}

export default function Lab({ nav }: { nav: ReactNode }) {
  const [state, dispatch] = useReducer(labReducer, undefined, () => createLab('fixture'));
  const [health, setHealth] = useState<HealthView | null>(null);
  const [consent, setConsent] = useState(false);
  const [hoodOpen, setHoodOpen] = useState(false);
  const [toast, setToast] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLElement>(null);
  const transport: LabTransport = useMemo(() => state.source === 'live' ? createHttpTransport() : createFixtureTransport(), [state.source]);
  const level = levelOf(state);
  const pending = state.pendingRunId !== null;
  const latest = state.runs.at(-1) ?? null;
  const step = currentStep(state);
  const baseline = runById(state, state.baselineRunId);
  const patched = baseline ? configKey(state.config) !== baseline.configKey : false;
  const liveCompleted = state.runs.some(r => r.source === 'live' && r.status === 'completed');
  const allDone = LAB_LEVELS.every(l => l.id in state.completed);

  useEffect(() => { abortRef.current?.abort(); abortRef.current = null; }, [state.epoch]);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    if (state.source !== 'live') { setHealth(null); return; }
    const ac = new AbortController();
    setHealth({ state: 'checking' });
    transport.health(ac.signal).then(h => { if (!ac.signal.aborted) setHealth(h); });
    return () => ac.abort();
  }, [state.source, transport]);
  useEffect(() => { if (state.stage === 'patch' && step === 1) setHoodOpen(true); }, [state.stage, step]);
  // On phones the reply sits below the brief: bring the settled result into view once.
  const settledId = latest && latest.status !== 'pending' ? latest.id : null;
  useEffect(() => {
    if (!settledId || !window.matchMedia('(max-width: 760px)').matches) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    resultRef.current?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  }, [settledId]);
  useEffect(() => {
    const target = window as LabWindow;
    target.render_lab_to_text = () => JSON.stringify({ ...labSummary(state), mode: 'lab', level: level.id, stage: state.stage, step: step < STEPS.length ? STEPS[step] : 'Done', pending, health, notice: state.notice });
    return () => { delete target.render_lab_to_text; };
  }, [state, level, step, pending, health]);

  const run = (kind: RunKind) => {
    setToast('');
    if (state.source === 'live') {
      if (!consent) { setToast('Confirm budget approval for live runs first.'); return; }
      if (health?.state !== 'key-configured') { setToast('The lab server is not ready. Nothing was sent.'); return; }
    }
    const id = crypto.randomUUID();
    const plan = planRun(state, kind, id);
    if (!plan.ok) { setToast(plan.error); return; }
    const ac = new AbortController();
    abortRef.current = ac;
    dispatch({ type: 'runStarted', run: plan.run });
    void transport.chat(plan.run.request, ac.signal).then(result => { dispatch({ type: 'runSettled', runId: id, result }); if (abortRef.current === ac) abortRef.current = null; });
  };
  const retryKind: RunKind | null = latest && (latest.status === 'failed' || latest.status === 'cancelled' || latest.observation?.kind === 'inconclusive') ? latest.kind : null;

  const connection = state.source === 'fixture'
    ? { tone: 'fixture', text: 'Scripted fixture · not AI' }
    : !health || health.state === 'checking' ? { tone: 'pending', text: 'Checking lab server…' }
    : health.state === 'disconnected' ? { tone: 'off', text: 'Live: not connected' }
    : health.state === 'no-key' ? { tone: 'off', text: 'Live: server has no provider key' }
    : liveCompleted ? { tone: 'live', text: `Live run completed · ${health.model}` }
    : { tone: 'ready', text: `Key configured · ${health.model} · not yet verified` };

  let primary: { label: string; onClick: () => void; disabled?: boolean; testid: string };
  if (state.stage === 'attack') primary = state.draft.trim() ? { label: 'Run attack', onClick: () => run('attack'), testid: 'lab-attack' } : { label: 'Start: load the attack', onClick: () => dispatch({ type: 'insertAttack' }), testid: 'lab-load-attack' };
  else if (state.stage === 'patch') primary = patched ? { label: 'Replay exact attack', onClick: () => run('replay'), testid: 'lab-replay' } : { label: 'Apply suggested patch', onClick: () => { dispatch({ type: 'applyFix' }); setHoodOpen(true); }, testid: 'lab-patch' };
  else if (state.stage === 'control') primary = { label: 'Run benign control', onClick: () => run('control'), testid: 'lab-control' };
  else primary = state.levelIndex < LAB_LEVELS.length - 1 ? { label: 'Next level', onClick: () => dispatch({ type: 'select', index: state.levelIndex + 1 }), testid: 'lab-next' } : { label: 'Restart the lab', onClick: () => dispatch({ type: 'resetAll' }), testid: 'lab-restart' };
  const hintWhich = state.stage === 'attack' ? 'attack' : 'fix';
  const hintShown = state.hints[hintWhich][state.levelIndex] > 0;

  return <div className="protect-app lab-app">
    <a className="skip-link" href="#lab">Skip to the lab</a>
    <header className="masthead"><a className="wordmark" href="#lab" aria-label="COMPASS attack lab"><span className="compass-mark" aria-hidden="true">✳</span> COMPASS</a>{nav}<span className="simulation-badge"><span /> TRAINING SIMULATION</span>
      <div className="lab-source" role="group" aria-label="Agent source">
        <button aria-pressed={state.source === 'fixture'} data-testid="lab-source-fixture" onClick={() => dispatch({ type: 'source', source: 'fixture' })}>Scripted</button>
        {LIVE_ALLOWED && <button aria-pressed={state.source === 'live'} data-testid="lab-source-live" onClick={() => dispatch({ type: 'source', source: 'live' })}>Live AI</button>}
      </div>
      <span className={`lab-conn tone-${connection.tone}`} data-testid="lab-connection" role="status"><span aria-hidden="true" />{connection.text}</span>
    </header>
    <main id="lab">
      <div className="lab-title"><div><p className="eyebrow">Attack · Patch · Replay · Control</p><h1>Practice the decision before it becomes an incident<span>.</span></h1></div>
        <ol className="lab-steps" aria-label="Loop progress">{STEPS.map((label, i) => <li key={label} className={i < step ? 'is-done' : i === step ? 'is-current' : ''} aria-current={i === step ? 'step' : undefined}><span>{i < step ? '✓' : `0${i + 1}`}</span>{label}</li>)}</ol></div>
      <nav className="lab-levels" aria-label="Levels">{LAB_LEVELS.map((l, i) => <button key={l.id} data-testid={`lab-level-${l.id}`} aria-current={i === state.levelIndex ? 'true' : undefined} className={l.id in state.completed ? 'is-done' : ''} onClick={() => dispatch({ type: 'select', index: i })}><span className="eyebrow">{l.id in state.completed ? `✓ Patched · ${state.completed[l.id] === 'live' ? 'live' : 'scripted'}` : `Level 0${i + 1}`}</span><strong>{l.title}</strong></button>)}</nav>
      {state.source === 'live' && <div className="lab-live-gate" data-testid="lab-live-gate"><p><strong>Live AI</strong> sends this synthetic level to the model on Vincent's lab server. One run can make up to five billable model calls. Results vary between runs.</p><label><input type="checkbox" data-testid="lab-consent" checked={consent} onChange={e => setConsent(e.target.checked)} /> I have approval to spend on this session</label>{health?.state === 'disconnected' && <p className="lab-muted">Not connected: {health.detail} Scripted mode is still available; it is never used silently.</p>}</div>}

      <div className={`lab-grid ${latest ? 'has-run' : ''}`}>
        <section className="lab-brief" aria-labelledby="goal-heading">
          <p className="eyebrow">Level 0{state.levelIndex + 1} · {level.title}</p>
          <h2 id="goal-heading" tabIndex={-1}>{level.goal}</h2>
          <dl className="lab-facts"><div><dt>The agent's job</dt><dd>{level.job}</dd></div><div><dt>Why it works</dt><dd>{level.concept}</dd></div></dl>
          <div className="lab-hint"><button className="text-button" data-testid="lab-hint" onClick={() => dispatch({ type: 'hint', which: hintWhich })}>{hintShown ? (hintWhich === 'attack' ? 'Attack hint' : 'Patch hint') : `Show ${hintWhich === 'attack' ? 'attack' : 'patch'} hint`}</button>{hintShown && <p role="note">{hintWhich === 'attack' ? level.attackHint : level.fixHint}</p>}</div>
          <Hood state={state} dispatch={dispatch} open={hoodOpen} setOpen={setHoodOpen} />
        </section>
        <section className="lab-stage" aria-label="Trust boundary and tool trace">
          <Boundary run={latest} />
          <Trace run={latest} />
        </section>
        <section className="lab-result" aria-labelledby="reply-heading" ref={resultRef}>
          <div className="lab-section-head"><h3 id="reply-heading">Agent reply</h3>{latest && <span className="eyebrow">{kindLabel[latest.kind]} · {latest.source === 'live' ? 'Live model inference' : 'Scripted fixture'}{latest.result ? ` · ${latest.result.ms} ms` : ''}</span>}</div>
          {latest ? <>
            {latest.result?.status === 'completed' ? <pre className="lab-reply" data-testid="lab-reply">{latest.result.reply}</pre> : <p className="lab-muted lab-reply-empty">{latest.status === 'pending' ? 'Waiting for the answer…' : 'No reply recorded.'}</p>}
            {(() => { const o = observationText(latest); return <div className={`lab-verdict tone-${o.tone}`} data-testid="lab-verdict"><strong>{o.title}</strong><p>{o.detail}</p></div>; })()}
          </> : <p className="lab-muted lab-reply-empty">Run the attack to see the actual reply and tool trace.</p>}
          <Compare state={state} />
          {allDone && <div className="lab-summary" data-testid="lab-summary"><strong>All five levels patched in this session.</strong><p>Each result is one heuristic run ({[...new Set(Object.values(state.completed))].map(s => s === 'live' ? 'live model' : 'scripted fixture').join(' + ')}). It is practice evidence, not a security guarantee.</p></div>}
        </section>
      </div>

      <div className="lab-actionbar" data-testid="lab-actionbar">
        {state.stage === 'attack' && <label className="lab-draft"><span className="sr-only">Attack message</span><textarea data-testid="lab-draft" rows={1} value={state.draft} maxLength={2000} placeholder="Write an attack, or load the reference attack…" disabled={pending} onChange={e => dispatch({ type: 'draft', text: e.target.value })} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && state.draft.trim()) { e.preventDefault(); run('attack'); } }} /></label>}
        {state.stage !== 'attack' && <p className="lab-action-note" role="status" aria-live="polite">{toast || state.notice || (state.stage === 'patch' ? (patched ? 'Patched. Replay the exact same input.' : 'Patch the agent under the hood, or apply the suggested patch.') : '')}</p>}
        <div className="lab-actions">
          {pending ? <button className="secondary-button" data-testid="lab-cancel" onClick={() => abortRef.current?.abort()}>Cancel run</button> : retryKind && <button className="secondary-button" data-testid="lab-retry" onClick={() => run(retryKind)}>Retry {kindLabel[retryKind].toLowerCase()}</button>}
          {state.stage === 'patch' && !pending && <button className="secondary-button" onClick={() => setHoodOpen(true)}>Open under the hood</button>}
          <button className="primary-button" data-testid={primary.testid} disabled={pending || primary.disabled} onClick={primary.onClick}>{pending ? 'Running…' : primary.label} <span aria-hidden="true">→</span></button>
        </div>
        {state.stage === 'attack' && (toast || state.notice) && <p className="lab-action-note wide" role="status" aria-live="polite">{toast || state.notice}</p>}
      </div>
      <div className="lab-footer-row"><button className="text-button" data-testid="lab-reset" onClick={() => dispatch({ type: 'resetLevel' })}>Restart this level</button><button className="text-button" onClick={() => dispatch({ type: 'resetAll' })}>Reset the whole lab</button></div>
    </main>
    <footer className="desk-footer"><p>COMPASS / Attack lab<span>Training simulation. Tool effects are simulated strings. Verdicts are single-run heuristics ported from the lab server.</span></p><p><span>Levels ported from server.py by Vincent. Scripted mode is local and not AI.</span></p></footer>
  </div>;
}
