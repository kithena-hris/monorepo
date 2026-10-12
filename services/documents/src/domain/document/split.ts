import { err, failure, ok, type Result } from '@kithena/domain-kit';

/** One document inside a scan: its pages, first to last, counted from one. */
export interface PageRange {
  readonly from: number;
  readonly to: number;
}

/**
 * A scan split into its documents (C2): parts that cover every page once, in
 * order, with nothing left between them. Fifty at most.
 */
export function checkParts(parts: readonly PageRange[], pages: number): Result<true> {
  if (parts.length === 0 || parts.length > 50) {
    return err(failure('PARTS', 'Split it into one to fifty documents', ['parts']));
  }
  let next = 1;
  for (const p of parts) {
    if (!Number.isInteger(p.from) || !Number.isInteger(p.to) || p.from !== next || p.to < p.from) {
      return err(failure('PARTS', 'Each document starts where the last ended', ['parts']));
    }
    next = p.to + 1;
  }
  return next === pages + 1
    ? ok(true)
    : err(failure('PARTS', `The documents cover the scan's ${String(pages)} pages`, ['parts']));
}
