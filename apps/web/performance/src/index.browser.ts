/**
 * What federation exposes to the browser: the same names as `index.ts`, each
 * area of screens in a chunk of its own (`./split.tsx`).
 */
import './styles.css';

import { split } from './split';

export const Home = split(() => import('./home'), 'Home');
export const MyReviews = split(() => import('./reviews'), 'MyReviews');
export const Write = split(() => import('./reviews'), 'Write');
export const Released = split(() => import('./reviews'), 'Released');
export const About = split(() => import('./reviews'), 'About');
export const Unlocks = split(() => import('./reviews'), 'Unlocks');
export const Nominate = split(() => import('./reviews'), 'Nominate');
export const Cycles = split(() => import('./cycles'), 'Cycles');
export const Setup = split(() => import('./cycles'), 'Setup');
export const Overview = split(() => import('./cycles'), 'Overview');
export const Templates = split(() => import('./templates'), 'Templates');
export const Builder = split(() => import('./templates'), 'Builder');
export const Preview = split(() => import('./templates'), 'Preview');
export const History = split(() => import('./templates'), 'History');
export const Feedback = split(() => import('./feedback'), 'Feedback');
export const Notes = split(() => import('./feedback'), 'Notes');
export const Goals = split(() => import('./goals'), 'Goals');
export const Goal = split(() => import('./goals'), 'Goal');
export const Learning = split(() => import('./learning'), 'Learning');
export const Item = split(() => import('./learning'), 'Item');
export const Session = split(() => import('./learning'), 'Session');
export const Automations = split(() => import('./automations'), 'Automations');
export const Automation = split(() => import('./automations'), 'Automation');
export const Calibrations = split(() => import('./calibration'), 'Calibrations');
export const Calibration = split(() => import('./calibration'), 'Calibration');
export const Analytics = split(() => import('./analytics'), 'Analytics');
export const Settings = split(() => import('./settings'), 'Settings');
export const AiLog = split(() => import('./settings'), 'AiLog');
export const Retention = split(() => import('./settings'), 'Retention');
export const ConnectedTools = split(() => import('./settings'), 'ConnectedTools');
