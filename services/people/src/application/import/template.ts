import { canWrite, type ViewerRelations } from '../../domain/access/field-access.js';
import type { PublishedVersion } from '../../domain/schema/publish.js';
import { writeCsv } from './csv.js';

/**
 * The import template (design V6, "Template"): one header row, a column for
 * each published field that is still collected and that this viewer may
 * write, headed by its label — which is what the mapper matches a header
 * against (`proposeMapping`), so the file maps itself on the way back in.
 *
 * No example row: a row of made-up values is a made-up person the first time
 * somebody forgets to delete it. A repeating field has no column; it is a
 * sheet of its own in a workbook, as an export writes it.
 */
export function templateHeaders(version: PublishedVersion, viewer: ViewerRelations): string[] {
  return version.document.attributes
    .filter(
      (d) => d.deprecatedAt === null && d.cardinality !== 'repeating' && canWrite(d, viewer).ok,
    )
    .map((d) => d.label.default);
}

export function importTemplate(version: PublishedVersion, viewer: ViewerRelations): Uint8Array {
  return writeCsv([templateHeaders(version, viewer)]);
}
