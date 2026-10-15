/**
 * What federation exposes to the browser: the same names as `index.ts`, each
 * screen in a chunk of its own (`./split.tsx`).
 */
import './styles.css';

import { split } from './split';

export const Home = split(() => import('./home'), 'Home');
export const Jobs = split(() => import('./home'), 'Jobs');
export const Pipeline = split(() => import('./pipeline'), 'Pipeline');
