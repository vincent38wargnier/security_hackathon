import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { canDecide, createGame, gameReducer, gameSummary, scenarios } from './model';
import type { GameAction, GameState } from './model';
import { createTrainingBridge, MAX_PROPOSAL_BYTES } from './agent-bridge';
import type { AgentProposal, TrainingAPI } from './agent-bridge';
import './protect.css';

type GameWindow = Window & { render_game_to_text?: () => string; advanceTime?: (ms: number) => void; compassTraining?: TrainingAPI };

function downloadJSON(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function AgentPanel({ state, dispatch }: { state: GameState; dispatch: (action: GameAction) => void }) {
  const [proposal, setProposal] = useState<AgentProposal | null>(null);
  const [notice, setNotice] = useState('');
  const stateRef = useRef(state);
  const bridgeRef = useRef<ReturnType<typeof createTrainingBridge> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const importSequence = useRef(0);
  useLayoutEffect(() => { stateRef.current = state; }, [state]);
  useLayoutEffect(() => {
    const bridge = createTrainingBridge(() => stateRef.current, setProposal);
    const target = window as GameWindow;
    bridgeRef.current = bridge;
    target.compassTraining = bridge.api;
    return () => {
      importSequence.current++;
      bridge.dispose();
      if (target.compassTraining === bridge.api) delete target.compassTraining;
      bridgeRef.current = null;
    };
  }, []);

  const importFile = async (file: File) => {
    const sequence = ++importSequence.current;
    const bridge = bridgeRef.current;
    setNotice('');
    if (file.size > MAX_PROPOSAL_BYTES) { setNotice('Proposal must be 16 KB or smaller.'); return; }
    try {
      const text = await file.text();
      if (sequence !== importSequence.current || !bridge || bridge !== bridgeRef.current) return;
      const result = bridge.api.propose(text);
      setNotice(result.ok ? 'Proposal imported. Review it before confirming.' : result.error);
    } catch {
      if (sequence === importSequence.current && bridge === bridgeRef.current) setNotice('Could not read that file. Choose a JSON proposal.');
    }
  };

  return <section className="agent-panel" data-testid="agent-panel" aria-labelledby="agent-heading">
    <div className="agent-intro"><div><p className="eyebrow">YOUR AGENT / YOUR DECISION</p><h2 id="agent-heading">Bring your agent</h2></div><p data-testid="agent-status">Agent proposals only. Local simulation. No live provider connected</p></div>
    <div className="agent-tools"><p>Export this case, ask your agent for a proposal, then import its JSON. You make the final call.</p><div className="agent-actions">
      <button data-testid="agent-export" className="secondary-button" disabled={state.phase !== 'playing'} onClick={() => { const challenge = bridgeRef.current?.api.getChallenge(); if (challenge) downloadJSON(challenge, `compass-challenge-${challenge.scenarioId}.json`); }}>Export challenge JSON</button>
      <button data-testid="agent-import-button" className="secondary-button" disabled={state.phase !== 'playing'} onClick={() => fileInput.current?.click()}>Import proposal JSON</button>
      <input ref={fileInput} data-testid="agent-import" type="file" accept=".json,application/json" hidden disabled={state.phase !== 'playing'} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void importFile(file); }} />
    </div></div>
    <p className="agent-notice" data-testid="agent-notice" role="status">{notice || (state.phase !== 'playing' ? 'Start or resume an incident to exchange a challenge.' : 'JSON only, up to 16 KB. No credentials needed.')}</p>
    {proposal && <div className="agent-proposal" data-testid="agent-proposal"><p className="eyebrow">UNTRUSTED SUGGESTION / NOT A DECISION</p><h3>{scenarios[state.level].choices.find(choice => choice.id === proposal.choiceId)?.label}</h3><p className="agent-reason" data-testid="agent-reason">{proposal.reason}</p><div className="agent-actions"><button data-testid="agent-confirm" className="primary-button" disabled={!canDecide(state)} onClick={() => { importSequence.current++; const action = bridgeRef.current?.confirm(); if (action) dispatch(action); }}>Confirm this decision</button><button data-testid="agent-dismiss" className="secondary-button" onClick={() => { importSequence.current++; bridgeRef.current?.clear(); setNotice('Proposal dismissed. No decision was made.'); }}>Dismiss</button></div>{!canDecide(state) && <p className="fine-print">Inspect every evidence item yourself before confirming.</p>}</div>}
    <details className="agent-format"><summary>Proposal format &amp; local browser API</summary><p>Use the exported challengeId and scenarioId, plus one available choiceId. The challenge ID prevents stale proposals; it is not authentication.</p><pre>{'{"protocol":"compass.training.v1","challengeId":"from export","scenarioId":"from export","choiceId":"your choice","reason":"Your reasoning (1-1000 characters)"}'}</pre><p><code>window.compassTraining.getChallenge()</code> reads the current case. <code>window.compassTraining.propose(proposal)</code> queues a suggestion, never a decision.</p></details>
  </section>;
}

