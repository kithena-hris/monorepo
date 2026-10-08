import type { FilterField, FilterOperator } from '@reach/ui-native';

// display.tsx's, here so this module stays testable without React Native.
const longDate = (iso: string): string =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeZone: 'UTC' }).format(
    Date.parse(`${iso}T00:00:00Z`),
  );

/**
 * The Directory's conditions, as the web's (`directory.tsx`): which operators
 * People honours for each kind of field, and how a condition reads back.
 */
export interface Condition {
  readonly key: string;
  readonly op: string;
  readonly values: readonly string[];
}

/** A field the Directory may filter on, as People lists it. */
export interface DirectoryField {
  readonly key: string;
  readonly label: string;
  readonly kind: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
}

const EMPTY: FilterOperator[] = [
  { id: 'empty', label: 'is empty', value: 'none' },
  { id: 'not_empty', label: 'is not empty', value: 'none' },
];

const OPERATORS: Readonly<Record<string, readonly FilterOperator[]>> = {
  text: [
    { id: 'contains', label: 'contains', value: 'text' },
    { id: 'is', label: 'is exactly', value: 'text' },
    ...EMPTY,
  ],
  select: [
    { id: 'in', label: 'is any of', value: 'options' },
    { id: 'not_in', label: 'is none of', value: 'options' },
    ...EMPTY,
  ],
  status: [
    { id: 'in', label: 'is any of', value: 'options' },
    { id: 'not_in', label: 'is none of', value: 'options' },
  ],
  date: [
    { id: 'between', label: 'is between', value: 'date-range' },
    { id: 'before', label: 'is before', value: 'date' },
    { id: 'after', label: 'is after', value: 'date' },
    ...EMPTY,
  ],
  number: [
    { id: 'is', label: 'is', value: 'number' },
    { id: 'before', label: 'is less than', value: 'number' },
    { id: 'after', label: 'is more than', value: 'number' },
    ...EMPTY,
  ],
  person: EMPTY,
};

const operatorsOf = (kind: string | undefined): readonly FilterOperator[] =>
  OPERATORS[kind ?? 'text'] ?? OPERATORS['text'] ?? [];

/** People's fields as Reach's filter builder takes them. */
export const filterFields = (fields: readonly DirectoryField[]): FilterField[] =>
  fields.map((f) => ({
    id: f.key,
    label: f.label,
    operators: operatorsOf(f.kind),
    options: f.options,
  }));

/** "Department is any of Sales, Accounting": a condition as somebody reads it back. */
export function describeCondition(fields: readonly DirectoryField[], condition: Condition): string {
  const field = fields.find((f) => f.key === condition.key);
  const label = field?.label ?? condition.key;
  const op = operatorsOf(field?.kind).find((o) => o.id === condition.op)?.label ?? condition.op;
  const shown = (v: string): string =>
    field?.options.find((o) => o.value === v)?.label ??
    (field?.kind === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? longDate(v) : v);
  if (condition.op === 'empty' || condition.op === 'not_empty') return `${label} ${op}`;
  if (condition.op === 'between') {
    const [from = '', to = ''] = condition.values;
    if (from === '') return `${label} is on or before ${shown(to)}`;
    if (to === '') return `${label} is on or after ${shown(from)}`;
    return `${label} is between ${shown(from)} and ${shown(to)}`;
  }
  return `${label} ${op} ${condition.values.map(shown).join(', ')}`;
}
