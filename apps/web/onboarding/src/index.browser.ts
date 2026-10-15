/**
 * What federation exposes to the browser: the same names as `index.ts`, each
 * screen in a chunk of its own (`./split.tsx`).
 */
import './styles.css';

import { split } from './split';

export const Home = split(() => import('./home'), 'Home');
export const Tasks = split(() => import('./home'), 'Tasks');
export const Plan = split(() => import('./plan'), 'Plan');
export const Templates = split(() => import('./templates'), 'Templates');
export const Settings = split(() => import('./templates'), 'Settings');
export const Analytics = split(() => import('./templates'), 'Analytics');
