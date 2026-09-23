/**
 * The shapes the settings screens are drawn from.
 *
 * Written here rather than imported from `@kithena/contracts`: a remote is
 * presentation, and `.dependency-cruiser.cjs` keeps it from importing a
 * contract. These are view models — what the shell hands over after the
 * application layer has already decided what this viewer may see and do. The
 * names follow the contract's (`AttributeDefinition`, `ViewerScope`,
 * `WriterRole`) so a reader can match one to the other.
 */

export type WriterRole = 'employee' | 'manager' | 'hr' | 'finance' | 'system' | 'external';
export type ViewerScope =
  'self' | 'manager' | 'manager_chain' | 'hr' | 'finance' | 'admin' | 'directory';
export type CollectAt = 'signup' | 'enrolment' | 'onboarding' | 'hr_only' | 'anytime';
export type Classification = 'public' | 'internal' | 'confidential' | 'special-category';
export type PiiKind = 'identity' | 'financial' | 'contact' | 'health' | 'biometric' | 'none';
export type RequirednessMode = 'never' | 'always' | 'conditional';
export type Origin = 'core' | 'country_pack' | 'tenant';

/** The data types an admin may pick for a new field. The contract's full list. */
export const DATA_TYPES = [
  'text',
  'long_text',
  'number',
  'decimal',
  'percentage',
  'money',
  'boolean',
  'date',
  'datetime',
  'duration',
  'select',
  'multi_select',
  'tags',
  'email',
  'phone',
  'url',
  'country',
  'currency',
  'language',
  'time_zone',
  'address',
  'national_id',
  'bank_account',
  'person_ref',
  'org_unit_ref',
  'legal_entity_ref',
  'document_ref',
  'image',
] as const;
export type DataType = (typeof DATA_TYPES)[number];

export interface RegistrySection {
  readonly key: string;
  readonly label: string;
  /** The default every attribute in the section inherits. */
  readonly visibility: readonly ViewerScope[];
  readonly ownership: readonly WriterRole[];
  readonly origin: Origin;
  /**
   * Its rules are not the tenant's to change — diversity self-identification,
   * §6.7. It can still be read; it cannot be edited or moved.
   */
  readonly fixed: boolean;
}

export interface RegistryField {
  readonly key: string;
  readonly sectionKey: string;
  readonly label: string;
  readonly description: string | null;
  readonly dataType: DataType;
  readonly options: readonly string[];
  readonly requiredness: RequirednessMode;
  readonly ownership: readonly WriterRole[];
  readonly visibility: readonly ViewerScope[];
  readonly collectAt: CollectAt;
  readonly classification: Classification;
  readonly piiKind: PiiKind;
  readonly origin: Origin;
  /** Changed since the last published version, and how. */
  readonly pending: 'added' | 'changed' | 'archived' | null;
}

export interface RegistryDraft {
  readonly published: { readonly version: number; readonly publishedAt: string } | null;
  readonly unpublishedChanges: number;
  readonly sections: readonly RegistrySection[];
  readonly fields: readonly RegistryField[];
}

/** What the field editor hands back. The application layer validates it again. */
export interface FieldInput {
  readonly key: string;
  readonly sectionKey: string;
  readonly label: string;
  readonly description: string | null;
  readonly dataType: DataType;
  readonly options: readonly string[];
  readonly requiredness: 'never' | 'always';
  readonly ownership: readonly WriterRole[];
  readonly collectAt: CollectAt;
  readonly visibility: readonly ViewerScope[];
  readonly classification: Classification;
  readonly piiKind: PiiKind;
  /** Whether the admin took the suggestion as given. */
  readonly classificationSource: 'suggested' | 'human' | 'section_default';
}

/**
 * The classification judgment, already put through the gate (§12.3).
 *
 * The gate — which probabilities force what — is a rule about protection, so
 * it runs in the application layer and arrives here decided. The editor only
 * draws each outcome:
 *
 * - `protect`  forced to special-category; needs an explicit tick.
 * - `suggest`  confident; pre-selected and marked as a suggestion.
 * - `choose`   unsure; nothing pre-selected, the top two with their reasons.
 * - `fallback` no judgment available; the section's default, or confidential.
 *
 * `floor` is the least protection the answer may have, whichever outcome.
 */
export type ClassificationAdvice =
  | {
      readonly kind: 'protect';
      readonly piiKind: PiiKind;
      readonly reason: string;
    }
  | {
      readonly kind: 'suggest';
      readonly classification: Classification;
      readonly piiKind: PiiKind;
      readonly reason: string;
      readonly floor: Classification;
    }
  | {
      readonly kind: 'choose';
      readonly options: readonly {
        readonly classification: Classification;
        readonly reason: string;
      }[];
      readonly piiKind: PiiKind;
      readonly floor: Classification;
    }
  | {
      readonly kind: 'fallback';
      readonly classification: Classification;
      readonly piiKind: PiiKind;
      readonly floor: Classification;
    };

/** What the advisor is told. Metadata only — never a value (§12.3). */
export interface FieldDescription {
  readonly label: string;
  readonly description: string | null;
  readonly dataType: DataType;
  readonly sectionKey: string;
  readonly options: readonly string[];
}

export const CLASSIFICATION_ORDER: readonly Classification[] = [
  'public',
  'internal',
  'confidential',
  'special-category',
];

export function atLeast(candidate: Classification, floor: Classification): boolean {
  return CLASSIFICATION_ORDER.indexOf(candidate) >= CLASSIFICATION_ORDER.indexOf(floor);
}

/**
 * What publishing the draft would do, as the application layer computed it
 * (§9.3). Computed by the same functions the recompute runs, so the numbers
 * here are the ones that will come true; the screen only draws them.
 */
export interface PublishPreview {
  readonly nextVersion: number;
  /** Nothing would change: publishing is refused rather than minting a copy. */
  readonly unchanged: boolean;
  readonly changes: readonly {
    /** `+` added, `~` tightened or loosened, `−` archived. */
    readonly kind: 'added' | 'tightened' | 'loosened' | 'archived';
    readonly key: string;
    /** "Cost centre added to HR information, required for everyone". */
    readonly summary: string;
    readonly specialCategory: boolean;
  }[];
  readonly impact: {
    readonly evaluated: number;
    readonly becomingIncomplete: number;
    readonly becomingComplete: number;
    /** Missing answers the people themselves will be asked for. */
    readonly forEmployees: number;
    /** Missing answers HR fills in, in one grid. */
    readonly forStaff: number;
  };
  /** Webhook endpoints told about the new version. */
  readonly integrationsNotified: number;
}
