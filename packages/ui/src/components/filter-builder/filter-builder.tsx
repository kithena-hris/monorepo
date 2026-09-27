'use client';

import { Plus, X } from 'lucide-react';
import { useId, type JSX } from 'react';

import { cn } from '../../lib/cn';
import { Button } from '../button/button';
import type { DateRange } from '../calendar/calendar';
import { Combobox } from '../combobox/combobox';
import { DatePicker } from '../date-picker/date-picker';
import { Input } from '../input/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../select/select';
import { ToggleGroup, ToggleGroupItem } from '../toggle/toggle';

/**
 * Conditions, one per row: a field, an operator, a value.
 *
 * The rows read as a sentence — "Where Department is any of Engineering,
 * Research; and Start date is between 1 Jan and 31 Mar" — because that is
 * how somebody checks a filter they did not write. All or any, never a tree:
 * nested groups are the point at which a filter stops being checkable by
 * reading it, and every real directory question fits in one level.
 *
 * ### Presentational
 *
 * The application supplies the fields and, for each, the operators it will
 * honour and the options it may offer. The builder knows nothing of what a
 * field means and evaluates nothing. It holds no state either: `value` in,
 * `onChange` out, so the application decides whether a change applies at
 * once or waits for an Apply.
 *
 * ### Values are strings
 *
 * A text, a number, an ISO date, an option key: the canonical form, never the
 * rendered label, so a relabelled option does not silently break a saved
 * filter. A range is two strings, either of which may be empty for "on or
 * after" and "on or before".
 */

/** What an operator asks for after it. */
export type FilterValueKind =
  /** Nothing: "is empty", "has missing information". */
  | 'none'
  | 'text'
  | 'number'
  | 'date'
  /** Two dates, either open. */
  | 'date-range'
  /** One of the field's options. */
  | 'option'
  /** Any of the field's options. */
  | 'options';

export interface FilterOperator {
  id: string;
  label: string;
  value: FilterValueKind;
}

export interface FilterField {
  id: string;
  label: string;
  /** In the order to offer them. The first is the default. */
  operators: readonly FilterOperator[];
  /** For `option` and `options` operators. */
  options?: readonly { value: string; label: string }[];
}

export interface FilterCondition {
  id: string;
  field: string;
  operator: string;
  /** `[text]`, `[number]`, `[date]`, `[from, to]` or the chosen option keys. */
  values: readonly string[];
}

export interface FilterGroup {
  match: 'all' | 'any';
  conditions: readonly FilterCondition[];
}

export interface FilterBuilderProps {
  fields: readonly FilterField[];
  value: FilterGroup;
  onChange: (value: FilterGroup) => void;
  /** Names the list for assistive tech. */
  label?: string;
  /** Past this, Add is disabled and says why. */
  maxConditions?: number;
  /** A fresh condition id. Defaults to `crypto.randomUUID`. */
  newId?: () => string;
  className?: string;
}

const kindOf = (fields: readonly FilterField[], c: FilterCondition): FilterValueKind | undefined =>
  fields.find((f) => f.id === c.field)?.operators.find((o) => o.id === c.operator)?.value;

/** Whether a condition says enough to apply: an operator that needs a value has one. */
export function isConditionComplete(
  fields: readonly FilterField[],
  condition: FilterCondition,
): boolean {
  const kind = kindOf(fields, condition);
  if (kind === undefined) return false;
  if (kind === 'none') return true;
  if (kind === 'date-range') return condition.values.some((v) => v !== '');
  return condition.values.length > 0 && condition.values.every((v) => v.trim() !== '');
}

