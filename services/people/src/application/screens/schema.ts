import { isCoreKey } from '../person/core.js';
import { err, failure, ok, type Result } from '@kithena/domain-kit';
import {
  COUNTRIES,
  requiresApproval,
  type AttributeDefinition,
  type AttributeDefinitionInput,
  type RequirednessPredicate,
  type VisibilityRule,
} from '@kithena/contracts';

import { CORE_PACK } from '../../country-packs/core.js';
import { COUNTRY_PACKS, type PackCountry } from '../../country-packs/packs.js';
import { seedCountryPack } from '../../country-packs/seed.js';
import {
  aiShareable,
  encryptable,
  keyFrom,
  SchemaDraft,
  type Attribute,
  type Section,
} from '../../domain/schema/draft.js';
import {
  askAtSignup,
  atSignup,
  onSignupPage,
  type SignupAsk,
} from '../../domain/schema/signup.js';
import { sortKeys, type PublishedVersion } from '../../domain/schema/publish.js';
import type { Asking } from '../person/person-access.js';
import { userActor } from '../person/ports.js';
import { run } from '../person/service.js';
import type { PublishSchema } from '../schema/publish-schema.js';
import type { DraftWriter, SchemaRepository } from '../schema/schema-repository.js';
import type { RecordSection, FormValues, PendingFieldView } from './model.js';
import { pendingOnRecord } from './people.js';
import {
  formValues,
  NOBODY,
  personOfViewer,
  recordSections,
  tenantToday,
  type ScreenDeps,
  type Tx,
} from './record.js';

/**
 * The registry screens and the setup wizard (PRD §9, §8.2; screens 1 to 4).
 *
 * Editing the draft, reordering it, previewing and publishing it, and the
 * first publish from a country pack. Every one is `people_admin`'s, checked
 * here — the transport only carries the request.
 */

export interface SchemaScreenDeps extends ScreenDeps {
  readonly schema: SchemaRepository;
  readonly draft: DraftWriter;
  readonly publisher: PublishSchema;
  /** Where version `n`'s artifact is fetchable, for `schema.published`. */
  readonly artifactUrl: (version: number) => string;
}

async function asAdmin<T>(
  deps: SchemaScreenDeps,
  tx: Tx,
  asking: Asking,
  then: () => Promise<Result<T>>,
): Promise<Result<T>> {
  const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
  if (!everyone.isAdmin) {
    return err(failure('FORBIDDEN', 'Only a People administrator changes the employee fields'));
  }
  return then();
}

/* ------------------------------------------------------------ registry -- */

type Pending = 'added' | 'changed' | 'archived' | null;

export interface RegistryView {
  readonly published: { readonly version: number; readonly publishedAt: string } | null;
  readonly unpublishedChanges: number;
  readonly sections: readonly {
    readonly key: string;
    readonly label: string;
    readonly visibility: readonly string[];
    readonly ownership: readonly string[];
    readonly origin: string;
    readonly fixed: boolean;
  }[];
  readonly fields: readonly {
    readonly key: string;
    readonly sectionKey: string;
    readonly label: string;
    readonly description: string | null;
    readonly dataType: string;
    readonly options: readonly string[];
    readonly requiredness: string;
    /** The predicate of a `conditional` rule (PEO-065); null otherwise. */
    readonly requiredWhen: RequirednessPredicate | null;
    readonly ownership: readonly string[];
    readonly visibility: readonly string[];
    /** Custom visibility rules (PEO-066). */
    readonly visibilityRules: readonly VisibilityRule[];
    readonly collectAt: string;
    readonly classification: string;
    readonly piiKind: string;
    /** Whether a change waits for HR's approval (PEO-077): the tenant's choice, else the default. */
    readonly requiresApproval: boolean;
    /**
     * At sign-up, where it is asked: `page` on identity's sign-up page, `after`
     * on the first screen after it (a file, or data that page may not hold).
     * Null when it is not asked at sign-up.
     */
    readonly signup: 'page' | 'after' | null;
    /** It may be put on the sign-up flow: the employee fills it in. */
    readonly signupAskable: boolean;
    /** The assistant may name it: its label and options, never a value from a record. */
    readonly aiEligible: boolean;
    /** It could be shared with the assistant: public or internal, and not sealed. */
    readonly aiShareable: boolean;
    /** Stored sealed: the row keeps its last four and nothing else. */
    readonly encrypted: boolean;
    /** It may be switched to encrypted: a sealable type, not a column People sorts by. */
    readonly encryptable: boolean;
    readonly origin: string;
    readonly pending: Pending;
  }[];
  /** What a predicate's legal-entity and country clauses may name. */
  readonly choices: {
    readonly legalEntities: readonly Choice[];
    readonly countries: readonly Choice[];
  };
}

