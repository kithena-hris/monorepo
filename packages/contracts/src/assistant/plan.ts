import * as z from 'zod';

import { asFreeText, asPublic, policy } from '../classification.js';
import { ModuleKey } from '../module.js';
import { ASSISTANT_LIMITS, CapabilityName, FieldKey } from './capability.js';

/**
 * What the model answers with (assistant PRD §9.1, §9.3).
 *
 * Shape only, and strict at every level: a key this file does not expect
 * refuses the whole plan. Whether a step's capability was offered, its input
 * fits that capability, a filter names a real field, or `by` is a declared
 * group is meaning, checked in the assistant's domain against the runtime
 * catalogue.
 */

export const StepId = z.enum(['s1', 's2', 's3', 's4']).register(policy, asPublic());
export type StepId = z.infer<typeof StepId>;

export const PlanStep = z.strictObject({
  id: StepId,
  capability: CapabilityName,
  /**
   * Read against the capability's `schemas.step`. Names and words from the
   * question, so free text.
   */
  input: z.record(z.string(), z.unknown()).register(policy, asFreeText()),
  /** Narrow to the people an earlier step found. */
  within: StepId.optional(),
});
export type PlanStep = z.infer<typeof PlanStep>;

export const PlanAnswer = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('count').register(policy, asPublic()),
    step: StepId,
    /** A group the step's capability declares. */
    by: FieldKey.optional(),
  }),
  z.strictObject({ kind: z.literal('list').register(policy, asPublic()), step: StepId }),
  /** A profile, items, or who a name could be. */
  z.strictObject({ kind: z.literal('one').register(policy, asPublic()), step: StepId }),
]);
export type PlanAnswer = z.infer<typeof PlanAnswer>;

export const AssistantPlan = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('plan').register(policy, asPublic()),
    steps: z.array(PlanStep).min(1).max(ASSISTANT_LIMITS.steps),
    answer: PlanAnswer,
    /** The model's opening, written blind; `{n}` is the one thing filled in. */
    say: z.string().max(240).optional().register(policy, asFreeText()),
  }),
  z.strictObject({
    kind: z.literal('unclear').register(policy, asPublic()),
    reply: z.string().max(500).register(policy, asFreeText()),
  }),
  z.strictObject({
    kind: z.literal('unavailable').register(policy, asPublic()),
    module: z.enum(ModuleKey.options).register(policy, asPublic()),
  }),
]);
export type AssistantPlan = z.infer<typeof AssistantPlan>;