export function FilterBuilder({
  fields,
  value,
  onChange,
  label = 'Conditions',
  maxConditions = 10,
  newId = () => crypto.randomUUID(),
  className,
}: FilterBuilderProps): JSX.Element {
  const matchId = useId();
  const { conditions } = value;
  const full = conditions.length >= maxConditions;

  const set = (next: readonly FilterCondition[]): void => {
    onChange({ ...value, conditions: next });
  };
  const replace = (id: string, patch: Partial<FilterCondition>): void => {
    set(conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };
  const add = (): void => {
    const field = fields[0];
    const operator = field?.operators[0];
    if (field === undefined || operator === undefined) return;
    set([...conditions, { id: newId(), field: field.id, operator: operator.id, values: [] }]);
  };

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {conditions.length < 2 ? null : (
        <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
          <span id={matchId}>Match</span>
          <ToggleGroup
            type="single"
            aria-labelledby={matchId}
            value={value.match}
            onValueChange={(match) => {
              if (match === 'all' || match === 'any') onChange({ ...value, match });
            }}
          >
            <ToggleGroupItem value="all" size="sm">
              All conditions
            </ToggleGroupItem>
            <ToggleGroupItem value="any" size="sm">
              Any condition
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      )}

      {conditions.length === 0 ? (
        <p className="text-sm text-fg-muted">No conditions yet. Add one to narrow the list.</p>
      ) : (
        <ol aria-label={label} className="flex flex-col gap-2">
          {conditions.map((condition, index) => (
            <ConditionRow
              key={condition.id}
              index={index}
              joiner={index === 0 ? 'Where' : value.match === 'all' ? 'and' : 'or'}
              fields={fields}
              condition={condition}
              onField={(fieldId) => {
                const field = fields.find((f) => f.id === fieldId);
                const operator = field?.operators[0];
                if (field === undefined || operator === undefined) return;
                replace(condition.id, { field: field.id, operator: operator.id, values: [] });
              }}
              onOperator={(operatorId) => {
                const before = kindOf(fields, condition);
                const after = fields
                  .find((f) => f.id === condition.field)
                  ?.operators.find((o) => o.id === operatorId)?.value;
                replace(condition.id, {
                  operator: operatorId,
                  ...(before === after ? {} : { values: [] }),
                });
              }}
              onValues={(values) => {
                replace(condition.id, { values });
              }}
              onRemove={() => {
                set(conditions.filter((c) => c.id !== condition.id));
              }}
            />
          ))}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" startIcon={<Plus />} onClick={add} disabled={full || fields.length === 0}>
          Add condition
        </Button>
        {full ? (
          <span className="text-xs text-fg-muted">
            Up to {maxConditions} conditions. Remove one to add another.
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ConditionRow({
  index,
  joiner,
  fields,
  condition,
  onField,
  onOperator,
  onValues,
  onRemove,
}: {
  index: number;
  joiner: string;
  fields: readonly FilterField[];
  condition: FilterCondition;
  onField: (field: string) => void;
  onOperator: (operator: string) => void;
  onValues: (values: readonly string[]) => void;
  onRemove: () => void;
}): JSX.Element {
  const field = fields.find((f) => f.id === condition.field);
  const operator = field?.operators.find((o) => o.id === condition.operator);
  const n = String(index + 1);
  const fieldName = field?.label ?? 'field';

  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="w-12 shrink-0 text-sm text-fg-muted" aria-hidden="true">
        {joiner}
      </span>
      <Select value={condition.field} onValueChange={onField}>
        <SelectTrigger size="sm" aria-label={`Condition ${n} field`} className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {fields.map((f) => (
            <SelectItem key={f.id} value={f.id}>
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={condition.operator} onValueChange={onOperator}>
        <SelectTrigger size="sm" aria-label={`Condition ${n} operator`} className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(field?.operators ?? []).map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="min-w-44 flex-1">
        <ValueInput
          kind={operator?.value ?? 'none'}
          label={`Condition ${n} value for ${fieldName}`}
          options={field?.options ?? []}
          values={condition.values}
          onValues={onValues}
        />
      </div>
      <Button
        size="sm"
        variant="ghost"
        startIcon={<X />}
        aria-label={`Remove condition ${n}, ${fieldName}`}
        onClick={onRemove}
      />
    </li>
  );
}

function ValueInput({
  kind,
  label,
  options,
  values,
  onValues,
}: {
  kind: FilterValueKind;
  label: string;
  options: readonly { value: string; label: string }[];
  values: readonly string[];
  onValues: (values: readonly string[]) => void;
}): JSX.Element | null {
  const first = values[0] ?? '';
  switch (kind) {
    case 'none':
      return null;
    case 'text':
    case 'number':
      return (
        <Input
          size="sm"
          aria-label={label}
          type={kind === 'number' ? 'number' : 'text'}
          {...(kind === 'number' ? { inputMode: 'decimal' as const } : {})}
          value={first}
          onChange={(event) => {
            onValues([event.target.value]);
          }}
        />
      );
    case 'date':
      return (
        <DatePicker
          size="sm"
          label={label}
          value={first === '' ? null : first}
          onChange={(date) => {
            onValues(date === null ? [] : [date]);
          }}
        />
      );
    case 'date-range': {
      const range: DateRange | null =
        values.length === 0 ? null : { start: values[0] || null, end: values[1] || null };
      return (
        <DatePicker
          size="sm"
          mode="range"
          label={label}
          placeholder="Pick a period"
          value={range}
          onChange={(next) => {
            onValues([next.start ?? '', next.end ?? '']);
          }}
        />
      );
    }
    case 'option':
      return (
        <Select
          value={first}
          onValueChange={(v) => {
            onValues([v]);
          }}
        >
          <SelectTrigger size="sm" aria-label={label}>
            <SelectValue placeholder="Choose one" />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case 'options':
      return (
        <Combobox
          size="sm"
          multiple
          label={label}
          placeholder="Choose any"
          options={options}
          value={values}
          onChange={(next) => {
            onValues(next === null ? [] : typeof next === 'string' ? [next] : next);
          }}
        />
      );
  }
}
