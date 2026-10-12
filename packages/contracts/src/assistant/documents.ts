import { capability } from './capability.js';

/**
 * Documents' capabilities (assistant PRD §8.6; documents PRD §5.3).
 *
 * What waits for the asker and what expires: titles, people and dates, read
 * as the asker in Documents' own access rules. Never a document's content:
 * that is read only inside Documents, for somebody who may open it (PRD §14).
 */

/** What Documents waits on the asker for, as the top of their Documents screen shows it. */
export const DocumentsWaiting = capability({
  name: 'documents.waiting',
  version: 1,
  module: 'documents',
  about: 'Documents waiting for the asker: to sign, to acknowledge, to add, or a request to open one.',
  accepts: {},
  output: 'items',
});

/** What expires in the next 60 days: the asker's own, or every one for HR. */
export const DocumentsExpiring = capability({
  name: 'documents.expiring',
  version: 1,
  module: 'documents',
  about: 'Documents expiring in the next 60 days: the asker’s own, or everyone’s for HR.',
  accepts: {},
  output: 'items',
});

export const documentsCapabilities = [DocumentsWaiting, DocumentsExpiring] as const;
