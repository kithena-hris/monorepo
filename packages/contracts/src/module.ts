import * as z from 'zod';

export const ModuleKey = z.enum([
  'people',
  'timeoff',
  'performance',
  'documents',
  'onboarding',
  'compensation',
  'recruiting',
  'reporting',
]);
export type ModuleKey = z.infer<typeof ModuleKey>;

/**
 * `requiresPeopleSource: 'either'` is the anti-sticky flag. A module marked
 * this way must boot and pass its acceptance suite with the People module
 * absent and employee records arriving from a customer's existing HRIS
 * through the anti-corruption layer.
 *
 * `just standalone <module>` asserts exactly that.
 */
export const ModuleManifest = z.object({
  key: ModuleKey,
  version: z.string(),
  /** Aim for an empty array. Every entry here is a module you cannot sell alone. */
  dependsOn: z.array(ModuleKey).default([]),
  /** Optional. Present means richer behaviour, absent means graceful degradation. */
  enrichedBy: z.array(ModuleKey).default([]),
  publishes: z.array(z.string()),
  consumes: z.array(z.string()),
  entitlement: z.string(),
  requiresPeopleSource: z.enum(['own', 'external', 'either']),
});
export type ModuleManifest = z.infer<typeof ModuleManifest>;
