/**
 * What federation exposes to the browser: the same names as `index.ts`, each
 * screen in a chunk of its own (`./split.tsx`).
 */
import './styles.css';

import { split } from './split';

export const Home = split(() => import('./home'), 'Home');
export const Jobs = split(() => import('./home'), 'Jobs');
export const Pipeline = split(() => import('./pipeline'), 'Pipeline');
export const Candidate = split(() => import('./candidate'), 'Candidate');
export const Candidates = split(() => import('./candidate'), 'Candidates');
export const Pools = split(() => import('./candidate'), 'Pools');
export const Requisitions = split(() => import('./requisitions'), 'Requisitions');
export const Requisition = split(() => import('./requisitions'), 'RequisitionEditor');
export const RequisitionApproval = split(() => import('./requisitions'), 'RequisitionApproval');
export const JobSetup = split(() => import('./job'), 'JobSetup');
