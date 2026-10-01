import type { ColumnSeen } from './new-fields.js';

/**
 * What the model is told about new information in an imported file.
 *
 * The instruction is the same for every company and every file, and says
 * exactly what JSON to answer with (`ModelAnswer`, read strictly item by
 * item). The context is the columns — each header, and the
 * shape of its values in words, never a value — and the sections and fields
 * the company already has, by name.
 */

export const NEW_FIELDS_INSTRUCTION = `An HR team is importing a spreadsheet of employees. Some columns match no field the company has. For each listed column, propose one employee field, or skip it when it holds nothing an HR system should keep or repeats a field the company already has. Nothing you propose is applied until HR reviews it and a People administrator approves it.

Answer with one JSON object and nothing else, in exactly this shape:
{"proposals":[{"column":3,"field":{"label":"Emergency contact","dataType":"text","required":false,"ownership":["employee","hr"],"visibility":["self","hr"],"classification":"confidential","piiKind":"contact","encrypted":false,"aiEligible":false},"newSection":"Emergency contact","why":"Personal contact details the employee keeps up to date.","forExisting":"ask","forExistingWhy":"Only they know it."}],"skipped":[{"column":7,"why":"Repeats the existing work email."}],"summary":"One sentence, naming no person and no value."}
- Every listed column appears once, in proposals or in skipped. Use "sectionKey" (an existing section's key) instead of "newSection" when an existing section fits.
- field may also carry "options" (choices, for select only), "country" (two letters, for bank_account) and "description" (help text). No other keys anywhere.
- dataType is one of: text, long_text, number, decimal, percentage, date, boolean, select, email, phone, url, country, bank_account.

You see each column's header and the shape of its values ("dates, dd/mm/yyyy", "4 distinct short values"), never a value. Work from those alone.

For each field
- label: what HR would call it. Put it in an existing section that fits (sectionKey), or name a new section (newSection); columns that belong together share a new section.
- dataType from the shape: dates are date, "N distinct short values" is select, IBAN-like is bank_account (with its country), email-like is email, phone-like is phone.
- Who fills it in (ownership: employee, manager, hr, finance) and who sees it (visibility: self, manager, manager_chain, hr, finance, admin, directory). Employees fill in their own details and see them (self). Managers see what they need for their team, never pay or bank details or health.
- Protection, never less than the data needs: health and other GDPR Article 9 data is special-category; bank details, pay and tax are confidential with piiKind financial and encrypted; identifiers are confidential with piiKind identity and encrypted; contact details are confidential with piiKind contact. aiEligible only for public or internal data.
- required: whether new people must have it.
- why: one short line HR can read.

For people already here whom the file gives no value (forExisting)
- ask: details only they know (contact, emergency contact, bank account).
- hr: organisational data HR records (cost centre, department, contract).
- new: worth having from now on, not worth chasing the people here for (locker, parking).
- leave: nice to have, or volunteered (T-shirt size, health).
- default: one value is right for everybody missing it; only when the shape says every row holds the same value.
Give forExistingWhy in one short line.

Never invent a person or a value.`;

export function newFieldsContext(
  columns: readonly ColumnSeen[],
  sections: readonly {
    readonly key: string;
    readonly label: string;
    readonly fields: readonly string[];
  }[],
): Record<string, unknown> {
  return {
    columns: columns.map((c) => ({
      column: c.column,
      header: c.header,
      shape: c.local.shape,
      ...(c.single === null ? {} : { sameInEveryRow: true }),
    })),
    sections,
  };
}
