import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Root from './Root';

const root = document.getElementById('root');
if (!root) throw new Error('COMPASS training root was not found.');
createRoot(root).render(<StrictMode><Root /></StrictMode>);
