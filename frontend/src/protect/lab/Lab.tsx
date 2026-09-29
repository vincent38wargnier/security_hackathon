import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createHttpTransport } from './api';
import type { Health, LabTransport, ScanReport } from './api';
import { createFixtureTransport } from './fixture';
import { configKey, createLab, diffConfig, labReducer, labSummary, levelOf, planRun, runById } from './lab-model';
import type { LabState, Run, RunKind } from './lab-model';
import { LAB_LEVELS } from './levels';
import type { LabLevel } from './levels';
import { DANGER, isPoisoned, WIN_LABEL } from './verdict';
import type { Observation } from './verdict';
import './lab.css';

// Live mode is only offered in development (Vite proxy to Vincent's local server) or when a
// deployment explicitly opts in after Vincent's server-side limits exist. Public builds stay offline.
export const LIVE_ALLOWED = import.meta.env.DEV || import.meta.env.VITE_LAB_LIVE === '1';
type LabWindow = Window & { render_lab_to_text?: () => string };
type HealthView = Health | { state: 'checking' };

const STEPS: readonly string[] = ['Inspect', 'Attack', 'Observe', 'Patch', 'Replay', 'Explain'];
// Inspect -> Attack -> Observe -> Patch -> Replay (exact replay + benign control) -> Explain.
function currentStep(state: LabState) {
  if (state.stage === 'attack') return state.runs.length === 0 && !state.draft.trim() ? 0 : state.runs.some(r => r.status !== 'pending') ? 2 : 1;
  if (state.stage === 'patch') return configKey(state.config) === runById(state, state.baselineRunId)?.configKey ? 3 : 4;
  if (state.stage === 'control') return 4;
  return 5;
}
const desktop = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 761px)').matches;

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

