import * as z from 'zod';

import { asPublic, policy } from '../classification.js';
import type { LeaveTypeDefinition } from '../timeoff/policy.js';
import { LeaveCategory, LeaveTypeKey } from '../timeoff/primitives.js';
import { capability } from './capability.js';

/**
 * Time Off's capabilities (assistant PRD §7.1, §7.2, §7.5, §8.2, §8.4).
 *
 * Where People is present it owns the organisation, so the `team` filter and
 * `timeoff.managers` give way to People's; where it is absent, Time Off's
 * member projection answers them itself.
 */

export const TimeOffAway = capability({
  name: 'timeoff.away',
  version: 1,
  module: 'timeoff',
  about: 'People away on leave on a date or over a range.',
  accepts: { filters: ['leave_type', 'team'], on: 'required', name: true, within: true },
  groups: ['team', 'location'],
  output: 'people',
  yields: { team: 'people.find' },
});

export const TimeOffManagers = capability({
  name: 'timeoff.managers',
  version: 1,
  module: 'timeoff',
  about: 'The managers of the people an earlier step found, each once.',
  accepts: { within: 'required' },
  output: 'people',
  yields: { 'timeoff.managers': 'people.managers' },
});

/**
 * Whose balances the asker may see, as Time Off's own screens show them: their
 * own, the people they approve or cover, and everyone for HR. Days are the
 * ledger's fold, sent as decimal text and never a float; `days_left` compares
 * with them ("more than 10 left": `after`, `10`).
 */
export const TimeOffBalances = capability({
  name: 'timeoff.balances',
  version: 1,
  module: 'timeoff',
  about:
    'How much leave people have left this leave year: the asker’s own, the people they approve, or everyone for HR.',
  accepts: { filters: ['leave_type', 'days_left', 'team'], name: true, within: true },
  groups: ['team', 'location'],
  output: 'people',
  yields: { team: 'people.find' },
});

export const timeoffCapabilities = [TimeOffAway, TimeOffManagers, TimeOffBalances] as const;

/**
 * A leave type in Time Off's runtime catalogue.
 *
 * `private` is what the assistant masks before a model sees the question
 * (§12.2): the type is never named to the model, and never written beside a
 * person in a chat app.
 */
export const CatalogueLeaveType = z.strictObject({
  key: LeaveTypeKey,
  name: z.string().min(1).max(120).register(policy, asPublic()),
  private: z.boolean().register(policy, asPublic()),
  /**
   * Which everyday words name it: "off sick" names a `sick_leave` type, whatever
   * the company called it. Optional, so an older Time Off still parses; a
   * private type without it is masked by its name and key alone, and the
   * assistant refuses the everyday words rather than guess.
   */
  category: LeaveCategory.optional(),
});
export type CatalogueLeaveType = z.infer<typeof CatalogueLeaveType>;

/** Sick and parental leave, or any type teammates see only as "Off". */
export const isPrivateLeaveType = (
  type: Pick<LeaveTypeDefinition, 'category' | 'visibility'>,
): boolean =>
  type.category === 'sick_leave' ||
  type.category === 'parental_leave' ||
  type.visibility === 'off_only';