export interface Choice {
  readonly value: string;
  readonly label: string;
}

export function pendingOf(draft: Attribute, published: PublishedVersion | null): Pending {
  const was = published?.document.attributes.find((a) => a.key === draft.key);
  if (was === undefined) return draft.deprecatedAt === null ? 'added' : null;
  if (draft.deprecatedAt !== null && was.deprecatedAt === null) return 'archived';
  // Key order is not a difference: the published document comes back from
  // `jsonb`, which keeps its own, and the draft is built in code. Compared
  // as written, every field read as changed the moment it was published.
  const same = (a: Attribute): string => JSON.stringify(sortKeys({ ...a, order: 0 }));
  return same(draft) === same(was) ? null : 'changed';
}

const optionsOf = (a: AttributeDefinition): string[] =>
  a.typeConfig.kind === 'select' || a.typeConfig.kind === 'multi_select'
    ? a.typeConfig.options.map((o) => o.label.default)
    : [];

export async function registryView(
  deps: SchemaScreenDeps,
  asking: Asking,
): Promise<Result<RegistryView>> {
  return run(deps.service, asking.tenantId, (tx) =>
    asAdmin(deps, tx, asking, async () => {
      const [draft, published] = await Promise.all([
        deps.schema.loadDraft(tx, asking.tenantId),
        deps.schema.currentVersion(tx, asking.tenantId),
      ]);
      const fields = draft.attributes.map((a) => ({
        key: a.key,
        sectionKey: a.sectionKey,
        label: a.label.default,
        description: a.description?.default ?? null,
        dataType: a.dataType,
        options: optionsOf(a),
        requiredness: a.requiredness.mode,
        requiredWhen: a.requiredness.mode === 'conditional' ? a.requiredness.when : null,
        ownership: a.ownership,
        visibility: a.visibility,
        visibilityRules: a.visibilityRules ?? [],
        collectAt: a.collectAt,
        classification: a.classification.classification,
        piiKind: a.classification.piiKind,
        requiresApproval: requiresApproval(a),
        signup: !atSignup(a) ? null : onSignupPage(a) ? ('page' as const) : ('after' as const),
        signupAskable: askAtSignup(a, 'optional').ok,
        aiEligible: a.classification.aiEligible,
        aiShareable: aiShareable(a),
        encrypted: a.encrypted,
        encryptable: !isCoreKey(a.key) && encryptable(a),
        origin: a.origin,
        pending: pendingOf(a, published),
      }));
      const entities = deps.service.org
        ? await deps.service.org.legalEntities(tx, asking)
        : ok([]);
      const choices = {
        legalEntities: (entities.ok ? entities.value : [])
          .filter((e) => !e.archived)
          .map((e) => ({ value: e.id, label: e.name })),
        countries: COUNTRIES.map((c) => ({ value: c.code, label: c.name })),
      };
      const newSections = draft.sections.filter(
        (s) => !(published?.document.sections.some((p) => p.key === s.key) ?? false),
      ).length;
      return ok({
        published:
          published === null
            ? null
            : { version: published.version, publishedAt: published.publishedAt },
        unpublishedChanges: fields.filter((f) => f.pending !== null).length + newSections,
        choices,
        sections: draft.sections
          .filter((s) => s.archivedAt === null)
          .map((s) => {
            const mine = draft.attributes.filter((a) => a.sectionKey === s.key);
            return {
              key: s.key,
              label: s.label.default,
              visibility: s.defaultVisibility,
              ownership: [...new Set(mine.flatMap((a) => a.ownership))],
              origin: s.origin,
              // §6.7: self-identification's rules are not the tenant's to change.
              // A section is fixed only when it is nothing but that; one such
              // field in a section of ordinary ones is locked on its own.
              fixed:
                mine.length > 0 &&
                mine.every((a) => a.classification.classification === 'special-category'),
            };
          }),
        fields,
      });
    }),
  );
}

