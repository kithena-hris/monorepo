import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type { NumberingScheme, SchemeInput } from '../../domain/org/numbering.js';

/** One entity's scheme, and the number it hands out next. */
export interface NumberingView extends NumberingScheme {
  readonly legalEntityId: string;
  readonly nextValue: number;
}

/**
 * Employee numbering's storage (PEO-101). Every method takes the transaction:
 * `allocate` holds the entity's row lock until the caller commits, which is
 * what keeps the register gap-free and two hires from taking one number.
 */
export interface EmployeeNumbers {
  list(tx: PostgresJsDatabase, tenantId: string): Promise<readonly NumberingView[]>;
  scheme(
    tx: PostgresJsDatabase,
    tenantId: string,
    legalEntityId: string,
  ): Promise<NumberingView | null>;
  /**
   * Create the scheme with `start` as its next number, or change it — never
   * moving the next number back below one already handed out.
   */
  save(
    tx: PostgresJsDatabase,
    tenantId: string,
    legalEntityId: string,
    scheme: SchemeInput,
  ): Promise<NumberingView>;
  /** The next sequence, taken, with the scheme it was taken under; null when the entity does not number. */
  allocate(
    tx: PostgresJsDatabase,
    tenantId: string,
    legalEntityId: string,
  ): Promise<(NumberingScheme & { readonly sequence: number }) | null>;
  /** Whether anybody in the tenant already holds this exact number. */
  taken(tx: PostgresJsDatabase, tenantId: string, employeeNumber: string): Promise<boolean>;
  /** A number written by hand or by an import: the sequence moves past it. */
  observe(
    tx: PostgresJsDatabase,
    tenantId: string,
    legalEntityId: string,
    sequence: number,
  ): Promise<void>;
}