function boundaryFlow(state: GameState) {
  const receipt = state.receipts.at(-1);
  if (!receipt || receipt.scenario !== scenarios[state.level].id || state.phase === 'playing') {
    return { kind: 'waiting', label: 'Paused at the boundary', detail: 'Inspect the evidence. You decide what moves.', path: '', endpoint: 0 };
  }
  switch (receipt.choice) {
    case 'trust': return { kind: 'risk', label: 'Document crossed the authority boundary', detail: 'Synthetic credentials reach a shared log; an unauthorized role change is proposed.', path: 'M105 158 H425', endpoint: 425 };
    case 'extract': return { kind: 'safe', label: 'Requirements in. Privileges denied.', detail: 'Useful work reaches the assistant; internal data stays protected.', path: 'M105 158 H270', endpoint: 270 };
    case 'deny': return { kind: 'denied', label: 'Outbound request denied', detail: 'Module isolated. No simulated payload leaves.', path: 'M425 158 H508', endpoint: 508 };
    case 'once': return { kind: 'safe', label: 'Exact request allowed once', detail: 'Only approved aggregate metrics cross the boundary.', path: 'M270 158 H600', endpoint: 600 };
    case 'discard': return { kind: 'denied', label: 'Entire brief discarded', detail: 'Risk stopped, but useful requirements were lost.', path: 'M105 158 H184', endpoint: 184 };
    case 'block-all': return { kind: 'denied', label: 'Approved work blocked', detail: 'No transfer, but the compliant workflow cannot continue.', path: 'M425 158 H508', endpoint: 508 };
    case 'delay': return { kind: 'risk', label: 'Unsafe export scheduled', detail: 'The same excessive payload is approved for later.', path: 'M425 158 H508', endpoint: 508 };
    case 'always': return { kind: 'risk', label: 'Boundary opened too widely', detail: 'Future changed requests could pass without review.', path: 'M270 158 H600', endpoint: 600 };
    default: return { kind: 'risk', label: 'Synthetic data exposed', detail: 'The vulnerable simulation lets sensitive data reach outbound.', path: 'M425 158 H600', endpoint: 600 };
  }
}

