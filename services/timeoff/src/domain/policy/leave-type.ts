import { AggregateRoot, err, failure, ok, type Result } from '@kithena/domain-kit';
import type { LeaveCategory, LeaveTypeDefinition, LeaveTypeKey } from '@kithena/contracts';

/**
 * A tenant's kind of time off (PRD §6.1).
 *
 * Three invariants, each one somebody else relies on:
 *
 * - **The key never changes.** A ledger row, an export header and somebody's
 *   integration all hold it.
 * - **A statutory type is hidden, never deleted.** The country requires it;
 *   a tenant that does not use it can take it off the menu.
 * - **Sick and parental show teammates "Off" and nothing more** (MT14). The
 *   reason is health or family data, so the domain refuses to loosen it no
 *   matter what a settings form sends.
 */

/** The categories whose reason stays with the manager and HR. */
const PRIVATE: ReadonlySet<LeaveCategory> = new Set(['sick_leave', 'parental_leave']);

/** A definition whose visibility the domain may choose. */
export type LeaveTypeInput = Omit<LeaveTypeDefinition, 'visibility'> & {
  readonly visibility?: LeaveTypeDefinition['visibility'];
};

const locked = (category: LeaveCategory) =>
  failure(
    'VISIBILITY_LOCKED',
    `${category === 'sick_leave' ? 'Sick' : 'Parental'} leave shows teammates only "Off"`,
    ['visibility'],
  );

function check(def: LeaveTypeDefinition): Result<LeaveTypeDefinition> {
  return PRIVATE.has(def.category) && def.visibility !== 'off_only'
    ? err(locked(def.category))
    : ok(def);
}

export class LeaveType extends AggregateRoot<LeaveTypeKey> {
  #definition: LeaveTypeDefinition;
  #hidden = false;
  #deleted = false;

  private constructor(definition: LeaveTypeDefinition) {
    super(definition.key);
    this.#definition = definition;
  }

  /** Sick and parental default to `off_only`; everything else to showing the type. */
  static define(input: LeaveTypeInput): Result<LeaveType> {
    const visibility = input.visibility ?? (PRIVATE.has(input.category) ? 'off_only' : 'type');
    const checked = check({ ...input, visibility });
    return checked.ok ? ok(new LeaveType(checked.value)) : checked;
  }

  /**
   * A leave type as it was stored. Throws on a private type stored as
   * showing its reason: that row is corrupt, not a user's mistake.
   */
  static rehydrate(stored: {
    definition: LeaveTypeDefinition;
    hidden: boolean;
    deleted: boolean;
  }): LeaveType {
    const checked = check(stored.definition);
    if (!checked.ok) throw new Error(checked.error.message);
    const type = new LeaveType(checked.value);
    type.#hidden = stored.hidden;
    type.#deleted = stored.deleted;
    return type;
  }

  get definition(): LeaveTypeDefinition {
    return this.#definition;
  }

  get hidden(): boolean {
    return this.#hidden;
  }

  get deleted(): boolean {
    return this.#deleted;
  }

  /** Anything but the key, and never loosening a private type. */
  update(changes: Partial<LeaveTypeDefinition>): Result<void> {
    if (this.#deleted) return err(failure('DELETED', 'This leave type was deleted'));
    if (changes.key !== undefined && changes.key !== this.#definition.key) {
      return err(
        failure('KEY_IMMUTABLE', 'A leave type keeps the key it was created with', ['key']),
      );
    }
    const checked = check({ ...this.#definition, ...changes });
    if (!checked.ok) return checked;
    this.#definition = checked.value;
    return ok(undefined);
  }

  hide(): void {
    this.#hidden = true;
  }

  show(): void {
    this.#hidden = false;
  }

  delete(): Result<void> {
    if (this.#definition.statutory) {
      return err(
        failure('STATUTORY_NOT_DELETABLE', 'A statutory leave type can be hidden, not deleted'),
      );
    }
    this.#deleted = true;
    return ok(undefined);
  }
}
