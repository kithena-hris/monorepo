import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { AttributeDefinition, AttributeDefinitionInput } from '@kithena/contracts';

import { CORE_PACK } from '../../country-packs/core.js';
import { COUNTRY_PACKS, type PackCountry } from '../../country-packs/packs.js';
import { seedCountryPack } from '../../country-packs/seed.js';
import { SchemaDraft, type Attribute, type Section } from '../../domain/schema/draft.js';
import type { PublishedVersion } from '../../domain/schema/publish.js';
import type { Asking } from '../person/person-access.js';
import { run } from '../person/service.js';
import type { PublishSchema } from '../schema/publish-schema.js';
import type { DraftWriter, SchemaRepository } from '../schema/schema-repository.js';
import type { RecordSection, FormValues } from './model.js';
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
    readonly ownership: readonly string[];
    readonly visibility: readonly string[];
    readonly collectAt: string;
    readonly classification: string;
    readonly piiKind: string;
    readonly origin: string;
    readonly pending: Pending;
  }[];
}

function pendingOf(draft: Attribute, published: PublishedVersion | null): Pending {
  const was = published?.document.attributes.find((a) => a.key === draft.key);
  if (was === undefined) return draft.deprecatedAt === null ? 'added' : null;
  if (draft.deprecatedAt !== null && was.deprecatedAt === null) return 'archived';
  return JSON.stringify({ ...draft, order: 0 }) === JSON.stringify({ ...was, order: 0 })
    ? null
    : 'changed';
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
        ownership: a.ownership,
        visibility: a.visibility,
        collectAt: a.collectAt,
        classification: a.classification.classification,
        piiKind: a.classification.piiKind,
        origin: a.origin,
        pending: pendingOf(a, published),
      }));
      const newSections = draft.sections.filter(
        (s) => !(published?.document.sections.some((p) => p.key === s.key) ?? false),
      ).length;
      return ok({
        published:
          published === null
            ? null
            : { version: published.version, publishedAt: published.publishedAt },
        unpublishedChanges: fields.filter((f) => f.pending !== null).length + newSections,
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
              fixed: mine.some((a) => a.classification.classification === 'special-category'),
            };
          }),
        fields,
      });
    }),
  );
}

/** A key from a label: `Cost centre` → `cost_centre`. */
export function keyFrom(label: string): string {
  const key = label
    .normalize('NFKD')
    .replaceAll(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '_')
    .replaceAll(/^_+|_+$/gu, '')
    .slice(0, 60);
  return /^[a-z]/u.test(key) ? key : `f_${key}`.slice(0, 60);
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
  readonly requiredness: 'never' | 'always';
  readonly ownership: readonly string[];
  readonly collectAt: string;
  readonly visibility: readonly string[];
  readonly classification: string;
  readonly piiKind: string;
  readonly classificationSource: 'suggested' | 'human' | 'section_default';
}

function definitionOf(input: FieldInput, order: number): AttributeDefinitionInput {
  const choice = input.dataType === 'select' || input.dataType === 'multi_select';
  const secret =
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
    },
    requiredness: { mode: input.requiredness },
    ownership: input.ownership,
    visibility: input.visibility,
    collectAt: input.collectAt,
    classification: {
      classification: input.classification,
      piiKind: input.piiKind,
      exportable: true,
      aiEligible: input.classification === 'public' || input.classification === 'internal',
    },
    classificationSource: input.classificationSource,
    encrypted: secret,
    origin: 'tenant',
  } as AttributeDefinitionInput;
}

/** Add a field, or change one. The draft decides whether the change is allowed. */
export async function saveField(
  deps: SchemaScreenDeps,
  asking: Asking,
  input: FieldInput,
  editing: string | null,
): Promise<Result<void>> {
  return run(deps.service, asking.tenantId, (tx) =>
    asAdmin(deps, tx, asking, async () => {
      const current = await deps.schema.loadDraft(tx, asking.tenantId);
      const draft = SchemaDraft.rehydrate(current.sections, current.attributes);
      const siblings = current.attributes.filter((a) => a.sectionKey === input.sectionKey).length;
      const definition = definitionOf(input, siblings);
      const saved =
        editing === null
          ? draft.addAttribute(definition)
          : (() => {
              // A key, an origin and a place in the order are not an edit's to change.
              const { key, origin, order, ...patch } = definition;
              void key;
              void origin;
              void order;
              return draft.updateAttribute(editing, patch);
            })();
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
    readonly kind: 'added' | 'tightened' | 'loosened' | 'archived';
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
    actor: { kind: 'user', userId: asking.viewer.accountId } as const,
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
          const changes = (['added', 'tightened', 'loosened', 'archived'] as const).flatMap(
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
            profile = { sections, values: formValues(view.value, sections) };
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
