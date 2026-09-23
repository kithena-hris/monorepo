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