export async function addSection(
  deps: SchemaScreenDeps,
  asking: Asking,
  label: string,
): Promise<Result<void>> {
  return run(deps.service, asking.tenantId, (tx) =>
    asAdmin(deps, tx, asking, async () => {
      const current = await deps.schema.loadDraft(tx, asking.tenantId);
      const draft = SchemaDraft.rehydrate(current.sections, current.attributes);
      const added = draft.addSection({
        key: keyFrom(label),
        label: { default: label.trim(), translations: {} },
        order: current.sections.length,
        defaultVisibility: ['self', 'hr'],
        origin: 'tenant',
      });
      if (!added.ok) return added;
      await deps.draft.saveSection(tx, asking.tenantId, added.value);
      return ok(undefined);
    }),
  );
}

export async function reorderSections(
  deps: SchemaScreenDeps,
  asking: Asking,
  order: readonly string[],
): Promise<Result<void>> {
  return run(deps.service, asking.tenantId, (tx) =>
    asAdmin(deps, tx, asking, async () => {
      await deps.draft.orderSections(tx, asking.tenantId, order);
      return ok(undefined);
    }),
  );
}

export async function reorderFields(
  deps: SchemaScreenDeps,
  asking: Asking,
  sectionKey: string,
  order: readonly string[],
): Promise<Result<void>> {
  return run(deps.service, asking.tenantId, (tx) =>
    asAdmin(deps, tx, asking, async () => {
      await deps.draft.orderAttributes(tx, asking.tenantId, sectionKey, order);
      return ok(undefined);
    }),
  );
}

/** What the field editor hands back (`apps/web/people/src/settings/model.ts`, `FieldInput`). */
export interface FieldInput {
  readonly key: string;
  readonly sectionKey: string;
  readonly label: string;
  readonly description: string | null;
  readonly dataType: string;
  readonly options: readonly string[];
  readonly requiredness: 'never' | 'always' | 'conditional';
  /** Required when this holds (PEO-065). Only read when `conditional`. */
  readonly requiredWhen: RequirednessPredicate | null;
  readonly ownership: readonly string[];
  readonly collectAt: string;
  readonly visibility: readonly string[];
  /** Custom visibility rules (PEO-066); empty for none. */
  readonly visibilityRules: readonly VisibilityRule[];
  readonly classification: string;
  readonly piiKind: string;
  readonly classificationSource: 'suggested' | 'human' | 'section_default';
  /**
   * Whether a change waits for HR's approval (PEO-077). Null, or the value
   * the policy would give anyway, keeps the default — so a field saved
   * without touching it follows its classification, now and later.
   */
  readonly requiresApproval: boolean | null;
  /** Store it sealed. Once on, never off; forced on for financial data and identifiers. */
  readonly encrypted?: boolean | null;
  /** Whose rules check a national identifier or a bank account: an ISO country code. */
  readonly country?: string | null;
  /** Which national identifier: `nif`, `nino`, `ssn`… */
  readonly scheme?: string | null;
  /** Whether the assistant may use it; null or absent, it may where it could be (public or internal). */
  readonly aiEligible?: boolean | null;
  /** Required of people added from now on only; existing records are not made incomplete (§6.5). */
  readonly appliesTo?: 'all_records' | 'new_records';
}

