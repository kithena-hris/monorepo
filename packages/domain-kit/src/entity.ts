export abstract class Entity<TId extends string> {
  // Declared and assigned rather than a parameter property: parameter
  // properties emit code, and `erasableSyntaxOnly` keeps this package to
  // syntax a type stripper can remove.
  readonly id: TId;

  protected constructor(id: TId) {
    this.id = id;
  }

  equals(other: Entity<TId>): boolean {
    return this.constructor === other.constructor && this.id === other.id;
  }
}

/**
 * Value objects validate their own invariants at construction. Zod validates
 * shape at the boundary; this is where meaning lives. Keep them separate or
 * you end up with database lookups inside a superRefine.
 */
export abstract class ValueObject<T extends Record<string, unknown>> {
  protected readonly props: T;

  protected constructor(props: T) {
    this.props = props;
    Object.freeze(this.props);
  }

  equals(other: ValueObject<T>): boolean {
    return JSON.stringify(this.props) === JSON.stringify(other.props);
  }
}
