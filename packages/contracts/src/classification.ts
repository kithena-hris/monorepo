import * as z from 'zod';

/**
 * Data classification, attached to schemas rather than documented in a wiki.
 *
 * A build step walks every registered schema and emits:
 *   - Pino redaction paths
 *   - the AI gateway deny list
 *   - the DSAR export manifest
 *   - retention job targets
 *
 * A contract field with no policy fails CI. Unclassified data is how a value
 * ends up in a log, an export and a model prompt on the same afternoon.
 */
export type Classification = 'public' | 'internal' | 'confidential' | 'special-category'; // GDPR Article 9

export type PiiKind = 'identity' | 'financial' | 'contact' | 'health' | 'biometric' | 'none';

export interface RetentionPolicy {
  /** Months after the employment relationship ends. */
  readonly monthsAfterTermination: number;
  /** Some categories are held longer by statute regardless of tenant policy. */
  readonly statutoryFloor?: 'es-labour' | 'de-labour' | 'eu-payroll';
}

export interface FieldPolicy {
  readonly classification: Classification;
  readonly piiKind: PiiKind;
  /** Included in a subject access request package. */
  readonly exportable: boolean;
  /** May be sent to a model. Never true for special-category data. */
  readonly aiEligible: boolean;
  readonly retention?: RetentionPolicy;
}

export const policy = z.registry<FieldPolicy>();

/** Convenience presets so the common cases stay one call. */
export const asPublic = (retention?: RetentionPolicy): FieldPolicy => ({
  classification: 'public',
  piiKind: 'none',
  exportable: true,
  aiEligible: true,
  ...(retention ? { retention } : {}),
});

export const asIdentity = (): FieldPolicy => ({
  classification: 'confidential',
  piiKind: 'identity',
  exportable: true,
  aiEligible: false,
});

export const asContact = (): FieldPolicy => ({
  classification: 'internal',
  piiKind: 'contact',
  exportable: true,
  aiEligible: false,
});

/**
 * Business data about a person that is not itself an identifier: effective
 * dates, day counts, payroll flags. Personal data because it is linked to a
 * person, so it goes in the DSAR package, but nothing here identifies anyone
 * on its own.
 */
export const asInternal = (piiKind: PiiKind = 'none'): FieldPolicy => ({
  classification: 'internal',
  piiKind,
  exportable: true,
  aiEligible: true,
});

/**
 * Free text a human typed. It can contain anything — a diagnosis, a grievance,
 * another employee's name — so it is confidential and never reaches a model,
 * whatever it happens to hold today.
 */
export const asFreeText = (): FieldPolicy => ({
  classification: 'confidential',
  piiKind: 'identity',
  exportable: true,
  aiEligible: false,
});

export const asFinancial = (): FieldPolicy => ({
  classification: 'confidential',
  piiKind: 'financial',
  exportable: true,
  aiEligible: false,
});

/** Article 9 data. Never leaves the special-category storage path. */
export const asSpecialCategory = (
  piiKind: Extract<PiiKind, 'health' | 'biometric'>,
): FieldPolicy => ({
  classification: 'special-category',
  piiKind,
  exportable: true,
  aiEligible: false,
});
