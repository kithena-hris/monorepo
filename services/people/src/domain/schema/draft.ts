import { err, failure, ok, type Clock, type Result } from '@kithena/domain-kit';
import {
  AttributeDefinition,
  LocalizedString,
  SectionKey,
  ViewerScope,
  type AttributeDefinitionInput,
  type FieldPolicyInput,
  type Requiredness,
  type WriterRole,
} from '@kithena/contracts';
import * as z from 'zod';

import { specialCategoryReads } from './requiredness.js';

/**
 * The registry as a tenant edits it, before anybody publishes.
 *
 * Draft and published version are two objects on purpose (§6.1): editing a
 * definition changes nothing until a version is published, which is the only
 * way to give an integrator a stable contract and an HR admin somewhere safe
 * to experiment. This is the first half of that. `publish.ts` is the second.
 *
 * Every operation returns a `Result` and nothing throws. A tenant configuring
 * their own registry will hit every one of these refusals, and each is a
 * sentence a settings screen shows rather than a stack trace somebody pages
 * about.
 */

export const SectionInput = z.object({
  key: SectionKey,
  label: LocalizedString,
  order: z.int().nonnegative(),
  /** Inherited by every attribute in the section unless one overrides it. */
  defaultVisibility: z.array(ViewerScope),
  origin: z.enum(['core', 'country_pack', 'tenant']),
});
export type SectionInput = z.input<typeof SectionInput>;

export interface Section extends z.infer<typeof SectionInput> {
  readonly archivedAt: string | null;
}

/**
 * An attribute as the draft holds it.
 *
 * The same shape the contract defines, with no extra "archived" flag beside
 * `deprecatedAt`. There was one, and it was a second column for one fact:
 * `people.attribute_definition` has `deprecated_at` and nothing else, so a
 * draft carrying both would have had to decide which one storage meant.
 * Deprecated is the word the contract uses and the honest one — hidden from
 * forms, still exported, still in history.
 */
export type Attribute = AttributeDefinition;

/**
 * How strict a requiredness rule is, as an order.
 *
 * `conditional` sits between the two because it requires the field of *some*
 * records: lowering `always` to `conditional` narrows who must answer, which
 * for a core attribute is the same kind of loosening as reclassifying it.
 */
const REQUIREDNESS_RANK = { never: 0, conditional: 1, always: 2 } as const;

const CLASSIFICATION_RANK = {
  public: 0,
  internal: 1,
  confidential: 2,
  'special-category': 3,
} as const;

/**
 * Which viewer scopes let a given writer read what they wrote.
 *
 * `system` and `external` map to nothing, and that is not an omission: an
 * integration writing a field does not need to see a form, so a required
 * field owned only by a system is not a person being nagged for something
 * they cannot see.
 */
const READS_OWN_WRITES: Record<WriterRole, readonly string[]> = {
  employee: ['self', 'directory'],
  manager: ['manager', 'manager_chain'],
  hr: ['hr', 'admin'],
  finance: ['finance', 'admin'],
  system: [],
  external: [],
};

function ownerCanRead(owners: readonly WriterRole[], visibility: readonly string[]): boolean {
  return owners.some((role) => {
    const scopes = READS_OWN_WRITES[role];
    // A writer with no human reader is not a person who can be locked out.
    return scopes.length === 0 || scopes.some((scope) => visibility.includes(scope));
  });
}

/**
 * Which scopes a viewer holding `scope` also holds (`scopesOf` in
 * `field-access.ts`): everybody is the directory, and a direct manager is in
 * their report's chain.
 */
const ALSO_HOLDS: Record<string, readonly string[]> = {
  manager: ['manager', 'manager_chain', 'directory'],
};

/**
 * A custom visibility rule may not disclose what it depends on (PEO-066).
 *
 * "Managers see the bonus band when grade is senior" shows a manager the
 * grade of every report, one visible field at a time. So every attribute a
 * rule's predicate names must be one each scope the rule grants can already
 * read — outright, by preset, since a rule holding is itself the thing being
 * decided — and never special-category data, which does not decide access to
 * anything (§6.7). A name the document does not hold is refused too: it would
 * never hold, and it would start holding the day somebody re-used the key.
 *
 * A placement fact is held to the same rule, through the field it is read
 * from (`factsOf` in `application/person/subject.ts`): "managers see this for
 * people on leave" tells every manager who is on leave. Status has no field;
 * it is HR's alone, as the profile's employment panel and `employmentPeriods`
 * already decide (PEO-120).
 *
 * Checked on the edited attribute when it is saved, and on every attribute
 * when the draft is published, because narrowing or archiving the field a
 * rule depends on is an edit to a different attribute.
 */
