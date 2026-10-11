/**
 * What federation exposes to the browser: the same names as `index.ts`, each
 * screen in a chunk of its own (`./split.tsx`).
 */
import './styles.css';

import { split } from './split';

export const Library = split(() => import('./library/library'), 'Library');
export const DocumentView = split(() => import('./document/document'), 'DocumentView');
export const PersonFile = split(() => import('./people/person-file'), 'PersonFile');
export const DocumentTypes = split(() => import('./settings/settings'), 'DocumentTypes');
export const AccessSettings = split(() => import('./settings/settings'), 'AccessSettings');
export const RetentionSettings = split(() => import('./settings/settings'), 'RetentionSettings');