function definitionOf(input: FieldInput, order: number): AttributeDefinitionInput {
  const choice = input.dataType === 'select' || input.dataType === 'multi_select';
  const secret =
    input.encrypted === true ||
    input.piiKind === 'financial' ||
    input.dataType === 'bank_account' ||
    input.dataType === 'national_id';
  return {
    key: input.key === '' ? keyFrom(input.label) : input.key,
    sectionKey: input.sectionKey,
    label: { default: input.label.trim(), translations: {} },
    description:
      input.description === null || input.description.trim() === ''
        ? null
        : { default: input.description.trim(), translations: {} },
    order,
    dataType: input.dataType,
    typeConfig: {
      kind: input.dataType,
      ...(choice
        ? {
            options: input.options.map((o) => ({
              value: keyFrom(o),
              label: { default: o, translations: {} },
            })),
          }
        : {}),
      // The contract refuses an identifier or an account with no country.
      ...(input.dataType === 'national_id'
        ? { country: input.country ?? undefined, scheme: input.scheme ?? undefined }
        : input.dataType === 'bank_account'
          ? { country: input.country ?? undefined }
          : {}),
    },
    // A conditional rule without a predicate is refused by the contract, which
    // names the field; nothing here invents one.
    requiredness:
      input.requiredness === 'conditional'
        ? { mode: 'conditional', when: input.requiredWhen }
        : input.requiredness === 'always' && input.appliesTo === 'new_records'
          ? { mode: 'always', appliesTo: 'new_records' }
          : { mode: input.requiredness },
    ownership: input.ownership,
    visibility: input.visibility,
    // Absent when there are none, as the contract keeps it (PEO-066).
    ...(input.visibilityRules.length === 0 ? {} : { visibilityRules: input.visibilityRules }),
    collectAt: input.collectAt,
    classification: {
      classification: input.classification,
      piiKind: input.piiKind,
      exportable: true,
      // Only ever for data the assistant could be shown: public or internal, never sealed.
      aiEligible:
        (input.aiEligible ?? true) &&
        !secret &&
        (input.classification === 'public' || input.classification === 'internal'),
    },
    classificationSource: input.classificationSource,
    encrypted: secret,
    ...(input.requiresApproval === null ||
    input.requiresApproval === requiresApproval({
      encrypted: secret,
      classification: { piiKind: input.piiKind },
    })
      ? {}
      : { requiresApproval: input.requiresApproval }),
    origin: 'tenant',
  } as AttributeDefinitionInput;
}

/** The values a typed core column takes (`people.person`'s CHECKs). */
const COLUMN_VALUES: Readonly<Record<string, readonly string[]>> = {
  employment_type: ['permanent', 'fixed_term', 'contractor', 'intern', 'apprentice', 'seasonal'],
  work_model: ['onsite', 'hybrid', 'remote'],
};

/** Add a field, or change one. The draft decides whether the change is allowed. */
export async function saveField(
  deps: SchemaScreenDeps,
  asking: Asking,
  input: FieldInput,
  editing: string | null,
): Promise<Result<void>> {
  // A key People stores in a typed column of its own (`employment_type`,
  // `work_model`) takes only that column's values: a choice outside them
  // would publish and then refuse every save.
  // A column People sorts, filters and joins on cannot be sealed.
  if (input.encrypted === true && isCoreKey(editing ?? input.key)) {
    return err(
      failure(
        'NOT_ENCRYPTABLE',
        `People keeps ${input.label} in a column of its own, which it sorts and filters by, so it cannot be encrypted`,
        ['encrypted'],
      ),
    );
  }
  const column = COLUMN_VALUES[input.key];
  if (editing === null && column !== undefined) {
    const refused = input.options.map(keyFrom).filter((v) => !column.includes(v));
    if (refused.length > 0) {
      return err(
        failure(
          'KEY_RESERVED',
          `People keeps ${input.key} itself, as one of ${column.join(', ')}; give this field a different name, or use those choices`,
          ['key'],
        ),
      );
    }
  }
  return run(deps.service, asking.tenantId, (tx) =>
    asAdmin(deps, tx, asking, async () => {
      const current = await deps.schema.loadDraft(tx, asking.tenantId);
      const draft = SchemaDraft.rehydrate(current.sections, current.attributes);
      const saved = fieldChange(draft, current.attributes, input, editing);
      if (!saved.ok) return saved;
      await deps.draft.saveAttribute(tx, asking.tenantId, saved.value);
      return ok(undefined);
    }),
  );
}

/**
 * A field added to or changed in `draft`, as the field editor's save does it,
 * and nothing stored: the save stores it, and the AI settings plan checks a
 * change with it before anybody is asked to apply one.
 */
