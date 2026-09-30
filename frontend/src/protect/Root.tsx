import { useState } from 'react';
import App from './App';
import Lab from './lab/Lab';

type Mode = 'lab' | 'drills';
const readMode = (): Mode => new URLSearchParams(window.location.search).get('mode') === 'drills' ? 'drills' : 'lab';

export default function Root() {
  const [mode, setMode] = useState<Mode>(readMode);
  const change = (next: Mode) => {
    const url = new URL(window.location.href);
    if (next === 'lab') url.searchParams.delete('mode'); else url.searchParams.set('mode', next);
    window.history.replaceState(null, '', url);
    setMode(next);
  };
  const nav = <nav className="mode-nav" aria-label="Training mode">
    <button aria-pressed={mode === 'lab'} data-testid="mode-lab" onClick={() => change('lab')}>Attack lab</button>
    <button aria-pressed={mode === 'drills'} data-testid="mode-drills" onClick={() => change('drills')}>Offline drills</button>
  </nav>;
  return mode === 'lab' ? <Lab nav={nav} /> : <App nav={nav} />;
}
