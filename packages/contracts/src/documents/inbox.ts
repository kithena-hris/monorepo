import * as z from 'zod';

import { asInternal, asPublic, policy } from '../classification.js';
import { DocumentId, DocumentTypeKey } from './primitives.js';

/**
 * What a Documents task in the Inbox carries so it is done there (DOC-025):
 * the file HR asked for, uploaded into the request; the policy to read and
 * acknowledge; the open asked for, granted or refused. A signature still opens
 * the envelope, whose ceremony is Documents' own.
 */
export const DocumentsInboxDetail = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('request'),
    requestId: z.uuid().register(policy, asPublic()),
    personId: z.uuid().register(policy, asPublic()),
    typeKey: DocumentTypeKey,
    typeName: z.string().max(120).register(policy, asInternal()),
  }),
  z.object({
    kind: z.literal('acknowledge'),
    campaignId: z.uuid().register(policy, asPublic()),
    documentId: DocumentId,
  }),
  z.object({
    kind: z.literal('access'),
    requestId: z.uuid().register(policy, asPublic()),
    documentId: DocumentId,
  }),
]);
export type DocumentsInboxDetail = z.infer<typeof DocumentsInboxDetail>;