export function fieldChange(
  draft: SchemaDraft,
  attributes: readonly Attribute[],
  input: FieldInput,
  editing: string | null,
): Result<Attribute> {
  const siblings = attributes.filter((a) => a.sectionKey === input.sectionKey).length;
  const definition = definitionOf(input, siblings);
  if (editing === null) return draft.addAttribute(definition);
  // A key, an origin and a place in the order are not an edit's to change.
  const { key: _key, origin: _origin, order: _order, ...patch } = definition;
  // Sealed stays sealed: a form that says nothing of it keeps it.
  const was = attributes.find((a) => a.key === editing);
  // Named even when absent, so removing the last rule removes it.
  return draft.updateAttribute(editing, {
    ...patch,
    encrypted: patch.encrypted === true || was?.encrypted === true,
    visibilityRules: patch.visibilityRules,
    requiresApproval: patch.requiresApproval,
  });
}

/**
 * Put a field on the sign-up flow, optional or required, or take it off: a
 * draft change like any other, in force once published.
 */
export async function setFieldSignup(
  deps: SchemaScreenDeps,
  asking: Asking,
  key: string,
  ask: SignupAsk,
): Promise<Result<void>> {
  return run(deps.service, asking.tenantId, (tx) =>
    asAdmin(deps, tx, asking, async () => {
      const current = await deps.schema.loadDraft(tx, asking.tenantId);
      const attribute = current.attributes.find((a) => a.key === key);
      if (attribute === undefined) {
        return err(failure('ATTRIBUTE_UNKNOWN', `No field called ${key}`, ['key']));
      }
      const patch = askAtSignup(attribute, ask);
      if (!patch.ok) return patch;
      const draft = SchemaDraft.rehydrate(current.sections, current.attributes);
      const saved = draft.updateAttribute(key, patch.value);
      if (!saved.ok) return saved;
      await deps.draft.saveAttribute(tx, asking.tenantId, saved.value);
      return ok(undefined);
    }),
  );
}

/** Share a field with the assistant, or stop: a draft change, in force once published. */
export async function setFieldAssistant(
  deps: SchemaScreenDeps,
  asking: Asking,
  key: string,
  share: boolean,
): Promise<Result<void>> {
  return run(deps.service, asking.tenantId, (tx) =>
    asAdmin(deps, tx, asking, async () => {
      const current = await deps.schema.loadDraft(tx, asking.tenantId);
      const attribute = current.attributes.find((a) => a.key === key);
      if (attribute === undefined) {
        return err(failure('ATTRIBUTE_UNKNOWN', `No field called ${key}`, ['key']));
      }
      const draft = SchemaDraft.rehydrate(current.sections, current.attributes);
      const saved = draft.updateAttribute(key, {
        classification: { ...attribute.classification, aiEligible: share },
      });
      if (!saved.ok) return saved;
      await deps.draft.saveAttribute(tx, asking.tenantId, saved.value);
      return ok(undefined);
    }),
  );
}

/* ------------------------------------------------------------- publish -- */

export interface PublishPreviewView {
  readonly nextVersion: number;
  readonly unchanged: boolean;
  readonly changes: readonly {
    readonly kind: 'added' | 'tightened' | 'loosened' | 'changed' | 'archived';
    readonly key: string;
    readonly summary: string;
    readonly specialCategory: boolean;
  }[];
  readonly impact: {
    readonly evaluated: number;
    readonly becomingIncomplete: number;
    readonly becomingComplete: number;
    readonly forEmployees: number;
    readonly forStaff: number;
  };
  readonly integrationsNotified: number;
}

const WORDS = {
  added: 'added',
  tightened: 'now asks more',
  loosened: 'now asks less',
  changed: 'is shown or required under different rules',
  archived: 'archived',
} as const;

/**
 * `requiredFrom` on what this publish newly requires, written into the draft
 * first so the preview and the publish evaluate it (§6.5). A date on or
 * before today is left off: required from today is what "no date" means.
 */
async function applyRequiredFrom(
  deps: SchemaScreenDeps,
  tx: Tx,
  tenantId: string,
  requiredFrom: string,
): Promise<void> {
  const today = await tenantToday(deps, tx, tenantId);
  if (requiredFrom <= today) return;
  const [draft, published] = await Promise.all([
    deps.schema.loadDraft(tx, tenantId),
    deps.schema.currentVersion(tx, tenantId),
  ]);
  for (const a of draft.attributes) {
    if (a.requiredness.mode === 'never') continue;
    const was = published?.document.attributes.find((p) => p.key === a.key);
    if (was !== undefined && was.requiredness.mode !== 'never') continue;
    await deps.draft.saveAttribute(tx, tenantId, {
      ...a,
      requiredness: { ...a.requiredness, requiredFrom: requiredFrom as never },
    });
  }
}