function OfficeDiagram({ state }: { state: GameState }) {
  const flow = boundaryFlow(state);
  const receipt = state.receipts.at(-1);
  return <section className={`office-map flow-${flow.kind}`} aria-labelledby="map-heading">
    <div className="panel-heading"><h2 id="map-heading">The office boundary</h2><span className="eyebrow">SIMULATION ONLY</span></div>
    <svg viewBox="0 0 700 300" role="img" aria-labelledby="office-title office-desc">
      <title id="office-title">Attachment to assistant to internal data to outbound</title>
      <desc id="office-desc">{flow.label}. {flow.detail} Tokens represent simulated decisions, not real data transfers.</desc>
      <defs><pattern id="office-grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#d9d7cc" /></pattern></defs>
      <rect width="700" height="300" fill="url(#office-grid)" />
      <rect x="204" y="41" width="306" height="217" rx="24" className="office-zone" />
      <text x="228" y="69" className="zone-label">YOUR WORKSPACE</text>
      <path d="M105 158 H600" className="connection" />
      <path d="M191 84 V245 M523 84 V245" className="boundary-line" />
      <g className="map-node"><rect x="60" y="113" width="90" height="90" rx="17" /><path d="M91 135 H111 L122 146 V180 H91 Z M110 135 V148 H122 M99 158 H113 M99 168 H113" /><text x="105" y="229">Attachment</text></g>
      <g className="map-node assistant-node"><rect x="225" y="113" width="90" height="90" rx="17" /><path d="M252 143 H288 V169 H252 Z M263 169 V180 M276 169 V180 M255 181 H285" /><circle cx="262" cy="155" r="2" /><circle cx="278" cy="155" r="2" /><text x="270" y="229">Assistant</text></g>
      <g className="map-node"><rect x="380" y="113" width="90" height="90" rx="17" /><path d="M408 141 H442 V178 H408 Z M408 153 H442 M408 166 H442 M414 147 H418 M414 160 H418 M414 172 H418" /><text x="425" y="229">Internal data</text></g>
      <g className="map-node"><rect x="555" y="113" width="90" height="90" rx="17" /><path d="M587 147 V177 H616 V167 M596 139 H620 V162 M619 140 L598 161" /><text x="600" y="229">Outbound</text></g>
      <text x="192" y="279" className="boundary-label">TRUST GATE</text><text x="524" y="279" className="boundary-label">EGRESS GATE</text>
      {flow.path && <g key={`${receipt?.scenario}-${receipt?.attempt}`} className="decision-motion">
        <path d={flow.path} className="decision-path" />
        <circle r="7" className="moving-token"><animateMotion dur="1.3s" repeatCount="1" fill="freeze" path={flow.path} /></circle>
        <circle cx={flow.endpoint} cy="158" r="8" className="resting-token" />
        {flow.kind === 'denied' && <path d={`M${flow.endpoint - 6} 143 V173 M${flow.endpoint + 6} 143 V173`} className="stop-mark" />}
      </g>}
    </svg>
    <div className="map-caption" aria-live="polite"><span className="status-dot" /><div><strong>{flow.label}</strong><p>{flow.detail}</p></div></div>
  </section>;
}