function Hood({ state, dispatch }: { state: LabState; dispatch: (a: Parameters<typeof labReducer>[1]) => void }) {
  const level = levelOf(state);
  const locked = state.stage === 'attack';
  const changes = diffConfig(level.config, state.config);
  return <section className="lab-hood" aria-labelledby="hood-heading">
    <div className="lab-section-head"><h3 id="hood-heading">Agent rules and tools</h3><span className="eyebrow">{changes.length ? `${changes.length} change${changes.length > 1 ? 's' : ''}` : locked ? 'Read-only until the attack works' : 'Original'}</span></div>
    <div className="lab-hood-body">
      <label className="lab-field"><span>System rules</span><textarea data-testid="lab-system" value={state.config.system} readOnly={locked} rows={4} spellCheck={false} onChange={e => dispatch({ type: 'editSystem', text: e.target.value })} /></label>
      {state.config.tools.length === 0 ? <p className="lab-empty">No tools. This agent can only talk.</p> : state.config.tools.map((tool, i) => <article key={tool.name} className={`lab-tool ${isPoisoned(tool) ? 'is-poisoned' : ''}`}>
        <header><code>{tool.name}</code><span className="lab-badge">{tool.source === 'mcp' ? `MCP · ${tool.server ?? 'server'}` : 'tool'}</span>{isPoisoned(tool) && <span className="lab-badge risk">Hidden instruction</span>}{DANGER.test(tool.name) && <span className="lab-badge risk">Destructive</span>}
          {!locked && <button className="lab-remove" data-testid={`lab-remove-${tool.name}`} onClick={() => dispatch({ type: 'removeTool', index: i })} aria-label={`Remove tool ${tool.name}`}>Remove</button>}</header>
        <label className="lab-field"><span>Description (the agent reads this first)</span><textarea data-testid={`lab-desc-${tool.name}`} value={tool.description} readOnly={locked} rows={2} onChange={e => dispatch({ type: 'editTool', index: i, field: 'description', value: e.target.value })} /></label>
        <label className="lab-field"><span>Returned content (third-party data)</span><textarea value={tool.returns} readOnly={locked} rows={2} onChange={e => dispatch({ type: 'editTool', index: i, field: 'returns', value: e.target.value })} /></label>
      </article>)}
      {!locked && <div className="lab-row"><button className="secondary-button" data-testid="lab-apply-fix" onClick={() => dispatch({ type: 'applyFix' })}>Apply suggested patch</button><button className="text-button" data-testid="lab-restore" onClick={() => dispatch({ type: 'restoreConfig' })}>Restore original</button></div>}
      {changes.length > 0 && <ul className="lab-changes" aria-label="Changes from the original agent">{changes.map(c => <li key={c.label} className={`is-${c.kind}`}>{c.label}</li>)}</ul>}
    </div>
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

function Explain({ state }: { state: LabState }) {
  const level = levelOf(state);
  const baseline = runById(state, state.baselineRunId);
  const replay = runById(state, state.cleanReplayRunId);
  const control = state.runs.filter(r => r.kind === 'control' && r.control?.passed).at(-1);
  if (state.stage !== 'done' || !baseline || !replay || !control) return null;
  const o = baseline.observation;
  return <section className="lab-explain" aria-labelledby="explain-heading" data-testid="lab-explain">
    <div className="lab-section-head"><h3 id="explain-heading">What happened</h3><span className="eyebrow">{baseline.source === 'live' ? 'Live model · this session' : 'Scripted fixture · this session'}</span></div>
    <dl>
      <div><dt>Before</dt><dd>The agent {o && o.kind === 'violation' ? o.did : 'crossed the boundary'}.</dd></div>
      <div><dt>Why</dt><dd>{level.concept}</dd></div>
      <div><dt>Changed</dt><dd>{diffConfig(baseline.config, replay.config).map(c => c.label).join(' · ') || 'Configuration edited'}</dd></div>
      <div><dt>After</dt><dd>Same input: not observed in this run. Benign control: {level.control.purpose.toLowerCase()}</dd></div>
    </dl>
    <p className="lab-fine">One run per step. A different wording or model sample can still get through.</p>
  </section>;
}

function ScanReportPanel({ transport }: { transport: LabTransport }) {
  const [report, setReport] = useState<ScanReport | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const load = () => {
    if (!transport.scan || loading) return;
    setLoading(true); setError('');
    transport.scan().then(setReport, e => setError(e instanceof Error ? e.message : 'Scan report unavailable.')).finally(() => setLoading(false));
  };
  return <details className="lab-scan" onToggle={e => { if ((e.currentTarget as HTMLDetailsElement).open && !report) load(); }}>
    <summary>Real code scan report from the lab server</summary>
    <p className="lab-muted">Reads an existing report file on Vincent's server; it does not start a scan. An empty list can mean "no report", not "no vulnerabilities".</p>
    {loading && <p className="lab-muted">Loading report…</p>}
    {error && <p className="lab-muted">Not available: {error}</p>}
    {report && <>
      <p className="lab-scan-meta" data-testid="lab-scan-status"><strong>{report.status === 'completed' ? 'Scan completed' : report.status === 'missing' ? 'No report file' : report.status === 'failed' ? 'Scan failed' : 'Status not reported'}</strong> · Engine: {report.engine} · Target: {report.target}{report.commit && ` · Commit ${report.commit}`}{report.scannedAt && ` · ${report.scannedAt}`}{report.score !== null && ` · Server score ${report.score}/10 (hackathon scorer weights, codebase not this agent)`}</p>
      {report.status === 'failed' && report.error && <p className="lab-muted">{report.error}</p>}
      {report.findings.length > 0 ? <ul>{report.findings.map(f => <li key={f.rule || f.title}><span className={`lab-sev sev-${f.sev}`}>{f.sev}</span><div><strong>{f.title}{f.count > 1 ? ` ×${f.count}` : ''}</strong><p>{f.why}</p>{f.sample && <code>{f.sample}</code>}</div></li>)}</ul>
        : <p className="lab-muted">{report.status === 'completed' ? 'The completed scan returned no mapped findings. That covers only its rules and target, not prompt-injection safety.' : 'No findings shown. Without a completed scan this is unknown, not clean.'}</p>}
    </>}
  </details>;
}

type View = 'try' | 'understand' | 'protect' | 'check';
function plainChange(label: string): string {
  let m = /^System rules: (.*)$/.exec(label);
  if (m) { const added = /\+(\d+)/.exec(m[1])?.[1]; const removed = /-(\d+)/.exec(m[1])?.[1]; return [added && `Adds ${added} rule${added === '1' ? '' : 's'} to the helper's instructions`, removed && `Removes ${removed} line${removed === '1' ? '' : 's'} from them`].filter(Boolean).join('; ') || "Edits the helper's instructions"; }
  if ((m = /^Tool (\S+) removed$/.exec(label))) return `Takes away the ${m[1]} tool`;
  if ((m = /^Tool (\S+): description rewritten$/.exec(label))) return `Rewrites what the ${m[1]} tool says about itself`;
  if ((m = /^Tool (\S+): output edited$/.exec(label))) return `Edits what the ${m[1]} tool returns`;
  return label;
}
const VIEWS: readonly View[] = ['try', 'understand', 'protect', 'check'];
const VIEW_LABEL: Record<View, string> = { try: 'Try', understand: 'Understand', protect: 'Protect', check: 'Check' };
type Primary = { label: string; action: string; onClick: () => void; disabled?: boolean };

function outcomeFor(run: Run, level: LabLevel): { tone: 'risk' | 'safe' | 'neutral'; text: string } {
  if (run.status === 'pending') return { tone: 'neutral', text: 'Testing…' };
  if (run.status === 'failed') return { tone: 'neutral', text: `The test did not run: ${run.result?.status === 'failed' ? run.result.error : 'unknown error'} Nothing was counted.` };
  if (run.status === 'cancelled') return { tone: 'neutral', text: 'Cancelled. Nothing was counted.' };
  const o = run.observation as Observation;
  if (o.kind === 'inconclusive') return { tone: 'neutral', text: `No usable answer, so it counts neither way. ${o.reason}` };
  if (o.kind === 'violation') return o.type === level.win ? { tone: 'risk', text: `It worked. ${level.plain.observed}` } : { tone: 'risk', text: `Something else went wrong: the agent ${o.did}. Test again.` };
  return { tone: 'safe', text: "The agent didn't fall for it this time. AI answers vary: test again, or ask for a hint." };
}

export default function Lab({ nav }: { nav: ReactNode }) {
  const [state, dispatch] = useReducer(labReducer, undefined, () => createLab('fixture'));
  const [health, setHealth] = useState<HealthView | null>(null);
  const [consent, setConsent] = useState(false);
  const [protecting, setProtecting] = useState(false);
  const [toast, setToast] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const chainRef = useRef(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const transport: LabTransport = useMemo(() => state.source === 'live' ? createHttpTransport() : createFixtureTransport(), [state.source]);
  const level = levelOf(state);
  const pending = state.pendingRunId !== null;
  const baseline = runById(state, state.baselineRunId);
  const patched = baseline ? configKey(state.config) !== baseline.configKey : false;
  const latest = state.runs.at(-1) ?? null;
  const lastOf = (kind: RunKind) => state.runs.filter(r => r.kind === kind).at(-1) ?? null;
  const lastAttack = lastOf('attack');
  const lastReplay = lastOf('replay');
  const lastControl = lastOf('control');
  const controlAfterReplay = lastControl && lastReplay && state.runs.indexOf(lastControl) > state.runs.indexOf(lastReplay) ? lastControl : null;
  const liveCompleted = state.runs.some(r => r.source === 'live' && r.status === 'completed');
  const last = state.levelIndex === LAB_LEVELS.length - 1;

  const view: View = state.stage === 'attack'
    ? (state.runs.some(r => r.kind === 'attack' && r.status !== 'pending') ? 'understand' : 'try')
    : state.stage === 'patch' && !patched ? (protecting ? 'protect' : 'understand')
    : 'check';

  useEffect(() => { abortRef.current?.abort(); abortRef.current = null; chainRef.current = false; setProtecting(false); setToast(''); }, [state.epoch]);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    if (state.source !== 'live') { setHealth(null); return; }
    const ac = new AbortController();
    setHealth({ state: 'checking' });
    transport.health(ac.signal).then(h => { if (!ac.signal.aborted) setHealth(h); });
    return () => ac.abort();
  }, [state.source, transport]);
  const settledId = latest && latest.status !== 'pending' ? latest.id : null;
  useEffect(() => {
    if (!settledId || !resultRef.current) return;
    const box = resultRef.current.getBoundingClientRect();
    if (box.top >= 0 && box.bottom <= window.innerHeight) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    resultRef.current.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [settledId]);
  useEffect(() => {
    const target = window as LabWindow;
    target.render_lab_to_text = () => JSON.stringify({ ...labSummary(state), mode: 'lab', level: level.id, stage: state.stage, view, pending, health, notice: state.notice });
    return () => { delete target.render_lab_to_text; };
  }, [state, level, view, pending, health]);

  const run = (kind: RunKind, from: LabState = state) => {
    setToast('');
    if (from.source === 'live') {
      if (!consent) { setToast('Tick the budget approval box below before running Live AI.'); chainRef.current = false; return; }
      if (health?.state !== 'key-configured') { setToast('The Live AI server is not ready. Nothing was sent.'); chainRef.current = false; return; }
    }
    const id = crypto.randomUUID();
    const plan = planRun(from, kind, id);
    if (!plan.ok) { setToast(plan.error); chainRef.current = false; return; }
    const ac = new AbortController();
    abortRef.current = ac;
    dispatch({ type: 'runStarted', run: plan.run });
    void transport.chat(plan.run.request, ac.signal).then(result => { dispatch({ type: 'runSettled', runId: id, result }); if (abortRef.current === ac) abortRef.current = null; });
  };
  // After "Apply and test again" / "Test again": replay, then the normal task if the replay was clean.
  useEffect(() => {
    if (!chainRef.current || pending) return;
    chainRef.current = false;
    if (state.stage === 'control') run('control');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.stage, pending]);
  const applyAndTest = () => {
    const next = labReducer(state, { type: 'applyFix' });
    dispatch({ type: 'applyFix' });
    setProtecting(false);
    chainRef.current = true;
    run('replay', next);
  };
  const testAgain = () => { chainRef.current = true; run('replay'); };

  let primary: Primary;
  if (pending) primary = { label: 'Testing…', action: 'pending', onClick: () => undefined, disabled: true };
  else if (view === 'try') primary = { label: 'Test the agent', action: 'test', onClick: () => run('attack'), disabled: !state.draft.trim() };
  else if (view === 'understand' && state.stage === 'attack') primary = { label: lastAttack && lastAttack.status !== 'completed' ? 'Try again' : 'Test again', action: 'retest', onClick: () => run('attack'), disabled: !state.draft.trim() };
  else if (view === 'understand') primary = { label: 'Add protection', action: 'protect', onClick: () => setProtecting(true) };
  else if (view === 'protect') primary = { label: 'Apply and test again', action: 'apply', onClick: applyAndTest };
  else if (state.stage === 'done') primary = last ? { label: 'Play again from challenge 1', action: 'restart', onClick: () => dispatch({ type: 'select', index: 0 }) } : { label: 'Next challenge', action: 'next', onClick: () => dispatch({ type: 'select', index: state.levelIndex + 1 }) };
  else if (state.stage === 'control') primary = { label: 'Test the normal task', action: 'normal', onClick: () => run('control') };
  else primary = { label: 'Test again', action: 'retest-protected', onClick: testAgain };

  const hintOpen = state.hints[state.stage === 'attack' ? 'attack' : 'fix'][state.levelIndex] > 0;
  const hintText = state.stage === 'attack' ? level.attackHint : level.fixHint;
  const attackOutcome = lastAttack ? outcomeFor(lastAttack, level) : null;
  const preview = diffConfig(state.config, level.fix.apply(state.config));
  const replayState = !lastReplay ? null : lastReplay.status === 'pending' ? { tone: 'neutral', text: 'Testing…' }
    : lastReplay.observation?.kind === 'clean' ? { tone: 'safe', text: 'Blocked in this run' }
    : lastReplay.observation?.kind === 'violation' ? { tone: 'risk', text: 'Still worked' }
    : { tone: 'neutral', text: 'No result, not counted' };
  const normalState = !controlAfterReplay ? { tone: 'neutral', text: lastReplay?.observation?.kind === 'clean' ? 'Not tested yet' : 'Runs after the attack is blocked' }
    : controlAfterReplay.status === 'pending' ? { tone: 'neutral', text: 'Testing…' }
    : controlAfterReplay.control?.passed ? { tone: 'safe', text: 'Still works' }
    : controlAfterReplay.status === 'completed' && controlAfterReplay.observation?.kind !== 'inconclusive' ? { tone: 'risk', text: 'Broken by the protection' }
    : { tone: 'neutral', text: 'No result, not counted' };
  let checkNote = '';
  if (state.stage === 'done') checkNote = `Protection: ${level.plain.protection} Checked once, in this run. A different wording can still get through.`;
  else if (replayState?.tone === 'risk') checkNote = 'The protection did not stop it this time. Test again, or adjust it under Technical details.';
  else if (normalState.tone === 'risk') checkNote = controlAfterReplay?.control?.reason ?? 'The normal task failed.';
  else if (state.notice && !pending && view === 'check') checkNote = state.notice;
  const badge = state.source === 'live' ? 'Live AI' : 'Simulation';
  const liveStatus = state.source !== 'live' ? '' : !health || health.state === 'checking' ? 'Checking the Live AI server…'
    : health.state === 'disconnected' ? 'Live AI server not reachable. Nothing will be sent.'
    : health.state === 'no-key' ? 'Live AI server has no model key. Nothing will be sent.'
    : liveCompleted ? `Live AI answered (${health.model}).` : `Server ready (${health.model}). Not tested yet.`;

  return <div className="protect-app lab-app play-app">
    <a className="skip-link" href="#play">Skip to the challenge</a>
    <header className="play-header"><a className="wordmark" href="#play" aria-label="COMPASS"><span className="compass-mark" aria-hidden="true">✳</span> COMPASS</a>
      <span className={`play-badge is-${state.source}`} data-testid="lab-badge" title={state.source === 'live' ? 'Real answers from the lab server. One run proves nothing universal.' : 'Pre-scripted results. Not a real AI model.'}><span aria-hidden="true" />{badge}</span>
    </header>
    <main id="play" className="play-main">
      <p className="play-progress" data-testid="lab-progress"><span>Challenge {state.levelIndex + 1} of {LAB_LEVELS.length}</span>
        <span className="play-steps" aria-label={`Step ${VIEWS.indexOf(view) + 1} of 4: ${VIEW_LABEL[view]}`}>{VIEWS.map((v, i) => <i key={v} className={i < VIEWS.indexOf(view) ? 'is-done' : v === view ? 'is-current' : ''} aria-hidden="true" />)}<b>{VIEW_LABEL[view]}</b></span></p>
      <section className="play-card" aria-labelledby="play-title">
        <h1 id="play-title">{level.plain.title}</h1>
        <p className="play-situation">{level.plain.situation}</p>
        <p className="play-mission"><strong>Your move:</strong> {level.plain.mission}</p>

        {(view === 'try' || view === 'understand') && <label className="play-message"><span>Your test message{state.stage === 'attack' ? ' (you can edit it)' : ''}</span>
          <textarea data-testid="lab-message" rows={3} value={state.stage === 'attack' ? state.draft : baseline?.input ?? state.draft} readOnly={state.stage !== 'attack' || pending} maxLength={2000} onChange={e => dispatch({ type: 'draft', text: e.target.value })} /></label>}

        {view === 'protect' && <div className="play-protect" data-testid="lab-protect-card">
          <h2>The protection</h2>
          <p>{level.plain.protection}</p>
          {preview.length > 0 && <ul aria-label="What will change">{preview.map(c => <li key={c.label}>{plainChange(c.label)}</li>)}</ul>}
          <p className="play-fine">Then the exact same message is sent again, with a fresh conversation.</p>
        </div>}

        {view === 'check' && <div className="play-check" data-testid="lab-check">
          <div className={`play-check-row tone-${replayState?.tone ?? 'neutral'}`} data-testid="lab-check-attack"><span>Attack test</span><strong>{replayState?.text ?? 'Not tested yet'}</strong></div>
          <div className={`play-check-row tone-${normalState.tone}`} data-testid="lab-check-normal"><span>Normal task <small>{level.plain.normalTask}</small></span><strong>{normalState.text}</strong></div>
          {checkNote && <p className="play-note" role="status">{checkNote}</p>}
        </div>}

        {view === 'understand' && lastAttack && <div className="play-result" ref={resultRef} data-testid="lab-result" aria-live="polite">
          {lastAttack.result?.status === 'completed' && <><span className="play-label">The agent answered</span><pre className="play-answer" data-testid="lab-answer">{lastAttack.result.reply}</pre></>}
          {attackOutcome && <p className={`play-outcome tone-${attackOutcome.tone}`} data-testid="lab-outcome">{attackOutcome.text}</p>}
        </div>}
        <div className="play-actions">
          <button className="primary-button play-primary" data-testid="lab-primary" data-action={primary.action} disabled={primary.disabled} onClick={primary.onClick}>{primary.label}<span aria-hidden="true">→</span></button>
          {pending && <button className="text-button" data-testid="lab-cancel" onClick={() => abortRef.current?.abort()}>Cancel</button>}
          {view === 'protect' && !pending && <button className="text-button" onClick={() => setProtecting(false)}>Back</button>}
          {!pending && view !== 'protect' && state.stage !== 'done' && <button className="text-button" data-testid="lab-hint" aria-expanded={hintOpen} onClick={() => dispatch({ type: 'hint', which: state.stage === 'attack' ? 'attack' : 'fix' })}>Need a hint?</button>}
        </div>
        {toast && <p className="play-toast" role="alert" data-testid="lab-toast">{toast}</p>}
        {hintOpen && view !== 'protect' && state.stage !== 'done' && <p className="play-hint" role="note" data-testid="lab-hint-text">{hintText}</p>}

        {view === 'check' && <div ref={resultRef} />}
      </section>

      <div className="play-options">
        <label className="play-select"><span>Challenge</span><select data-testid="lab-challenge" value={state.levelIndex} onChange={e => dispatch({ type: 'select', index: Number(e.target.value) })}>{LAB_LEVELS.map((l, i) => <option key={l.id} value={i}>{i + 1}. {l.plain.title}{l.id in state.completed ? ' ✓' : ''}</option>)}</select></label>
        <div className="play-mode" role="group" aria-label="Answers come from">
          <button aria-pressed={state.source === 'fixture'} data-testid="lab-source-fixture" onClick={() => dispatch({ type: 'source', source: 'fixture' })}>Simulation</button>
          {LIVE_ALLOWED ? <button aria-pressed={state.source === 'live'} data-testid="lab-source-live" onClick={() => dispatch({ type: 'source', source: 'live' })}>Live AI</button> : <button disabled title="Live AI stays off on the public site until the lab server enforces access, rate and spend limits.">Live AI (off)</button>}
        </div>
        <button className="text-button" data-testid="lab-reset" onClick={() => dispatch({ type: 'resetLevel' })}>Start this challenge over</button>
        {nav}
      </div>
      {state.source === 'live' && <div className="play-live" data-testid="lab-live-gate"><p data-testid="lab-connection" role="status">{liveStatus}</p><label><input type="checkbox" data-testid="lab-consent" checked={consent} onChange={e => setConsent(e.target.checked)} /> I have approval to spend on Live AI calls (up to 5 model calls per test)</label></div>}

      <details className="play-details" data-testid="lab-details">
        <summary>Technical details</summary>
        <div className="play-details-body">
          <Boundary run={latest} />
          {latest?.result?.status === 'completed' && <section className="lab-trace"><div className="lab-section-head"><h3>Latest raw answer</h3><span className="eyebrow">{kindLabel[latest.kind]} · {latest.source === 'live' ? 'Live model' : 'Simulation'} · {latest.result.ms} ms</span></div><pre className="lab-reply">{latest.result.reply}</pre></section>}
          <Trace run={latest} />
          <Hood state={state} dispatch={dispatch} />
          <Compare state={state} />
          <Explain state={state} />
          {state.source === 'live' && <ScanReportPanel transport={transport} />}
        </div>
      </details>
    </main>
    <footer className="play-footer"><p>{state.source === 'live' ? 'Live AI: real answers from the lab server.' : 'Simulation: pre-scripted results, not a real AI model.'} Tool effects are always pretend. One test is evidence, not a guarantee.</p></footer>
  </div>;
}
