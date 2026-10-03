import { choiceField } from '../../country-packs/core.js';
import { aliasOf, builtInChoices, CHOICE_KEYS, choiceOf } from '../../domain/import/aliases.js';
import { SchemaDraft, type Attribute, type Section } from '../../domain/schema/draft.js';

/**
 * People's own choice fields in an import: a file's column for employment
 * type or work model goes onto People's field, never a second one, and the
 * values the list lacks are added. Shared by the mapping, which reads the
 * file against the version this would publish, and the plan, which publishes
 * it (`application/assistant/import-fields.ts`).
 */

/** A column and its cells; `key` when it is mapped already. */
interface ChoiceCells {
  readonly index: number;
  readonly header: string;
  readonly key: string;
  readonly cells: readonly string[];
}

/** A column of the file that is one of People's own choice fields, and what approving does to it. */
export interface ChoiceColumn {
  readonly column: number;
  readonly header: string;
  readonly key: string;
  readonly label: string;
  /** The file's values the field's list gains, by label. */
  readonly added: readonly string[];
  /** The column matched no field: People's field comes in with this import. */
  readonly unmatched: boolean;
}

/**
 * The file's columns for People's own choice fields (employment type, work
 * model), mapped already or under a header that means one, each onto
 * People's field and never a second one beside it: the field is added when
 * the company has none, with People's values, and a value of the file it has
 * under no spelling is added to its list (`choiceOf`). Nothing is stored:
 * the attributes come back changed, and the plan publishes them.
 */
export function choiceFields(
  current: { readonly sections: readonly Section[]; readonly attributes: readonly Attribute[] },
  file: {
    readonly choices: readonly ChoiceCells[];
    readonly unmatched: readonly Omit<ChoiceCells, 'key'>[];
  },
): {
  readonly columns: readonly ChoiceColumn[];
  readonly attributes: readonly Attribute[];
  readonly problems: readonly { column: number; header: string; message: string }[];
} {
  const draft = SchemaDraft.rehydrate(current.sections, current.attributes);
  const live = (key: string) =>
    current.attributes.find((a) => a.key === key && a.deprecatedAt === null);
  const candidates = [
    ...file.choices.map((c) => ({ ...c, unmatched: false })),
    ...file.unmatched.flatMap((c) => {
      const key = aliasOf(c.header);
      return key !== null && CHOICE_KEYS.includes(key) && live(key) === undefined
        ? [{ ...c, key, unmatched: true }]
        : [];
    }),
  ];
  const columns: ChoiceColumn[] = [];
  const attributes: Attribute[] = [];
  const problems: { column: number; header: string; message: string }[] = [];
  const done = new Set<string>();
  for (const c of candidates) {
    const was = live(c.key);
    const config = was?.typeConfig.kind === 'select' ? was.typeConfig : null;
    // A company's own field under the key, of another kind, is left as it is.
    if (done.has(c.key) || (was !== undefined && config === null)) continue;
    done.add(c.key);
    const options =
      config === null
        ? [...builtInChoices(c.key)]
        : config.options.map((o) => ({ value: o.value, label: o.label.default }));
    const added: { value: string; label: string }[] = [];
    // As a cell is read (`coerceCell`): an option by value or label, else what it means.
    for (const cell of c.cells) {
      const known = [...options, ...added];
      const wanted = cell.trim().toLocaleLowerCase('en');
      if (known.some((o) => o.value === wanted || o.label.toLocaleLowerCase('en') === wanted)) {
        continue;
      }
      const meant = choiceOf(c.key, cell);
      if (meant !== null && !known.some((o) => o.value === meant.value)) added.push(meant);
    }
    if (config !== null && added.length === 0) continue;
    const section =
      draft.section('employment')?.archivedAt === null
        ? 'employment'
        : (draft.liveSections()[0]?.key ?? 'employment');
    const saved =
      config === null
        ? draft.addAttribute(
            choiceField(
              c.key,
              {
                sectionKey: section,
                order: current.attributes.filter((a) => a.sectionKey === section).length,
              },
              [...options, ...added],
            ),
          )
        : draft.updateAttribute(c.key, {
            typeConfig: {
              ...config,
              options: [
                ...config.options,
                ...added.map((o) => ({
                  value: o.value,
                  label: { default: o.label, translations: {} },
                })),
              ],
            },
          });
    if (!saved.ok) {
      problems.push({ column: c.index, header: c.header, message: saved.error.message });
      continue;
    }
    attributes.push(saved.value);
    columns.push({
      column: c.index,
      header: c.header,
      key: c.key,
      label: saved.value.label.default,
      added: added.map((a) => a.label),
      unmatched: c.unmatched,
    });
  }
  return { columns, attributes, problems };
}

/** `attributes` with each of `changed` in its place, or added. */
export const withChanged = (
  attributes: readonly Attribute[],
  changed: readonly Attribute[],
): Attribute[] => [...attributes.filter((a) => !changed.some((c) => c.key === a.key)), ...changed];
