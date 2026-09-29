import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createHttpTransport } from './api';
import type { Health, LabTransport, ScanReport } from './api';
import { createFixtureTransport } from './fixture';
import { configKey, createLab, diffConfig, labReducer, labSummary, levelOf, planRun, runById } from './lab-model';
import type { LabState, Run, RunKind } from './lab-model';
import { LAB_LEVELS } from './levels';
import type { LabLevel } from './levels';
import type { TraceCall } from './verdict';
import { DANGER, isPoisoned, WIN_LABEL } from './verdict';
import type { Observation } from './verdict';
import './lab.css';
import '../playground.css';

// Live mode is only offered in development (Vite proxy to Vincent's local server) or when a
// deployment explicitly opts in after Vincent's server-side limits exist. Public builds stay offline.
export const LIVE_ALLOWED = import.meta.env.DEV || import.meta.env.VITE_LAB_LIVE === '1';
type LabWindow = Window & { render_lab_to_text?: () => string };
type HealthView = Health | { state: 'checking' };


const kindLabel: Record<RunKind, string> = { attack: 'Attack', replay: 'Exact replay', control: 'Benign control', probe: 'New trick' };

function observationText(run: Run): { tone: 'risk' | 'safe' | 'neutral'; title: string; detail: string } {
  if (run.status === 'pending') return { tone: 'neutral', title: 'Waiting for the answer', detail: run.source === 'live' ? 'Request in flight to the model on the lab server.' : 'The Simulation is preparing a deterministic answer.' };
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
    <div className="lab-section-head"><h3 id="explain-heading">What happened</h3><span className="eyebrow">{baseline.source === 'live' ? 'Live model · this session' : 'Simulation · this session'}</span></div>
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


const ICON: Record<LabLevel['id'], string> = { direct: '💬', toolpoison: '🧰', mcp: '📄', exfil: '🔑', confused: '💥' };
const WELCOME_KEY = 'compass-playground-welcome';
const clipText = (text: string, n: number) => (text.length > n ? `${text.slice(0, n)} …` : text);
type Card = { tone: 'win' | 'safe' | 'neutral'; title: string; body?: string };

function cardFor(run: Run, level: LabLevel): Card | null {
  if (run.status !== 'completed') return null;
  const o = run.observation as Observation;
  if (o.kind === 'inconclusive') return { tone: 'neutral', title: 'No usable answer. Not counted.', body: o.reason };
  const hit = o.kind === 'violation' && o.type === level.win;
  const other = o.kind === 'violation' && !hit ? o : null;
  switch (run.kind) {
    case 'attack':
      if (hit) return { tone: 'win', title: `😈 It worked: the AI ${o.did}.`, body: level.plain.observed };
      if (other) return { tone: 'neutral', title: `Something else slipped: the AI ${other.did}.`, body: 'Interesting, but the objective is still open.' };
      return { tone: 'safe', title: '🛡️ The AI resisted.', body: 'Try your own wording, paste something sneakier, or press 💡 Show solution.' };
    case 'replay':
      if (hit) return { tone: 'win', title: `💥 Still works: the AI ${o.did}.`, body: 'Change the rules again, or press 💡 Show the fix.' };
      return { tone: 'safe', title: '✅ Blocked: the same trick did nothing this time.', body: 'Next: making sure the AI can still do its normal job.' };
    case 'control':
      if (run.control?.passed) return { tone: 'safe', title: '✅ It still does its normal job.', body: `💡 ${level.concept}` };
      return { tone: 'win', title: '⚠️ Your patch broke the normal job.', body: run.control?.reason };
    case 'probe':
      if (hit) return { tone: 'win', title: `🕳️ Found a hole: the AI ${o.did}.`, body: 'Patch it again, then press ▶ Test my patch.' };
      if (other) return { tone: 'neutral', title: `Something else slipped: the AI ${other.did}.` };
      return { tone: 'safe', title: '🛡️ Your patch held against this one.', body: 'Try another trick, or go to the next level.' };
  }
}

function TraceCard({ call }: { call: TraceCall }) {
  const risky = DANGER.test(call.tool) || /SECRET-[0-9a-z]{3,}/i.test(call.args);
  return <div className={`trace${risky ? ' danger' : ''}`} data-testid="pg-trace">
    <div className="tt"><span className="arw">▸</span> the AI used a tool</div>
    <div className="row"><span className="fn">{call.tool}</span>(<span className="k">{call.args || '{}'}</span>)</div>
    <div className="row ret"><span className="k">↩ it read back:</span> {clipText(call.returns, 300)}</div>
  </div>;
}

const LEAD: Record<RunKind, string> = { attack: '', replay: 'Testing your patch with the same trick…', control: 'Now the normal job: can the AI still help?', probe: 'Trying a new trick against your patch…' };

function Turn({ run, level }: { run: Run; level: LabLevel }) {
  const card = cardFor(run, level);
  return <div className="turn" data-testid="pg-turn" data-kind={run.kind} data-status={run.status}>
    {LEAD[run.kind] && <div className="sysline">{LEAD[run.kind]}</div>}
    <div className="msg user">{clipText(run.input, 700)}</div>
    {run.status === 'pending' && <div className="msg bot" aria-label="The AI is answering"><span className="spin"><i /><i /><i /></span></div>}
    {run.status === 'failed' && <div className="sysline" role="alert">⚠️ The test did not run: {run.result?.status === 'failed' ? run.result.error : 'unknown error'} Nothing was counted.</div>}
    {run.status === 'cancelled' && <div className="sysline">Cancelled. Nothing was counted.</div>}
    {run.result?.status === 'completed' && <>
      {run.result.trace.map((call, i) => <TraceCard key={i} call={call} />)}
      <div className="msg bot" data-testid="lab-answer">{run.result.reply}</div>
    </>}
    {card && <div className={`result ${card.tone}`} data-testid="lab-outcome" data-tone={card.tone}><h4>{card.title}</h4>{card.body && <div className="concept">{card.body}</div>}</div>}
  </div>;
}

function Editor({ state, dispatch, onClose, action }: { state: LabState; dispatch: (a: Parameters<typeof labReducer>[1]) => void; onClose: () => void; action: ReactNode }) {
  const level = levelOf(state);
  const hacking = state.stage === 'attack';
  const changes = diffConfig(level.config, state.config);
  return <aside className="col left" aria-labelledby="pg-editor-title" data-testid="pg-editor">
    <div className="phead"><h2 id="pg-editor-title">{hacking ? '🧪 Rig the world' : "🔧 The AI's rules"}</h2><div className="actions"><button className="btn ghost sm" onClick={onClose}>Close</button></div></div>
    <div className="pbody">
      <p className="hood-intro">{hacking
        ? 'You are the attacker. Paste your own hidden order into a tool below (its description or what it returns), then chat. The AI\'s rules stay locked until you hack it.'
        : 'Change the rules or remove a tool, then press ▶ Test my patch. Paste your own rules if you like.'}</p>
      <div className="editor"><div className="bar"><i /><i /><i /><span className="name">your_ai_rules.txt{hacking ? ' (locked)' : ''}</span></div>
        <textarea data-testid="lab-system" aria-label="The AI's rules" value={state.config.system} readOnly={hacking} rows={7} spellCheck={false} onChange={e => dispatch({ type: 'editSystem', text: e.target.value })} /></div>
      <div className="phead sub"><h2>🧰 Tools the AI can use</h2></div>
      {state.config.tools.length === 0 ? <div className="empty">No tools. This AI can only talk.</div> : state.config.tools.map((tool, i) => <div key={tool.name} className={`tool${isPoisoned(tool) ? ' poison' : ''}`} data-testid={`pg-tool-${tool.name}`}>
        <div className="th"><span className="nm">{tool.name}</span><span className="src">{tool.source === 'mcp' ? `MCP · ${tool.server ?? 'server'}` : 'tool'}</span>
          {isPoisoned(tool) && <span className="flag">hidden order</span>}{DANGER.test(tool.name) && <span className="flag">destructive</span>}
          {!hacking && <button className="btn ghost sm del" data-testid={`lab-remove-${tool.name}`} onClick={() => dispatch({ type: 'removeTool', index: i })} aria-label={`Remove tool ${tool.name}`}>Remove</button>}</div>
        <div className="body">
          <div><label htmlFor={`d-${tool.name}`}>Description (the AI reads this)</label><div className="field"><textarea id={`d-${tool.name}`} data-testid={`lab-desc-${tool.name}`} value={tool.description} rows={2} spellCheck={false} onChange={e => dispatch({ type: 'editTool', index: i, field: 'description', value: e.target.value })} /></div></div>
          <div><label htmlFor={`r-${tool.name}`}>What it returns (written by someone else)</label><div className="field"><textarea id={`r-${tool.name}`} data-testid={`lab-returns-${tool.name}`} value={tool.returns} rows={3} spellCheck={false} onChange={e => dispatch({ type: 'editTool', index: i, field: 'returns', value: e.target.value })} /></div></div>
        </div>
      </div>)}
      <div className="pg-row"><button className="btn ghost sm" data-testid="lab-restore" onClick={() => dispatch({ type: 'restoreConfig' })}>↺ Restore original</button></div>
      {changes.length > 0 && <ul className="pg-changes" aria-label="Your changes">{changes.map(c => <li key={c.label}>{c.label}</li>)}</ul>}
    </div>
    <div className="pg-editor-actions">{action}<button className="btn ghost" onClick={onClose}>Back to chat</button></div>
  </aside>;
}

export default function Lab({ nav }: { nav: ReactNode }) {
  const [state, dispatch] = useReducer(labReducer, undefined, () => createLab('fixture'));
  const [health, setHealth] = useState<HealthView | null>(null);
  const [consent, setConsent] = useState(false);
  const [editing, setEditing] = useState(false);
  const [toast, setToast] = useState('');
  const [welcome, setWelcome] = useState(() => { try { return !window.localStorage.getItem(WELCOME_KEY); } catch { return true; } });
  const abortRef = useRef<AbortController | null>(null);
  const chainRef = useRef(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const transport: LabTransport = useMemo(() => state.source === 'live' ? createHttpTransport() : createFixtureTransport(), [state.source]);
  const level = levelOf(state);
  const pending = state.pendingRunId !== null;
  const hacking = state.stage === 'attack';
  const last = state.levelIndex === LAB_LEVELS.length - 1;
  const liveCompleted = state.runs.some(r => r.source === 'live' && r.status === 'completed');
  const totalStars = Object.values(state.stars).reduce((a, b) => a + b, 0);
  useEffect(() => { abortRef.current?.abort(); abortRef.current = null; chainRef.current = false; setEditing(false); setToast(''); }, [state.epoch]);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    if (state.source !== 'live') { setHealth(null); return; }
    const ac = new AbortController();
    setHealth({ state: 'checking' });
    transport.health(ac.signal).then(h => { if (!ac.signal.aborted) setHealth(h); });
    return () => ac.abort();
  }, [state.source, transport]);
  const hintOpen = state.hints[hacking ? 'attack' : 'fix'][state.levelIndex] > 0 && state.stage !== 'done';
  useEffect(() => { const el = chatRef.current; if (el) el.scrollTop = el.scrollHeight; }, [state.runs, hintOpen, toast]);
  useEffect(() => {
    const target = window as LabWindow;
    target.render_lab_to_text = () => JSON.stringify({ ...labSummary(state), mode: 'lab', level: level.id, stage: state.stage, view: state.stage, editing, pending, health, notice: state.notice });
    return () => { delete target.render_lab_to_text; };
  }, [state, level, editing, pending, health]);
  const closeWelcome = () => { setWelcome(false); try { window.localStorage.setItem(WELCOME_KEY, '1'); } catch { /* private mode */ } inputRef.current?.focus(); };
  useEffect(() => {
    if (!welcome) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeWelcome(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const run = (kind: RunKind, from: LabState = state) => {
    setToast('');
    if (from.source === 'live') {
      if (!consent) { setToast('Tick the budget approval box above before running Live AI. Nothing was sent.'); chainRef.current = false; return; }
      if (health?.state !== 'key-configured') { setToast('The Live AI server is not ready. Nothing was sent.'); chainRef.current = false; return; }
    }
    const id = crypto.randomUUID();
    const plan = planRun(from, kind, id);
    if (!plan.ok) { setToast(plan.error); chainRef.current = false; return; }
    const ac = new AbortController();
    abortRef.current = ac;
    dispatch({ type: 'runStarted', run: plan.run });
    if (kind === 'attack' || kind === 'probe') dispatch({ type: 'draft', text: '' });
    void transport.chat(plan.run.request, ac.signal).then(result => { dispatch({ type: 'runSettled', runId: id, result }); if (abortRef.current === ac) abortRef.current = null; });
  };
  // "Test my patch": exact replay, then the normal job if the replay was clean.
  useEffect(() => {
    if (!chainRef.current || pending) return;
    chainRef.current = false;
    if (state.stage === 'control') run('control');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.stage, pending]);
  const narrow = () => window.matchMedia('(max-width: 700px)').matches;
  const testPatch = () => { if (narrow()) setEditing(false); chainRef.current = true; run('replay'); };
  const applyFix = () => { dispatch({ type: 'applyFix' }); setEditing(true); setToast(''); };
  const send = () => { if (!pending && state.draft.trim()) run(hacking ? 'attack' : 'probe'); };
  const insertAttack = () => { dispatch({ type: 'insertAttack' }); inputRef.current?.focus(); };
  const stars = state.stars[level.id] ?? 0;
  const steps = ['1 Hack it', '2 Patch it', '3 Done'];
  const stepIndex = hacking ? 0 : state.stage === 'done' ? 2 : 1;
  const badge = 'Live AI';
  const liveStatus = state.source !== 'live' ? '' : !health || health.state === 'checking' ? 'Checking the Live AI server…'
    : health.state === 'disconnected' ? 'Live AI server not reachable. Nothing will be sent.'
    : health.state === 'no-key' ? 'Live AI server has no model key. Nothing will be sent.'
    : liveCompleted ? `Live AI answered (${health.model}).` : `Server ready (${health.model}). Not tested yet.`;
  let goal: ReactNode;
  let actions: ReactNode;
  if (hacking) {
    goal = <>{level.goal}<span className="job">🤖 The AI's job: {level.job}</span></>;
    actions = <>
      <button className="btn sm" data-testid="lab-insert" onClick={insertAttack}>⚡ Insert attack</button>
      <button className="btn ghost sm" data-testid="lab-hint" onClick={() => dispatch({ type: 'hint', which: 'attack' })}>💡 Show solution</button>
      {level.config.tools.length > 0 && <button className="btn ghost sm" data-testid="lab-rig" aria-pressed={editing} onClick={() => setEditing(!editing)}>🧪 Rig the tools</button>}
    </>;
  } else if (state.stage === 'done') {
    goal = <>Your patch blocked this trick and the AI still does its job. <span className="dim">Other tricks might still work: try one below.</span><span className="job" aria-label={`${stars} of 3 stars`}>{'⭐'.repeat(stars)}{'☆'.repeat(3 - stars)} {stars === 3 ? 'No hints used.' : 'Beat it without hints for the third star.'}</span></>;
    actions = <>
      {last ? <button className="btn sm" data-testid="lab-primary" data-action="restart" onClick={() => dispatch({ type: 'select', index: 0 })}>↺ Play again</button>
        : <button className="btn sm" data-testid="lab-primary" data-action="next" onClick={() => dispatch({ type: 'select', index: state.levelIndex + 1 })}>Next level →</button>}
      <button className="btn ghost sm" data-testid="lab-reset" onClick={() => dispatch({ type: 'resetLevel' })}>↺ Replay</button>
    </>;
  } else {
    const failedNormal = state.runs.filter(r => r.kind === 'control' && r.status === 'completed').at(-1)?.control?.passed === false && state.stage === 'patch';
    const hole = state.runs.find(r => r.id === state.baselineRunId)?.kind === 'probe';
    goal = state.stage === 'control' ? <>Blocked. Now check that the AI can still do its normal job.</>
      : hole ? <>You found a hole in your own patch. <b>Make this new trick fail too.</b></>
      : failedNormal ? <>Blocked, but your patch broke the normal job. <b>Loosen it and test again.</b></>
      : <>It worked. Now change the AI so the <b>same trick fails</b>.</>;
    actions = <>
      {state.stage === 'control' ? <button className="btn sm" data-testid="lab-primary" data-action="normal" disabled={pending} onClick={() => run('control')}>▶ Test the normal job</button>
        : editing ? <button className="btn sm" data-testid="lab-primary" data-action="test-patch" disabled={pending} onClick={testPatch}>▶ Test my patch</button>
        : <button className="btn sm" data-testid="lab-primary" data-action="edit" onClick={() => setEditing(true)}>🔧 Edit the AI's rules</button>}
      <button className="btn ghost sm" data-testid="lab-hint" onClick={() => dispatch({ type: 'hint', which: 'fix' })}>💡 Show the fix</button>
    </>;
  }
  return <div className={`pg${editing ? ' editing' : ''}`}>
    <a className="skip-link" href="#pg-input">Skip to the chat box</a>
    <header className="pg-header">
      <div className="brand"><div className="mark" aria-hidden="true">🕵️</div><h1>Prompt Injection Playground</h1></div>
      <span className="sandbox">🧪 practice world</span>
      <div className="hspace">
        <span className="pg-stars" data-testid="pg-stars" aria-label={`${totalStars} of ${LAB_LEVELS.length * 3} stars`}>⭐ {totalStars}/{LAB_LEVELS.length * 3}</span>
        <div className="pg-mode" role="group" aria-label="Answers come from">
          <button aria-pressed={state.source === 'fixture'} data-testid="lab-source-fixture" title="A rule-based practice AI running in your browser. Not a real model." onClick={() => dispatch({ type: 'source', source: 'fixture' })}>Simulation</button>
          {LIVE_ALLOWED ? <button aria-pressed={state.source === 'live'} data-testid="lab-source-live" onClick={() => dispatch({ type: 'source', source: 'live' })}>Live AI</button>
            : <button disabled title="Live AI stays off on the public site until the lab server enforces access, rate and spend limits.">Live AI (off)</button>}
        </div>
        {state.source === 'live' && <div className="status" data-testid="lab-badge" title="Real answers from the lab server. One run proves nothing universal."><span className={`dot${health?.state === 'key-configured' ? ' live' : ' off'}`} />{badge}</div>}
        {nav}
      </div>
    </header>
    <nav className="path" aria-label="Levels"><span className="lbl">Levels</span>
      {LAB_LEVELS.map((l, i) => <button key={l.id} data-testid={`pg-level-${i}`} className={`lv${l.id in state.completed ? ' done' : ''}${i === state.levelIndex ? ' active' : ''}`} aria-current={i === state.levelIndex ? 'step' : undefined} onClick={() => dispatch({ type: 'select', index: i })}>
        <span className="ic" aria-hidden="true">{ICON[l.id]}</span>{l.title}<span className="st">{l.id in state.completed ? '✓' : i + 1}</span></button>)}
    </nav>
    {state.source === 'live' && <div className="pg-live" data-testid="lab-live-gate"><span data-testid="lab-connection" role="status">{liveStatus}</span><label><input type="checkbox" data-testid="lab-consent" checked={consent} onChange={e => setConsent(e.target.checked)} /> I have approval to spend on Live AI calls (up to 2 model calls per test)</label></div>}
    <div className="wrap">
      {editing && <Editor state={state} dispatch={dispatch} onClose={() => setEditing(false)} action={hacking ? null : <button className="btn" data-testid="lab-editor-test" disabled={pending} onClick={testPatch}>▶ Test my patch</button>} />}
      <main className="col right" aria-labelledby="pg-chat-title">
        <div className="phead"><h2 id="pg-chat-title">💬 Chat with the AI</h2><div className="actions"><button className="btn ghost sm" data-testid="lab-restart" onClick={() => dispatch({ type: 'resetLevel' })}>↺ Restart level</button></div></div>
        <section className={`obj${hacking ? '' : ' def'}`} data-testid="pg-objective" aria-label={`Level ${state.levelIndex + 1} of ${LAB_LEVELS.length}`}>
          <div className="steps">{steps.map((t, k) => <span key={t} className={k === stepIndex ? 'on' : k < stepIndex ? 'ok' : ''}>{k < stepIndex ? '✓ ' : ''}{t}</span>)}</div>
          <div className="goal" data-testid="pg-goal">{goal}</div>
          <div className="row">{actions}</div>
        </section>
        <div className="chat" ref={chatRef} data-testid="pg-chat" aria-live="polite">
          <div className="sysline">Level {state.levelIndex + 1} · <b>{level.title}</b>. {level.plain.situation}</div>
          {state.runs.map(r => <Turn key={r.id} run={r} level={level} />)}
          {hintOpen && (hacking
            ? <div className="hintcard" data-testid="lab-hint-text"><h4>💡 The solution</h4><p>{level.attackHint}</p><div className="sol">{level.attack}</div><button className="btn warn sm" onClick={insertAttack}>⚡ Insert this attack</button></div>
            : <div className="hintcard" data-testid="lab-hint-text"><h4>💡 The fix</h4><p>{level.fixHint}</p><button className="btn warn sm" data-testid="lab-apply-fix" onClick={applyFix}>🔧 Apply this fix for me</button></div>)}
          {toast && <div className="sysline pg-toast" role="alert" data-testid="lab-toast">{toast}</div>}
          <details className="pg-details" data-testid="lab-details">
            <summary>🔍 Under the hood (technical details)</summary>
            <div className="pg-details-body">
              <Boundary run={state.runs.at(-1) ?? null} />
              <Trace run={state.runs.at(-1) ?? null} />
              <Compare state={state} />
              <Explain state={state} />
              {state.source === 'live' && <ScanReportPanel transport={transport} />}
            </div>
          </details>
        </div>
        <form className="composer" onSubmit={e => { e.preventDefault(); send(); }}>
          <div className="field"><textarea id="pg-input" ref={inputRef} data-testid="lab-message" rows={2} value={state.draft} maxLength={2000} aria-label="Message to the AI"
            placeholder={hacking ? 'Type or paste anything: a question, an email, a document with a hidden order…' : 'Try to break your own patch: type or paste a new trick…'}
            onChange={e => dispatch({ type: 'draft', text: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} /></div>
          {pending ? <button type="button" className="btn ghost" data-testid="lab-cancel" onClick={() => abortRef.current?.abort()}>Cancel</button>
            : <button type="submit" className="btn" data-testid="lab-send" disabled={!state.draft.trim()}>Send</button>}
        </form>
        <p className="pg-foot">{state.source === 'live' ? 'Live AI: real answers from the lab server, which can vary.' : 'Simulation: a rule-based practice AI in your browser, not a real model. Real AIs are less predictable.'} Tools are pretend: nothing is sent or deleted.</p>
      </main>
    </div>
    {welcome && <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="pg-welcome-title" data-testid="pg-welcome"><div className="welcome">
      <div className="big" aria-hidden="true">🕵️</div><h2 id="pg-welcome-title">Can you hack an AI?</h2>
      <p>AI helpers follow instructions. But a sneaky instruction can be <b>hidden inside a note, a tool, or a website</b> the AI reads, and sometimes the AI obeys it by mistake. That's <b>prompt injection</b>.</p>
      <div className="steps">
        <div className="step"><div className="e" aria-hidden="true">🎯</div><div className="h">Get the objective</div><div className="d">Each level asks you to make the AI do something it shouldn't.</div></div>
        <div className="step"><div className="e" aria-hidden="true">😈</div><div className="h">Hack it</div><div className="d">Type or paste your own attack. Stuck? Hit the hint.</div></div>
        <div className="step"><div className="e" aria-hidden="true">🛡️</div><div className="h">Patch it</div><div className="d">Rewrite the AI's rules so the attack fails and it still does its job.</div></div>
      </div>
      <p className="note">🧪 <b>Practice world.</b> The AI here is a rule-based simulation in your browser. Every note and event is pretend. Nothing real can break.</p>
      <button className="btn big" data-testid="pg-start" autoFocus onClick={closeWelcome}>Start hacking →</button>
    </div></div>}
  </div>;
}
