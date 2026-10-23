import {
  Button,
  Combobox,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  icons,
} from '@reach/ui';
import type { JSX } from 'react';

import type {
  Choice,
  Classification,
  ListOperand,
  Predicate,
  PredicateClause,
  RegistryDraft,
} from './model';
import { FACT_VALUES, OPERAND_LABEL } from './words';
import { t } from '../i18n';

const { add: Plus, delete: Trash } = icons;

/** The contract's bound: ten clauses at most. */
const MOST = 10;
const OPERANDS = [
  'country',
  'legalEntity',
  'employmentType',
  'workModel',
  'status',
  'attribute',
] as const;

/** Another field a clause may name, and its options when it has them. */
export interface PredicateField {
  readonly key: string;
  readonly label: string;
  readonly options: readonly string[];
  /** Special-category data never decides requiredness (PEO-065). */
  readonly classification?: Classification;
}

/**
 * The key a choice's option is stored under — `keyFrom` in People's
 * `application/screens/schema.ts`, which made it. A rule compares against
 * this, never against the label somebody may rename.
 */
export function optionKey(label: string): string {
  const key = label
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '_')
    .replaceAll(/^_+|_+$/gu, '')
    .slice(0, 60);
  return /^[a-z]/u.test(key) ? key : `f_${key}`.slice(0, 60);
}

export const EMPTY_PREDICATE: Predicate = {
  combine: 'all',
  clauses: [{ operand: 'country', in: [] }],
};

/**
 * What stops a predicate being saved, or null when it may be. The contract
 * refuses the same things; saying so here puts the sentence beside the row.
 */
export function predicateProblem(predicate: Predicate): string | null {
  if (predicate.clauses.length === 0)
    return t('settings.predicate-editor.add_at_least_one_condition', 'Add at least one condition.');
  for (const clause of predicate.clauses) {
    if (clause.operand !== 'attribute') {
      if (clause.in.length === 0)
        return t(
          'settings.predicate-editor.every_condition_needs_at_least_one',
          'Every condition needs at least one value.',
        );
    } else if (clause.key === '') {
      return t(
        'settings.predicate-editor.choose_the_field_a_condition_reads',
        'Choose the field a condition reads.',
      );
    } else if (clause.is === 'equals' && (clause.equals ?? '').trim() === '') {
      return t(
        'settings.predicate-editor.say_what_the_field_has_to',
        'Say what the field has to equal.',
      );
    }
  }
  return null;
}

function fresh(operand: ListOperand | 'attribute'): PredicateClause {
  return operand === 'attribute'
    ? { operand, key: '', is: 'set', equals: null }
    : { operand, in: [] };
}

export interface PredicateEditorProps {
  /** Names the group: "Required when", "Also visible when". */
  readonly legend: string;
  readonly value: Predicate;
  readonly onChange: (next: Predicate) => void;
  readonly choices: RegistryDraft['choices'];
  /** The fields a clause may name — never the one being edited. */
  readonly fields: readonly PredicateField[];
}

/**
 * The closed predicate, as rows (PEO-065, PEO-066; PRD §6.5).
 *
 * One row per condition: which fact, then the values it may hold — or another
 * field being filled in or equal to something. Combined all-or-any, flat, ten
 * at most. The grammar is closed on purpose, so the editor offers exactly what
 * it can say and nothing a tenant could write a loop in.
 */
