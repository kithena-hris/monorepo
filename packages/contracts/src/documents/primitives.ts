import * as z from 'zod';

import { asFreeText, asInternal, asPublic, policy } from '../classification.js';
import { keySchema } from '../people/primitives.js';

/**
 * The vocabulary Documents' contracts are written in (Documents PRD §6, §12).
 *
 * Here rather than in `events/documents.ts` for Time Off's reason: the
 * document type and the views need it too, and an event file importing them
 * importing the event file is a cycle.
 */

export const DocumentId = z.uuid().brand<'DocumentId'>().register(policy, asPublic());
export type DocumentId = z.infer<typeof DocumentId>;

/** Who can open it (PRD §6.1). Confidential is a flag on top, not a third level. */
export const AccessLevel = z.enum(['private', 'shared']).register(policy, asInternal());
export type AccessLevel = z.infer<typeof AccessLevel>;

/** Who turned Confidential on, which decides who may turn it off (PRD §6.2). */
export const ConfidentialBy = z.enum(['owner', 'hr', 'type']).register(policy, asInternal());
export type ConfidentialBy = z.infer<typeof ConfidentialBy>;

export const Permission = z.enum(['view', 'edit']).register(policy, asInternal());
export type Permission = z.infer<typeof Permission>;

/** A team, as Documents' member projection holds it. */
export const DocumentsTeamKey = keySchema('team').register(policy, asPublic());

/** Somebody a document is shared with (PRD §6.3). */
export const Grantee = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('member'), personId: z.uuid().register(policy, asPublic()) }),
    z.object({ kind: z.literal('team'), teamKey: DocumentsTeamKey }),
    z.object({ kind: z.literal('everyone') }),
  ])
  .register(policy, asInternal());
export type Grantee = z.infer<typeof Grantee>;

/** The icon and tone family a document is drawn with. */
export const DocumentKind = z
  .enum([
    'Contract',
    'Policy',
    'Payslip',
    'Letter',
    'ID',
    'Personal',
    'Medical',
    'Sheet',
    'Template',
    'Permit',
    'Form',
  ])
  .register(policy, asPublic());
export type DocumentKind = z.infer<typeof DocumentKind>;

/** A tenant's document type: `employment_contract`, `payslip`. Never renamed once used. */
export const DocumentTypeKey = keySchema('document type')
  .brand<'DocumentTypeKey'>()
  .register(policy, asPublic());
export type DocumentTypeKey = z.infer<typeof DocumentTypeKey>;

/** How long a document is kept (PRD §12.3). */
export const RetentionRule = z
  .discriminatedUnion('kind', [
    // "4 years after they leave"
    z.object({ kind: z.literal('after_leaving'), years: z.int().min(0).max(50) }),
    // "Until they leave, plus 1 year"
    z.object({ kind: z.literal('until_leaving'), plusYears: z.int().min(0).max(50) }),
    // "5 years" from filing
    z.object({ kind: z.literal('years'), years: z.int().min(1).max(50) }),
    // "90 days" from filing: exports from People
    z.object({ kind: z.literal('days'), days: z.int().min(1).max(3650) }),
    // "Every version, forever"
    z.object({ kind: z.literal('forever') }),
  ])
  .register(policy, asInternal());
export type RetentionRule = z.infer<typeof RetentionRule>;

/** Who signs a type's documents, in order (PRD §12.1). */
export const TypeSigner = z.enum(['subject', 'hr']).register(policy, asInternal());
export type TypeSigner = z.infer<typeof TypeSigner>;

/**
 * A document type, as one sentence (S3): where it is filed, who sees it,
 * whether it is Confidential, who signs, who needs it by when, when it
 * expires, how long it is kept, and what Kithena reads from it.
 */
export const DocumentTypeDefinition = z
  .object({
    key: DocumentTypeKey,
    name: z.string().trim().min(1).max(80).register(policy, asPublic()),
    kind: DocumentKind,
    /** Filed to each person, or a company document. */
    filedTo: z.enum(['person', 'company']).register(policy, asInternal()),
    /** Who opens it besides HR: the person it is about, everyone, or nobody else. */
    audience: z.enum(['subject', 'everyone', 'hr']).register(policy, asInternal()),
    confidential: z.boolean().register(policy, asInternal()),
    /** Medical: Kithena reads dates only, and only HR opens it. */
    medical: z.boolean().default(false).register(policy, asInternal()),
    signers: z.array(TypeSigner).max(2).default([]).register(policy, asInternal()),
    /** Each version must be acknowledged by its audience. */
    acknowledge: z.boolean().default(false).register(policy, asInternal()),
    requiredFor: z
      .enum(['new_starters', 'everyone'])
      .nullable()
      .default(null)
      .register(policy, asInternal()),
    /** Days before a start date it must be in; 0 is "before day one". */
    requiredBy: z.int().min(0).max(365).default(0).register(policy, asInternal()),
    /** Reminders this many days before it expires; empty when it never does. */
    expiryReminders: z
      .array(z.int().min(1).max(365))
      .max(4)
      .default([])
      .register(policy, asInternal()),
    retention: RetentionRule,
    /** Field names Kithena may read from it (PRD §14). */
    aiReads: z
      .array(z.string().max(60).register(policy, asPublic()))
      .max(20)
      .default([])
      .register(policy, asInternal()),
    aiEnabled: z.boolean().default(true).register(policy, asInternal()),
  })
  .meta({ title: 'DocumentTypeDefinition' });
export type DocumentTypeDefinition = z.infer<typeof DocumentTypeDefinition>;

/** A document's title: somebody's words, possibly a name; never to a model or a log. */
export const DocumentTitle = z.string().trim().min(1).max(200).register(policy, asFreeText());