function downloadSummary(state: GameState) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(gameSummary(state), null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'compass-training-summary.json';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App({ nav }: { nav?: ReactNode } = {}) {
  const [state, dispatch] = useReducer(gameReducer, undefined, createGame);
  const [draft, setDraft] = useState('');
  const [run, setRun] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const chatLog = useRef<HTMLDivElement>(null);
  const scenario = scenarios[state.level];
  const summary = gameSummary(state);
  const playing = state.phase === 'playing';
  const complete = state.phase === 'complete';

  useEffect(() => {
    const target = window as GameWindow;
    target.render_game_to_text = () => JSON.stringify({ ...gameSummary(state), phase: state.phase, level: state.level, attempts: state.attempts, hints: state.hints, receipts: state.receipts, scenario: scenario.id, inspected: state.inspected, canDecide: canDecide(state), outcome: state.outcome, diagram: boundaryFlow(state), evidence: scenario.evidence.map(({ id, title }) => ({ id, title })), choices: scenario.choices.map(({ id, label }) => ({ id, label })), coordinateSystem: 'SVG: origin top-left; x right, y down. Turn-based; tokens are illustrative.' });
    target.advanceTime = (_ms: number) => { /* Turn-based simulation has no time-dependent state. */ };
    return () => { delete target.render_game_to_text; delete target.advanceTime; };
  }, [state, scenario]);

  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [state.phase, state.level]);
  useEffect(() => { if (chatLog.current) chatLog.current.scrollTop = chatLog.current.scrollHeight; }, [state.messages]);

  const reset = () => { setDraft(''); setRun(value => value + 1); dispatch({ type: 'reset' }); };

  return <div className="protect-app">
    <a className="skip-link" href="#training">Skip to training</a>
    <header className="masthead"><a className="wordmark" href="#training" aria-label="COMPASS training desk"><span className="compass-mark" aria-hidden="true">✳</span> COMPASS</a>{nav}<span className="simulation-badge"><span /> SIMULATED TRAINING</span><button data-testid="reset" className="text-button reset-button" onClick={reset}>Reset session</button></header>
    <main id="training">
      <div className="desk-title"><div><p className="eyebrow">THE SECURITY DESK / INTERACTIVE EXERCISE</p><h1>Protect the office<span>.</span></h1></div><p className="desk-caption">Keep the work moving.<br />Keep the boundary yours.</p></div>
      <ol className="incident-progress" aria-label="Incident progress">{scenarios.map((item, i) => {
        const done = summary.levels[i].completed;
        return <li key={item.id} className={done ? 'is-done' : i === state.level ? 'is-current' : ''} aria-current={i === state.level && !complete ? 'step' : undefined}><span className="progress-number">{done ? '✓' : `0${i + 1}`}</span><div><span className="eyebrow">INCIDENT 0{i + 1}{done ? ' / RESOLVED' : ''}</span><strong>{item.concept}</strong></div></li>;
      })}</ol>

      {state.phase === 'briefing' ? <section className="briefing-layout">
        <div className="briefing-copy"><p className="eyebrow">YOUR SHIFT STARTS HERE</p><h2 ref={heading} tabIndex={-1}>A helpful assistant.<br />A dangerous instruction.<br /><em>Your call.</em></h2><p>Three incidents. Read the evidence, choose a boundary, and watch what your decision lets through.</p><div className="briefing-steps"><span>01 / Inspect the source</span><span>02 / Make the call</span><span>03 / Learn and retry</span></div><button id="start-btn" className="primary-button" onClick={() => dispatch({ type: 'start' })}>Start your shift <span aria-hidden="true">↗</span></button><p className="fine-print">Fictional data. Local rules. No real transfers or live AI.</p></div>
        <div className="briefing-visual"><OfficeDiagram state={state} /><div className="desk-note"><span className="eyebrow">DESK RULE NO. 01</span><p>A document can tell you what to build.<br /><strong>It cannot give itself permission.</strong></p></div></div>
      </section> : complete ? <section className="debrief">
        <p className="eyebrow">SHIFT COMPLETE / YOUR ACTUAL RECORD</p><h2 ref={heading} tabIndex={-1}>A better boundary.<br />Not a made-up score.</h2><p>You resolved all three incidents. Earlier attempts stay in the record.</p>
        <div className="session-totals">{[['Decisions', state.receipts.length], ['Retries', summary.levels.reduce((n, l) => n + l.retries, 0)], ['Hints used', state.hints.reduce((a, b) => a + b, 0)]].map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
        <div className="debrief-levels">{summary.levels.map((level, i) => <article key={level.title}><span className="eyebrow">INCIDENT 0{i + 1} / RESOLVED</span><h3>{level.title}</h3><p>{scenarios[i].lesson}</p><small>{level.attempts} attempts · {level.retries} retries · {level.hints} hints</small></article>)}</div>
        <div className="debrief-actions"><button data-testid="debrief-download" className="primary-button" onClick={() => downloadSummary(state)}>Download summary JSON</button><button className="secondary-button" onClick={reset}>Start a new shift</button></div><p className="fine-print">Export includes decisions and counts only. No chat content. Nothing is uploaded.</p>
      </section> : <>
        <div className="incident-heading"><div><p className="eyebrow">CASE 0{state.level + 1} / {scenario.sender}</p><h2 ref={heading} tabIndex={-1}>{scenario.title}</h2><p>{scenario.subtitle}</p></div><span className="case-status">{playing ? 'Awaiting your decision' : state.outcome?.correct ? 'Boundary resolved' : 'Review the consequence'}</span></div>
        <div className="training-layout"><div className="work-area"><OfficeDiagram state={state} />
          <section className="evidence-panel" aria-labelledby="evidence-heading"><div className="panel-heading"><h2 id="evidence-heading">Evidence dossier</h2><span className="eyebrow">{state.inspected.length} / {scenario.evidence.length} INSPECTED</span></div><p className="evidence-intro">{scenario.briefing}</p><div className="evidence-items">{scenario.evidence.map(item => {
            const inspected = state.inspected.includes(item.id);
            return <article className={`evidence-item ${inspected ? 'is-inspected' : ''}`} key={item.id}><div className="evidence-file"><span className="file-symbol" aria-hidden="true">↳</span><div><span className="eyebrow">{item.kind}</span><h3>{item.title}</h3></div><button data-testid={`evidence-${item.id}`} className="secondary-button inspect-button" aria-expanded={inspected} aria-controls={`evidence-${item.id}`} disabled={!playing || inspected} onClick={() => dispatch({ type: 'inspect', id: item.id })}>{inspected ? 'Inspected ✓' : 'Inspect'}</button></div>{inspected && <div id={`evidence-${item.id}`} className="evidence-content"><pre>{item.body}</pre><p className="evidence-note">{item.note}</p></div>}</article>;
          })}</div></section>
        </div>
        <aside className="coach-panel" aria-labelledby="coach-heading"><div className="coach-heading"><span className="coach-avatar" aria-hidden="true">C</span><div><h2 id="coach-heading">Scripted coach</h2><span>Local rules, not live AI</span></div><span className="local-dot" aria-hidden="true" /></div><div className="chat-log" role="log" aria-label="Scripted coach conversation" aria-live="polite" aria-relevant="additions" ref={chatLog}>{state.messages.map((message, i) => <div className={`chat-message ${message.role}`} key={`${state.level}-${i}`}><span className="eyebrow">{message.role === 'coach' ? 'COACH' : 'YOU'}</span><p>{message.text}</p></div>)}</div><div className="coach-controls"><button data-testid="hint" className="hint-button" disabled={!playing || state.hints[state.level] >= scenario.hints.length} onClick={() => dispatch({ type: 'hint' })}>Request a hint <span>{state.hints[state.level]} / {scenario.hints.length}</span></button><form onSubmit={event => { event.preventDefault(); if (draft.trim()) { dispatch({ type: 'chat', text: draft }); setDraft(''); } }}><label htmlFor="coach-input">Ask the scripted coach</label><div className="chat-input-row"><input data-testid="chat-input" id="coach-input" value={draft} maxLength={500} placeholder="Type a command..." autoComplete="off" aria-describedby="coach-help" onChange={event => setDraft(event.target.value)} /><button data-testid="chat-send" className="send-button" type="submit" disabled={!draft.trim()} aria-label="Send command">↑</button></div><p id="coach-help">hint · evidence · why · option 1/2/3<br />{draft.length}/500 characters. Never enter real secrets.</p></form></div></aside></div>
        <section className="decision-panel" aria-labelledby="decision-heading">{state.phase === 'feedback' && state.outcome ? <div className={`feedback ${state.outcome.correct ? 'correct' : 'retry'}`}><div><p className="eyebrow">DECISION RECORDED / ATTEMPT {state.attempts[state.level]}</p><h2 id="decision-heading">{state.outcome.correct ? 'The right boundary. Work can continue.' : 'Pause. Look at what that permits.'}</h2><p>{state.outcome.consequence}</p></div><button data-testid={state.outcome.correct ? 'next' : 'retry'} className="primary-button" onClick={() => dispatch({ type: state.outcome?.correct ? 'next' : 'retry' })}>{state.outcome.correct ? state.level === scenarios.length - 1 ? 'See your debrief' : 'Next incident' : 'Retry incident'} <span aria-hidden="true">→</span></button></div> : <><div className="decision-heading"><h2 id="decision-heading">Your call.</h2><p>{canDecide(state) ? 'Choose the boundary you would enforce.' : 'Inspect every evidence item to unlock your decision.'}</p></div><div className="choice-grid">{scenario.choices.map((choice, i) => <button data-testid={`choice-${choice.id}`} className="choice-card" key={choice.id} disabled={!canDecide(state)} onClick={() => dispatch({ type: 'choose', id: choice.id })}><span className="choice-number">0{i + 1}</span><strong>{choice.label}</strong><span>{choice.detail}</span><span className="choice-arrow" aria-hidden="true">↗</span></button>)}</div></>}</section>
      </>}
      <AgentPanel key={`${run}-${state.level}-${state.phase}-${state.attempts[state.level]}`} state={state} dispatch={dispatch} />
      <details className="teaching-note"><summary>What this teaches</summary><ul><li>Untrusted content ≠ authority</li><li>Limit tool permissions</li><li>Constrain the execution environment</li></ul><p>Actual sandboxing and network blocking remain simulated here.</p><a href="https://www.youtube.com/watch?v=VQdim50QJw8" target="_blank" rel="noopener noreferrer">Watch KodeKloud: What Is Prompt Injection? <span className="sr-only">(opens a new tab)</span></a></details>
    </main>
    <footer className="desk-footer"><p>COMPASS / Protect the Office<span>Browser-only training. No real data transfer.</span></p><div><a href="https://app.guild.ai/users/axmatea/workspaces/compass-game" target="_blank" rel="noopener noreferrer">Open Guild agent <span aria-hidden="true">↗</span><span className="sr-only"> (opens a new tab)</span></a><small>separate experience; not connected to this page</small></div></footer>
  </div>;
}