export function PredicateEditor({
  legend,
  value,
  onChange,
  choices,
  fields,
}: PredicateEditorProps): JSX.Element {
  const listed = (operand: ListOperand): readonly Choice[] =>
    ({
      legalEntity: choices.legalEntities,
      country: choices.countries,
      employmentType: choices.employmentTypes,
      workModel: choices.workModels,
      status: FACT_VALUES.status,
    })[operand];
  const set = (index: number, clause: PredicateClause): void => {
    onChange({ ...value, clauses: value.clauses.map((c, i) => (i === index ? clause : c)) });
  };

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      {value.clauses.length > 1 ? (
        <Select
          value={value.combine}
          onValueChange={(combine) => {
            onChange({ ...value, combine: combine as Predicate['combine'] });
          }}
        >
          <SelectTrigger
            aria-label={t(
              'settings.predicate-editor.how_the_conditions_combine',
              '{{legend}}: how the conditions combine',
              { legend },
            )}
            size="sm"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {t('settings.predicate-editor.all_of_these_hold', 'All of these hold')}
            </SelectItem>
            <SelectItem value="any">
              {t('settings.predicate-editor.any_of_these_holds', 'Any of these holds')}
            </SelectItem>
          </SelectContent>
        </Select>
      ) : null}

      {value.clauses.map((clause, index) => {
        const n = t('settings.predicate-editor.condition', '{{legend}}, condition {{value}}', {
          legend,
          value: String(index + 1),
        });
        const named =
          clause.operand === 'attribute' ? fields.find((f) => f.key === clause.key) : undefined;
        return (
          // Positional: a condition has no identity beyond its place in the list.
          <Stack key={index} gap={2}>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={clause.operand}
                onValueChange={(operand) => {
                  set(index, fresh(operand as ListOperand | 'attribute'));
                }}
              >
                <SelectTrigger
                  aria-label={t('settings.predicate-editor.what_it_reads', '{{n}}: what it reads', {
                    n,
                  })}
                  size="sm"
                  className="w-auto min-w-40"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPERANDS.map((operand) => (
                    <SelectItem key={operand} value={operand}>
                      {OPERAND_LABEL[operand]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="sm"
                startIcon={<Trash aria-hidden="true" />}
                aria-label={t('settings.predicate-editor.remove', 'Remove {{n}}', { n })}
                disabled={value.clauses.length === 1}
                onClick={() => {
                  onChange({ ...value, clauses: value.clauses.filter((_, i) => i !== index) });
                }}
              />
            </div>

            {clause.operand === 'attribute' ? (
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={clause.key}
                  onValueChange={(key) => {
                    set(index, { ...clause, key, equals: clause.is === 'equals' ? '' : null });
                  }}
                >
                  <SelectTrigger
                    aria-label={t('settings.predicate-editor.which_field', '{{n}}: which field', {
                      n,
                    })}
                    size="sm"
                    className="w-auto min-w-40"
                  >
                    <SelectValue
                      placeholder={t('settings.predicate-editor.choose_a_field', 'Choose a field')}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {fields.map((f) => (
                      <SelectItem key={f.key} value={f.key}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={clause.is}
                  onValueChange={(is) => {
                    set(index, {
                      ...clause,
                      is: is as 'set' | 'equals',
                      equals: is === 'equals' ? '' : null,
                    });
                  }}
                >
                  <SelectTrigger
                    aria-label={t(
                      'settings.predicate-editor.how_it_is_compared',
                      '{{n}}: how it is compared',
                      { n },
                    )}
                    size="sm"
                    className="w-auto"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="set">
                      {t('settings.predicate-editor.is_filled_in', 'is filled in')}
                    </SelectItem>
                    <SelectItem value="equals">
                      {t('settings.predicate-editor.equals', 'equals')}
                    </SelectItem>
                  </SelectContent>
                </Select>
                {clause.is !== 'equals' ? null : named !== undefined && named.options.length > 0 ? (
                  <Select
                    value={clause.equals ?? ''}
                    onValueChange={(equals) => {
                      set(index, { ...clause, equals });
                    }}
                  >
                    <SelectTrigger
                      aria-label={t('settings.predicate-editor.the_value', '{{n}}: the value', {
                        n,
                      })}
                      size="sm"
                      className="w-auto min-w-32"
                    >
                      <SelectValue placeholder={t('settings.predicate-editor.choose', 'Choose')} />
                    </SelectTrigger>
                    <SelectContent>
                      {named.options.map((option) => (
                        <SelectItem key={option} value={optionKey(option)}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    aria-label={t('settings.predicate-editor.the_value', '{{n}}: the value', { n })}
                    className="w-40"
                    maxLength={200}
                    value={clause.equals ?? ''}
                    onChange={(e) => {
                      set(index, { ...clause, equals: e.target.value });
                    }}
                  />
                )}
              </div>
            ) : (
              <Combobox
                label={t('settings.predicate-editor.is_one_of', '{{n}}: is one of', { n })}
                multiple
                size="sm"
                placeholder={t('settings.predicate-editor.choose_values', 'Choose values')}
                options={listed(clause.operand)}
                value={clause.in}
                onChange={(next) => {
                  set(index, {
                    ...clause,
                    in: Array.isArray(next) ? next : typeof next === 'string' ? [next] : [],
                  });
                }}
              />
            )}
          </Stack>
        );
      })}

      {value.clauses.length < MOST ? (
        <div>
          <Button
            size="sm"
            startIcon={<Plus aria-hidden="true" />}
            onClick={() => {
              onChange({ ...value, clauses: [...value.clauses, fresh('country')] });
            }}
          >
            {t('settings.predicate-editor.add_a_condition', 'Add a condition')}
          </Button>
        </div>
      ) : null}
    </fieldset>
  );
}
