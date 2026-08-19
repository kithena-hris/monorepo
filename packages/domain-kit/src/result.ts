/**
 * Domain operations return failures rather than throwing them. Throwing is
 * reserved for bugs. A leave request that exceeds the balance is not a bug.
 */
export type Result<T, E = DomainFailure> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export interface DomainFailure {
  readonly code: string;
  readonly message: string;
  /** Field path for boundary mapping to GraphQL or HTTP field errors. */
  readonly path?: readonly string[];
}

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const isOk = <T, E>(r: Result<T, E>): r is { ok: true; value: T } => r.ok;

export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  throw new Error(`Unwrapped a failed Result: ${JSON.stringify(r.error)}`);
}