export function checkVisibilityRules(
  attribute: Pick<Attribute, 'key' | 'visibilityRules'>,
  attributes: readonly Attribute[],
): Result<void> {
  const byKey = new Map(attributes.map((a) => [a.key as string, a]));
  for (const rule of attribute.visibilityRules ?? []) {
    for (const clause of rule.when.clauses) {
      const discloses =
        clause.operand === 'status'
          ? rule.scopes.some((scope) => scope !== 'hr')
          : readsUnseen(
              clause.operand === 'attribute' ? [clause.key] : PLACEMENT_SOURCES[clause.operand],
              rule.scopes,
              byKey,
            );
      if (discloses) {
        const named = clause.operand === 'attribute' ? clause.key : FACT_WORDS[clause.operand];
        return err(
          failure(
            'VISIBILITY_RULE_DISCLOSES',
            `${attribute.key} is shown by a rule on ${named}, which not everybody it is shown to may read`,
            ['visibilityRules'],
          ),
        );
      }
    }
  }
  return ok(undefined);
}

/** How a refusal names a placement fact to the administrator reading it. */
const FACT_WORDS = {
  legalEntity: 'legal entity',
  country: 'country',
  employmentType: 'employment type',
  workModel: 'work model',
  status: 'employment status',
} as const;

/** The fields each placement fact is read from, as `factsOf` reads them. */
const PLACEMENT_SOURCES = {
  legalEntity: ['legal_entity_id'],
  // `countryOf`: the home address's country, else a `country` field.
  country: ['home_address', 'country'],
  employmentType: ['employment_type'],
  workModel: ['work_model'],
} as const;

/**
 * Whether a rule reading these fields would show any of them to a scope that
 * may not read it by preset. No field at all discloses too: the rule would
 * start holding the day somebody added one.
 */
function readsUnseen(
  keys: readonly string[],
  scopes: readonly string[],
  byKey: ReadonlyMap<string, Attribute>,
): boolean {
  const named = keys.flatMap((k) => byKey.get(k) ?? []);
  return (
    named.length === 0 ||
    named.some(
      (a) =>
        a.deprecatedAt !== null ||
        a.classification.classification === 'special-category' ||
        scopes.some(
          (scope) =>
            !(ALSO_HOLDS[scope] ?? [scope, 'directory']).some((s) =>
              a.visibility.includes(s as never),
            ),
        ),
    )
  );
}

/**
 * A requiredness predicate may not name special-category data (PEO-065): a
 * gap it opens is shown to managers and HR, and "workplace adjustment
 * missing" tells them the disability field is filled in. Checked on save and
 * at publish, because reclassifying the named field is an edit to another.
 */
export function checkRequirednessPredicate(
  attribute: Pick<Attribute, 'key' | 'requiredness'>,
  attributes: readonly Attribute[],
): Result<void> {
  const [named] = specialCategoryReads(attribute.requiredness, attributes);
  if (named === undefined) return ok(undefined);
  return err(
    failure(
      'PREDICATE_DISCLOSES',
      `${attribute.key} is required on a condition over ${named}, which is special-category data: a missing value would tell whoever sees it that the condition held`,
      ['requiredness'],
    ),
  );
}

const DuplicateKey = (what: string, key: string) =>
  failure('DUPLICATE_KEY', `A ${what} called ${key} already exists`, ['key']);

export class SchemaDraft {
  readonly #sections = new Map<string, Section>();
  readonly #attributes = new Map<string, Attribute>();

  private constructor() {}

  /** A tenant with nothing configured yet. Country packs fill it; so does a person. */
  static empty(): SchemaDraft {
    return new SchemaDraft();
  }

  /** Rebuild from storage. Raises nothing and checks nothing — these rows were checked on the way in. */
  static rehydrate(sections: readonly Section[], attributes: readonly Attribute[]): SchemaDraft {
    const draft = new SchemaDraft();
    for (const section of sections) draft.#sections.set(section.key, section);
    for (const attribute of attributes) draft.#attributes.set(attribute.key, attribute);
    return draft;
  }

  section(key: string): Section | undefined {
    return this.#sections.get(key);
  }

  attribute(key: string): Attribute | undefined {
    return this.#attributes.get(key);
  }

