import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, failure, ok, type Clock, type Result } from '@kithena/domain-kit';
import type { AttributeDefinition, WriterRole } from '@kithena/contracts';

import { canWrite, visibleTo, type ViewerRelations } from '../../domain/access/field-access.js';
import type { PublishedVersion } from '../../domain/schema/publish.js';
import type { Asking, PersonView } from '../person/person-access.js';
import type { RelationsResolver } from '../person/ports.js';
import { run, type PeopleService } from '../person/service.js';
import type { FormValue, FormValues, RecordField, RecordSection } from './model.js';

/**
 * One person's record as a form: the sections and fields this viewer may
 * read, whether each is theirs to change, and the values as a form holds them
 * (PRD §6.6, §8.3; screens 1, 5 and 6).
 *
 * Built from `PersonAccess.read`, so what reaches here has already lost every
 * field the viewer may not read. The definitions are walked for the labels
 * and the rules; a definition whose value was withheld is skipped by
 * `visibleTo`, the same function the read used, so the two cannot disagree.
 */

export interface ScreenDeps {
  readonly service: PeopleService;
  readonly relations: RelationsResolver;
  readonly clock: Clock;
  /** Which person signs in as an account (`PersonReader.personOf`). */
  readonly personOf: (tx: Tx, tenantId: string, accountId: string) => Promise<string | null>;
}

export type Tx = PostgresJsDatabase;

/** An id no person has: the tenant-wide relations, for a question about nobody in particular. */
export const NOBODY = '00000000-0000-0000-0000-000000000000';

const OWNER_WORDS: Record<WriterRole, string> = {
  employee: 'the employee',
  manager: 'their manager',
  hr: 'HR',
  finance: 'Finance',
  system: 'the system',
  external: 'an integration',
};

export function ownedBy(definition: AttributeDefinition): string {
  const words = definition.ownership.map((r) => OWNER_WORDS[r]);
  return words.length <= 1
    ? (words[0] ?? 'nobody')
    : `${words.slice(0, -1).join(', ')} or ${words.at(-1) ?? ''}`;
}

const label = (d: { readonly label: { readonly default: string } }) => d.label.default;

/** The live sections, in order, each with the fields this viewer may read and `include` lets through. */
export function recordSections(
  version: PublishedVersion,
  relations: ViewerRelations,
  include: (definition: AttributeDefinition) => boolean,
  missing: ReadonlySet<string>,
  people: readonly { readonly value: string; readonly label: string }[] = [],
): RecordSection[] {
  const { sections, attributes } = version.document;
  return sections
    .filter((s) => s.archivedAt === null)
    .toSorted((a, b) => a.order - b.order)
    .flatMap((section) => {
      const fields = attributes
        .filter(
          (d) =>
            d.sectionKey === section.key &&
            d.deprecatedAt === null &&
            visibleTo(d, relations) &&
            include(d),
        )
        .toSorted((a, b) => a.order - b.order)
        .map((d) => fieldOf(d, relations, missing, people));
      return fields.length === 0
        ? []
        : [
            {
              key: section.key,
              label: label(section),
              visibility: section.defaultVisibility,
              fields,
            },
          ];
    });
}

function fieldOf(
  d: AttributeDefinition,
  relations: ViewerRelations,
  missing: ReadonlySet<string>,
  people: readonly { readonly value: string; readonly label: string }[],
): RecordField {
  const config = d.typeConfig;
  const options =
    config.kind === 'select' || config.kind === 'multi_select'
      ? config.options
          .filter((o) => o.retiredAt === null)
          .map((o) => ({ value: o.value, label: o.label.default }))
      : config.kind === 'person_ref'
        ? people
        : [];
  const readOnly = !canWrite(d, relations).ok;
  return {
    key: d.key,
    label: label(d),
    description: d.description?.default ?? null,
    dataType: d.dataType,
    options,
    required: d.requiredness.mode === 'always' || missing.has(d.key),
    readOnly,
    ...(config.kind === 'money' && config.currency !== null ? { currency: config.currency } : {}),
    ...(readOnly ? { ownedBy: ownedBy(d) } : {}),
  };
}

/** A stored value as a form holds it. */
export function toForm(value: unknown): FormValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'object') {
    if ('amountMinor' in value && 'currency' in value) {
      return { amountMinor: String(value.amountMinor), currency: String(value.currency) };
    }
    if ('last4' in value) return { last4: (value.last4 as string | null) ?? null };
  }
  return JSON.stringify(value);
}

/** The form values of the fields shown, and nothing else. */
export function formValues(view: PersonView, sections: readonly RecordSection[]): FormValues {
  const shown = new Set(sections.flatMap((s) => s.fields.map((f) => f.key)));
  return Object.fromEntries(
    Object.entries(view.attributes)
      .filter(([key]) => shown.has(key))
      .map(([key, value]) => [key, toForm(value)]),
  );
}

/**
 * A form's answer as the write path takes it.
 *
 * The one translation between the two: numbers arrive as text, money as a
 * string of minor units, a cleared field as the empty string. A sealed value
 * the form only displayed (`{ last4 }`) is not an answer and is dropped. The
 * write path then validates every value against its definition, as it does
 * for REST.
 */
export function fromForm(definition: AttributeDefinition | undefined, value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === '' || value === null) return null;
  if (typeof value === 'object' && 'last4' in value) return undefined;
  if (definition === undefined) return value;
  switch (definition.dataType) {
    case 'number':
    case 'percentage':
    case 'duration':
      return typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    case 'money':
      if (typeof value === 'object' && 'amountMinor' in value) {
        const money = value as { amountMinor: unknown; currency: unknown };
        return { amountMinor: Number(money.amountMinor), currency: money.currency };
      }
      return value;
    default:
      return value;
  }
}

/** Save one section of a record, from a form: only what changed, as one `profile_updated`. */
export async function saveSection(
  deps: ScreenDeps,
  asking: Asking,
  personId: string,
  changed: Readonly<Record<string, unknown>>,
): Promise<Result<void>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const version = await deps.service.schemas.current(tx, asking.tenantId);
    if (!version) return err(failure('SCHEMA_NOT_PUBLISHED', 'Nothing is published yet'));
    const byKey = new Map(version.document.attributes.map((d) => [d.key as string, d]));
    const changes: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(changed)) {
      const written = fromForm(byKey.get(key), value);
      if (written !== undefined) changes[key] = written;
    }
    if (Object.keys(changes).length === 0) return ok(undefined);
    const saved = await deps.service.access.update(tx, { ...asking, personId, changes });
    return saved.ok ? ok(undefined) : saved;
  });
}

/** Whose record "my profile" is: the person signed in as this account. */
export async function personOfViewer(
  deps: Pick<ScreenDeps, 'personOf'>,
  tx: Tx,
  asking: Asking,
): Promise<Result<string>> {
  const id = await deps.personOf(tx, asking.tenantId, asking.viewer.accountId);
  return id === null
    ? err(failure('NOT_FOUND', 'There is no person record for this account yet'))
    : ok(id);
}

/** A display name from the values this viewer could read. */
export function nameOf(attributes: Readonly<Record<string, unknown>>): string | null {
  const given = attributes['preferred_name'] ?? attributes['given_name'];
  const family = attributes['family_name'];
  const parts = [given, family].filter((p): p is string => typeof p === 'string' && p !== '');
  return parts.length === 0 ? null : parts.join(' ');
}
