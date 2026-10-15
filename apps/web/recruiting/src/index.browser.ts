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
export const Interviews = split(() => import('./interviews'), 'Interviews');
export const Kit = split(() => import('./interviews'), 'Kit');
export const Schedule = split(() => import('./interviews'), 'Schedule');
export const Debrief = split(() => import('./interviews'), 'Debrief');
export const Offers = split(() => import('./offers'), 'Offers');
export const Offer = split(() => import('./offers'), 'Offer');
export const OfferApproval = split(() => import('./offers'), 'OfferApproval');
export const Contract = split(() => import('./offers'), 'Contract');
export const Analytics = split(() => import('./analytics'), 'Analytics');
export const AnalyticsTile = split(() => import('./analytics'), 'AnalyticsTile');
export const Board = split(() => import('./board'), 'Board');
export const Agencies = split(() => import('./board'), 'Agencies');
export const Settings = split(() => import('./settings'), 'Settings');
