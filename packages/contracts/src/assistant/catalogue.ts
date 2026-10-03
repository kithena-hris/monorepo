import * as z from 'zod';

import { asPublic, policy } from '../classification.js';
import { ModuleKey } from '../module.js';
import { CapabilityName, FieldKey } from './capability.js';
import { CatalogueLeaveType } from './timeoff.js';

/**
 * What one module offers this asker: `GET /internal/capabilities`, called as
 * the asker (assistant PRD §8.5).
 *
 * Configuration only — field names, option labels, metric names — and never a
 * value from anybody's record. It is what the model is shown, after the
 * assistant drops what yields and masks what is private.
 */

const label = z.string().min(1).max(120).register(policy, asPublic());

/** A field the asker may filter by, and its options where they are configuration. */
export const CatalogueField = z.strictObject({
  key: FieldKey,
  label,
  /** Which operators fit. */
  kind: z
    .enum(['text', 'select', 'date', 'number', 'person', 'status'])
    .register(policy, asPublic()),
  options: z
    .array(
      z.strictObject({ value: z.string().min(1).max(120).register(policy, asPublic()), label }),
    )
    .max(500),
});
export type CatalogueField = z.infer<typeof CatalogueField>;

export const RuntimeCatalogue = z.strictObject({
  module: z.enum(ModuleKey.options).register(policy, asPublic()),
  /** The capabilities, and the major version of each, this module serves this asker. */
  serves: z.array(
    z.strictObject({ name: CapabilityName, version: z.int().min(1).register(policy, asPublic()) }),
  ),
  /** Per capability, the fields its filters may name. */
  fields: z
    .record(CapabilityName, z.array(CatalogueField).max(200))
    .default({})
    .register(policy, asPublic()),
  /** What the asker may order by: People's metrics. */
  metrics: z.array(z.strictObject({ key: FieldKey, label })).default([]),
  /** Time Off's leave types, private ones marked. */
  leaveTypes: z.array(CatalogueLeaveType).default([]),
  /**
   * Time Off's: the company lets a chat answer name people on a private leave
   * type (§11.4), switched by HR and off by default. It lifts the chat rules
   * only; a row still says "Away" wherever Time Off did not show the type.
   */
  chatNamesPrivateLeave: z.boolean().default(false).register(policy, asPublic()),
  /** This tenant's not-for-AI keys and the words for them, for the AI gateway. */
  denied: z
    .array(z.strictObject({ key: FieldKey, labels: z.array(label).register(policy, asPublic()) }))
    .default([]),
});
export type RuntimeCatalogue = z.infer<typeof RuntimeCatalogue>;