function request(deps: SchemaScreenDeps, asking: Asking, next: number) {
  return {
    tenantId: asking.tenantId,
    actor: userActor(asking.viewer),
    publishedBy: asking.viewer.accountId,
    correlationId: asking.correlationId,
    artifactUrl: deps.artifactUrl(next),
  };
}

class Rollback extends Error {
  readonly value: Result<PublishPreviewView>;
  constructor(value: Result<PublishPreviewView>) {
    super('preview');
    this.value = value;
  }
}

/** What publishing the draft would do, computed by the publish itself and then rolled back. */
export async function previewPublish(
  deps: SchemaScreenDeps,
  asking: Asking,
  requiredFrom: string,
  integrations: (tx: Tx) => Promise<number>,
): Promise<Result<PublishPreviewView>> {
  return run(deps.service, asking.tenantId, (tx) =>
    asAdmin(deps, tx, asking, async () => {
      // A savepoint, so `requiredFrom` is evaluated and never kept.
      try {
        await tx.transaction(async (inner) => {
          await applyRequiredFrom(deps, inner, asking.tenantId, requiredFrom);
          const current = await deps.schema.currentVersion(inner, asking.tenantId);
          const preview = await deps.publisher.preview(
            inner,
            request(deps, asking, (current?.version ?? 0) + 1),
          );
          if (!preview.ok) throw new Rollback(preview);
          const special = new Set(
            (await deps.schema.loadDraft(inner, asking.tenantId)).attributes
              .filter((a) => a.classification.classification === 'special-category')
              .map((a) => a.key as string),
          );
          const { diff, impact } = preview.value;
          const changes = (['added', 'tightened', 'loosened', 'changed', 'archived'] as const).flatMap(
            (kind) =>
              diff[kind].map((key) => ({
                kind,
                key,
                summary: `${key} ${WORDS[kind]}`,
                specialCategory: special.has(key),
              })),
          );
          throw new Rollback(
            ok({
              nextVersion: preview.value.nextVersion,
              unchanged: preview.value.unchanged,
              changes,
              impact: {
                evaluated: impact.evaluated,
                becomingIncomplete: impact.becomingIncomplete,
                becomingComplete: impact.becomingComplete,
                forEmployees: impact.fieldsByOwner.employee,
                forStaff: impact.fieldsByOwner.staff,
              },
              integrationsNotified: await integrations(inner),
            }),
          );
        });
      } catch (thrown) {
        if (thrown instanceof Rollback) return thrown.value;
        throw thrown;
      }
      return err(failure('INTERNAL', 'The preview did not complete'));
    }),
  );
}

export async function publishDraft(
  deps: SchemaScreenDeps,
  asking: Asking,
  requiredFrom: string,
): Promise<Result<{ version: number }>> {
  return run(deps.service, asking.tenantId, (tx) =>
    asAdmin(deps, tx, asking, async () => {
      await applyRequiredFrom(deps, tx, asking.tenantId, requiredFrom);
      const current = await deps.schema.currentVersion(tx, asking.tenantId);
      const published = await deps.publisher.publish(
        tx,
        request(deps, asking, (current?.version ?? 0) + 1),
      );
      return published.ok ? ok({ version: published.value.version.version }) : published;
    }),
  );
}

/**
 * The classification judgment for a field being described (§12.3), gated.
 *
 * ponytail: the rules below, not the TypeSafe judgment §12.3 describes; no
 * classification advisor exists in the repository yet. The rules only ever
 * err towards more protection, which is the gate's own direction.
 */
