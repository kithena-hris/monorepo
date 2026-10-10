import * as z from 'zod';

import { asFreeText, asInternal, asPublic, policy } from '../classification.js';
import { CalendarDate, Instant } from '../primitives.js';

/**
 * One item in a person's Inbox (Inbox design A1, A2), in the shape every
 * module answers with, so the shell can merge People's, Time Off's and any
 * later module's without knowing them.
 *
 * The module that answers owns the item: its state is the module's own row
 * (a request waiting, a document unsigned), never a copy. The shell adds only
 * what is the person's alone — read, snoozed, moved to Done — from their
 * account preferences, keyed by `id`.
 *
 * The sender always says which lane: Kithena never guesses whether something
 * needs action (A2).
 */

/** A: what it asks of the person. */
export const InboxLane = z
  .enum([
    /** Something would go wrong if they never opened it. Counted. */
    'task',
    /** Something happened; nothing is owed. A dot, never a number. */
    'update',
    /** Something they started, waiting on someone. */
    'request',
    /** Finished, decided, or an update older than 30 days. */
    'done',
  ])
  .register(policy, asPublic());
export type InboxLane = z.infer<typeof InboxLane>;

export const InboxTone = z
  .enum(['neutral', 'accent', 'info', 'success', 'warning', 'danger'])
  .register(policy, asPublic());
export type InboxTone = z.infer<typeof InboxTone>;

const Label = z.object({
  label: z.string().max(120).register(policy, asInternal()),
  tone: InboxTone,
});

/** `<module>:<kind>:<id>`: stable across reads, so state kept against it survives. */
export const InboxItemId = z
  .string()
  .regex(/^[a-z][a-z0-9-]*:[a-z][a-z0-9-.]*:[A-Za-z0-9_.:-]{1,160}$/u, 'module:kind:id')
  .register(policy, asPublic());
export type InboxItemId = z.infer<typeof InboxItemId>;

/**
 * Someone involved: who sent it, who has it now, who took a team task. A
 * person when there is one; `null` name means Kithena itself.
 */
export const InboxPerson = z.object({
  name: z.string().max(200).nullable().register(policy, asInternal('identity')),
  personId: z.string().max(64).nullable().register(policy, asInternal('identity')),
});
export type InboxPerson = z.infer<typeof InboxPerson>;

export const InboxItem = z.object({
  id: InboxItemId,
  lane: InboxLane,
  /**
   * What sort of thing, as the module names it (`timeoff.approval`,
   * `people.details`): the detail pane drawn, the actions offered, and what
   * "Mute updates like this" mutes.
   */
  kind: z
    .string()
    .regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-.]*$/u)
    .register(policy, asPublic()),
  /** Which module answered: `people`, `timeoff`. The source filter. */
  module: z.string().regex(/^[a-z][a-z0-9-]*$/u).register(policy, asPublic()),
  /** Where in the module it lives: "Identity", "Documents". */
  area: z.string().max(60).nullable().register(policy, asPublic()),
  /**
   * The row's tile, as a meaning from the design system's icon set (`edit`,
   * `document`, `leave`): a word, so a module never picks a glyph.
   */
  icon: z.string().max(40).register(policy, asPublic()),
  tone: InboxTone.nullable(),
  title: z.string().max(240).register(policy, asInternal('identity')),
  summary: z.string().max(400).nullable().register(policy, asFreeText()),
  from: InboxPerson.nullable(),
  /** When it arrived, or was last decided for an outcome. */
  at: Instant,
  /** A task's due date, in the person's calendar. */
  due: CalendarDate.nullable(),
  /** "Due" or, for an approval, "Decide by". */
  dueVerb: z.enum(['due', 'decide']).register(policy, asPublic()),
  /** Where it stands: "With Ada", "Cancelled", "Priya is on it". */
  status: Label.nullable(),
  /** In Done: "Approved", "Declined", "Signed", "Sent back". */
  outcome: Label.nullable(),
  /** A bundled queue's count (G2): one row, counted once. */
  count: z.int().min(0).nullable().register(policy, asPublic()),
  /**
   * A task for a role rather than a person (H1, Z3): anyone holding it may
   * take it, and once taken it stops counting for the others.
   */
  team: z
    .object({
      role: z.string().max(60).register(policy, asPublic()),
      takenBy: InboxPerson.nullable(),
      takenAt: Instant.nullable(),
      mine: z.boolean().register(policy, asPublic()),
    })
    .nullable(),
  /** Replies on the task's thread (C7): shown on the row. */
  replies: z.int().min(0).register(policy, asPublic()),
  /** "Open in …": a path in the app, and the module's name for the button. */
  link: z
    .string()
    .max(400)
    .regex(/^\/(?!\/)/u, 'a path in this app')
    .register(policy, asPublic()),
  openIn: z.string().max(40).register(policy, asPublic()),
  /** The sender's own words, as they asked it (C1's quote). */
  message: z.string().max(4000).nullable().register(policy, asFreeText()),
  /**
   * What the detail pane needs, by kind (`InboxDetail`): the fields to fill,
   * the dates and team strip, the steps. JSON on the wire; the shell parses
   * it with the kind's schema.
   */
  detail: z.unknown().register(policy, asFreeText()),
});
export type InboxItem = z.infer<typeof InboxItem>;

/** What a module answers for the person asking: their items, newest first. */
export const InboxAnswer = z.object({
  items: z.array(InboxItem),
});
export type InboxAnswer = z.infer<typeof InboxAnswer>;