  liveSections(): readonly Section[] {
    return [...this.#sections.values()]
      .filter((s) => s.archivedAt === null)
      .toSorted((a, b) => a.order - b.order);
  }

  liveAttributes(): readonly Attribute[] {
    return [...this.#attributes.values()]
      .filter((a) => a.deprecatedAt === null)
      .toSorted((a, b) => a.order - b.order);
  }

  attributesIn(sectionKey: string): readonly Attribute[] {
    return this.liveAttributes().filter((a) => a.sectionKey === sectionKey);
  }

  addSection(input: SectionInput): Result<Section> {
    const parsed = SectionInput.safeParse(input);
    if (!parsed.success) return err(invalid('section', parsed.error));
    if (this.#sections.has(parsed.data.key)) return err(DuplicateKey('section', parsed.data.key));

    const section: Section = { ...parsed.data, archivedAt: null };
    this.#sections.set(section.key, section);
    return ok(section);
  }

  /**
   * Archive a section, which is refused while anything required lives in it.
   *
   * Archiving hides every field in the section from every form. Doing that
   * while the completeness recompute goes on counting those fields as missing
   * produces four hundred records that are incomplete for a reason nobody can
   * see and nobody can fix.
   */
  /*
   * `clock` rather than `new Date()`, which CLAUDE.md bans in domain code and
   * is right to: an archive date is what a later `asOf` read compares against,
   * and a domain that reads the wall clock cannot be asked what it thought was
   * true on 3 March.
   */
  archiveSection(key: string, clock: Clock): Result<Section> {
    const section = this.#sections.get(key);
    if (!section) return err(failure('SECTION_UNKNOWN', `No section called ${key}`, ['sectionKey']));
    if (section.archivedAt !== null) return ok(section);

    const required = this.attributesIn(key).filter((a) => a.requiredness.mode !== 'never');
    if (required.length > 0) {
      return err(
        failure(
          'SECTION_HOLDS_REQUIRED',
          `${key} still holds required fields: ${required.map((a) => a.key).join(', ')}`,
          ['sectionKey'],
        ),
      );
    }

    const archived: Section = { ...section, archivedAt: clock.instant() };
    this.#sections.set(key, archived);
    return ok(archived);
  }

  addAttribute(input: AttributeDefinitionInput): Result<Attribute> {
    const parsed = AttributeDefinition.safeParse(input);
    if (!parsed.success) return err(invalid('definition', parsed.error));

    const definition = parsed.data;
    if (this.#attributes.has(definition.key)) {
      return err(DuplicateKey('attribute', definition.key));
    }

    const section = this.#sections.get(definition.sectionKey);
    if (!section) {
      return err(
        failure('SECTION_UNKNOWN', `No section called ${definition.sectionKey}`, ['sectionKey']),
      );
    }
    if (section.archivedAt !== null) {
      return err(
        failure('SECTION_ARCHIVED', `${section.key} is archived`, ['sectionKey']),
      );
    }

    const readable = this.#checkReadableByOwner(definition);
    if (!readable.ok) return readable;

    const discloses = checkVisibilityRules(definition, [...this.#attributes.values()]);
    if (!discloses.ok) return discloses;

    const predicate = checkRequirednessPredicate(definition, [...this.#attributes.values()]);
    if (!predicate.ok) return predicate;

    this.#attributes.set(definition.key, definition);
    return ok(definition);
  }

  /**
   * Edit an attribute. There is no `key` in the patch, and that is the rule.
   *
   * A rename is a new attribute plus an explicit migration of values, because
   * the key is what every export column, webhook payload and third-party
   * integration has been reading. An in-place edit would break all of them
   * silently and be indistinguishable, afterwards, from the field having been
   * deleted.
   */
  updateAttribute(
    key: string,
    patch: Partial<Omit<AttributeDefinitionInput, 'key' | 'origin'>>,
  ): Result<Attribute> {
    const current = this.#attributes.get(key);
    if (!current) {
      return err(failure('ATTRIBUTE_UNKNOWN', `No attribute called ${key}`, ['key']));
    }

    const parsed = AttributeDefinition.safeParse({ ...current, ...patch, key, origin: current.origin });
    if (!parsed.success) return err(invalid('definition', parsed.error));
    const next = parsed.data;

    if (next.sectionKey !== current.sectionKey) {
      const section = this.#sections.get(next.sectionKey);
      if (!section) {
        return err(failure('SECTION_UNKNOWN', `No section called ${next.sectionKey}`, ['sectionKey']));
      }
      if (section.archivedAt !== null) {
        return err(failure('SECTION_ARCHIVED', `${section.key} is archived`, ['sectionKey']));
      }
    }

    const floor = this.#checkFloor(current, next);
    if (!floor.ok) return floor;

    const readable = this.#checkReadableByOwner(next);
    if (!readable.ok) return readable;

    const discloses = checkVisibilityRules(next, [...this.#attributes.values()]);
    if (!discloses.ok) return discloses;

    const predicate = checkRequirednessPredicate(next, [...this.#attributes.values()]);
    if (!predicate.ok) return predicate;

    const attribute: Attribute = { ...next, deprecatedAt: current.deprecatedAt };
    this.#attributes.set(key, attribute);
    return ok(attribute);
  }

  /**
   * Archive a tenant's own attribute. A core one is refused.
   *
   * Core attributes are what Kithena's own screens, exports and events are
   * written against — §6.2 says they cannot be deleted, and archiving is
   * deletion as far as a form is concerned.
   */
  archiveAttribute(key: string, clock: Clock): Result<Attribute> {
    const current = this.#attributes.get(key);
    if (!current) {
      return err(failure('ATTRIBUTE_UNKNOWN', `No attribute called ${key}`, ['key']));
    }
    if (current.origin === 'core') {
      return err(failure('CORE_ATTRIBUTE', `${key} is shipped by Kithena and cannot be archived`, ['key']));
    }
    if (current.deprecatedAt !== null) return ok(current);

    const archived: Attribute = { ...current, deprecatedAt: clock.instant() };
    this.#attributes.set(key, archived);
    return ok(archived);
  }

  /**
   * The floor a tenant configures above, for core and country-pack fields.
   *
   * A tenant may relabel `national_id`, may not make it optional, and may not
   * mark it AI-eligible. Tightening is always allowed — a customer whose works
   * council wants a field treated as confidential is right, and the registry
   * should not argue.
   */
  #checkFloor(current: Attribute, next: AttributeDefinition): Result<void> {
    if (current.origin === 'tenant') return ok(undefined);

    if (!classificationAtLeastAsStrict(next.classification, current.classification)) {
      return err(
        failure(
          'CLASSIFICATION_LOOSENED',
          `${current.key} is shipped by Kithena and its classification cannot be loosened`,
          ['classification'],
        ),
      );
    }

    if (REQUIREDNESS_RANK[next.requiredness.mode] < REQUIREDNESS_RANK[current.requiredness.mode]) {
      return err(
        failure(
          'REQUIREDNESS_LOWERED',
          `${current.key} is shipped by Kithena and cannot be made less required`,
          ['requiredness'],
        ),
      );
    }

    return ok(undefined);
  }

  #checkReadableByOwner(definition: {
    key: string;
    requiredness: Requiredness;
    ownership: readonly WriterRole[];
    visibility: readonly string[];
  }): Result<void> {
    if (definition.requiredness.mode === 'never') return ok(undefined);
    if (ownerCanRead(definition.ownership, definition.visibility)) return ok(undefined);

    return err(
      failure(
        'REQUIRED_BUT_UNREADABLE',
        `${definition.key} is required of somebody who cannot see it`,
        ['visibility'],
      ),
    );
  }
}

/**
 * A tenant may tighten and may not loosen.
 *
 * Exported shape mirrors `atLeastAsStrict` in the contracts package, which
 * compares two policies; this one is the domain's use of the same ordering and
 * is kept here because the failure it produces is a domain failure with a code
 * a settings screen shows.
 */
function classificationAtLeastAsStrict(next: FieldPolicyInput, floor: FieldPolicyInput): boolean {
  if (CLASSIFICATION_RANK[next.classification] < CLASSIFICATION_RANK[floor.classification]) {
    return false;
  }
  if (next.aiEligible && !floor.aiEligible) return false;
  // Exportability is the subject's right rather than the tenant's setting.
  if (!next.exportable && floor.exportable) return false;
  return true;
}

/**
 * A Zod refusal, as a domain failure.
 *
 * The contract already refuses an incoherent definition — a financial field
 * that is not encrypted, a special-category field that travels on an event —
 * and re-implementing those checks here would be a second copy of a rule that
 * is already the single source. What the domain owes its caller is a `Result`
 * rather than a thrown `ZodError`, and the path so a form can point at the
 * field that refused.
 */
function invalid(what: string, error: z.ZodError) {
  const first = error.issues[0];
  const path = first?.path.map(String) ?? [];
  return failure(
    what === 'definition' ? 'DEFINITION_INVALID' : 'SECTION_INVALID',
    first?.message ?? `That ${what} is not valid`,
    path,
  );
}