export function adviseClassification(field: {
  readonly label: string;
  readonly description: string | null;
  readonly dataType: string;
}):
  | { kind: 'protect'; piiKind: string; reason: string }
  | { kind: 'suggest'; classification: string; piiKind: string; reason: string; floor: string }
  | { kind: 'fallback'; classification: string; piiKind: string; floor: string } {
  const words = `${field.label} ${field.description ?? ''}`.toLowerCase();
  if (
    /health|medical|diagnos|disab|religio|ethnic|sexual|trade union|biometric|pregnan/u.test(words)
  ) {
    return {
      kind: 'protect',
      piiKind: 'health',
      reason: 'It reads like special-category data, which is always protected.',
    };
  }
  if (field.dataType === 'bank_account' || /iban|salary|bank|tax/u.test(words)) {
    return {
      kind: 'suggest',
      classification: 'confidential',
      piiKind: 'financial',
      reason: 'Financial details are confidential and encrypted.',
      floor: 'confidential',
    };
  }
  if (field.dataType === 'national_id' || field.dataType === 'address') {
    return {
      kind: 'suggest',
      classification: 'confidential',
      piiKind: 'identity',
      reason: 'An identifier or an address names somebody on its own.',
      floor: 'confidential',
    };
  }
  const freeText = field.dataType === 'text' || field.dataType === 'long_text';
  return {
    kind: 'fallback',
    classification: 'confidential',
    piiKind: 'none',
    // Free text holds whatever somebody typed, so it floors at confidential.
    floor: freeText ? 'confidential' : 'internal',
  };
}

/* --------------------------------------------------------------- setup -- */

export interface SetupView {
  /** The company's first legal entity, when the back office or an admin made one (PEO-099). */
  readonly legalEntity?: { readonly name: string; readonly country: string };
  readonly entityConfirmed: boolean;
  readonly countries: readonly { readonly code: string; readonly name: string }[];
  readonly packs: readonly {
    readonly country: string;
    readonly countryName: string;
    readonly fields: number;
    readonly sections: readonly {
      readonly key: string;
      readonly label: string;
      readonly summary: string;
      readonly required: number;
      readonly requiredByLaw: number;
      readonly onByDefault: boolean;
    }[];
  }[];
  readonly published: number | null;
  readonly profile: {
    readonly sections: readonly RecordSection[];
    readonly values: FormValues;
    /**
     * The administrator's own changes waiting for approval (PEO-077): the
     * NIF they just gave, which as the only HR member they approve alone.
     */
    readonly pending: readonly PendingFieldView[];
  } | null;
}

const countryName = (code: string): string =>
  new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;

/**
 * The wizard's state (§8.2 steps 6 and 7). The legal entity is the tenant's
 * first, which the back office's company wizard creates (PEO-099); a tenant
 * with none leaves it to the shell to suggest one from the tenant registry.
 */
export async function setupView(
  deps: SchemaScreenDeps,
  asking: Asking,
): Promise<Result<SetupView>> {
  return run(deps.service, asking.tenantId, (tx) =>
    asAdmin(deps, tx, asking, async () => {
      const published = await deps.schema.currentVersion(tx, asking.tenantId);
      let profile: SetupView['profile'] = null;
      if (published !== null) {
        const own = await personOfViewer(deps, tx, asking);
        if (own.ok) {
          const view = await deps.service.access.read(tx, { ...asking, personId: own.value });
          const relations = await deps.relations.relations(
            tx,
            asking.tenantId,
            asking.viewer,
            own.value,
          );
          const verdict = await deps.service.access.completeness(tx, {
            ...asking,
            personId: own.value,
          });
          if (view.ok) {
            const sections = recordSections(
              published,
              relations,
              (d) => d.collectAt !== 'hr_only',
              new Set(verdict.ok ? verdict.value.missing.map((m) => m.key) : []),
            );
            profile = {
              sections,
              values: formValues(view.value, sections),
              pending: await pendingOnRecord(deps, tx, asking, own.value),
            };
          }
        }
      }
      const packs = Object.values(COUNTRY_PACKS).map((pack) => ({
        country: pack.country,
        countryName: countryName(pack.country),
        fields: pack.attributes.length,
        sections: pack.sections.map((s) => {
          const mine = pack.attributes.filter((a) => a.sectionKey === s.key);
          const required = mine.filter((a) => a.requiredness.mode !== 'never').length;
          return {
            key: s.key,
            label: s.label.default,
            summary: mine.map((a) => a.label.default).join(', '),
            required,
            // Required by the country's rule rather than by the tenant's choice.
            requiredByLaw: mine.filter((a) => a.requiredness.mode === 'conditional').length,
            onByDefault: true,
          };
        }),
      }));
      const entities = deps.service.org ? await deps.service.org.legalEntities(tx, asking) : ok([]);
      const entity = entities.ok ? entities.value.find((e) => !e.archived) : undefined;
      return ok({
        ...(entity === undefined
          ? {}
          : { legalEntity: { name: entity.name, country: entity.country } }),
        // Shown every time: confirming the entity is the first thing the admin does.
        entityConfirmed: false,
        countries: packs.map((p) => ({ code: p.country, name: p.countryName })),
        packs,
        published: published?.version ?? null,
        profile,
      });
    }),
  );
}

/**
 * Confirm the legal entity (PEO-099's `people.legal_entity`).
 *
 * The first entity in the same country is renamed to what the admin
 * confirmed. A country is not an edit — it decides which fields the law
 * requires of everybody employed there — so a different country is a new
 * entity, on the tenant's default zone until an admin sets its own. With no
 * legal-entity store wired, confirming checks the input and keeps nothing;
 * the country still travels with the publish.
 */
export async function confirmEntity(
  deps: SchemaScreenDeps,
  asking: Asking,
  entity: { readonly name: string; readonly country: string },
): Promise<Result<void>> {
  const name = entity.name.trim();
  if (name === '') {
    return err(failure('VALUE_INVALID', 'Give the entity’s registered name', ['name']));
  }
  if (!/^[A-Z]{2}$/u.test(entity.country)) {
    return err(failure('VALUE_INVALID', 'A country is a two-letter code', ['country']));
  }
  return run(deps.service, asking.tenantId, (tx) =>
    asAdmin(deps, tx, asking, async () => {
      const org = deps.service.org;
      if (org === undefined) return ok(undefined);
      const entities = await org.legalEntities(tx, asking);
      if (!entities.ok) return entities;
      const same = entities.value.find((e) => !e.archived && e.country === entity.country);
      if (same !== undefined) {
        if (same.name === name) return ok(undefined);
        const renamed = await org.updateLegalEntity(tx, { ...asking, id: same.id, name });
        return renamed.ok ? ok(undefined) : renamed;
      }
      const settings = await org.settings(tx, asking);
      if (!settings.ok) return settings;
      const created = await org.createLegalEntity(tx, {
        ...asking,
        name,
        country: entity.country,
        timeZone: settings.value.defaultTimeZone,
      });
      return created.ok ? ok(undefined) : created;
    }),
  );
}

/**
 * Accept the core fields and a country's pack, and publish version 1.
 *
 * Idempotent on a tenant that has already published: it answers with the
 * version in force rather than refusing, so a double press of the wizard's
 * button is not an error.
 */
export async function publishSetup(
  deps: SchemaScreenDeps,
  asking: Asking,
  choice: { readonly country: string; readonly sections: readonly string[] },
): Promise<Result<{ version: number }>> {
  return run(deps.service, asking.tenantId, (tx) =>
    asAdmin(deps, tx, asking, async () => {
      const current = await deps.schema.currentVersion(tx, asking.tenantId);
      if (current !== null) return ok({ version: current.version });

      const core = await seedCountryPack(tx, asking.tenantId, CORE_PACK);
      if (!core.ok) return core;
      const pack = Object.hasOwn(COUNTRY_PACKS, choice.country)
        ? COUNTRY_PACKS[choice.country as PackCountry]
        : null;
      if (pack !== null) {
        // A section the law requires is on whatever the form sent.
        const on = new Set(choice.sections);
        const kept = pack.sections.filter(
          (s) =>
            on.has(s.key) ||
            pack.attributes.some(
              (a) => a.sectionKey === s.key && a.requiredness.mode === 'conditional',
            ),
        );
        const keys = new Set(kept.map((s) => s.key));
        const seeded = await seedCountryPack(tx, asking.tenantId, {
          sections: kept,
          attributes: pack.attributes.filter((a) => keys.has(a.sectionKey)),
        });
        if (!seeded.ok) return seeded;
      }
      const published = await deps.publisher.publish(tx, request(deps, asking, 1));
      return published.ok ? ok({ version: published.value.version.version }) : published;
    }),
  );
}

export type { Section };
export { keyFrom };
