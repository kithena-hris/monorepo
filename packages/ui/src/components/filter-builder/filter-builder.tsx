'use client';

import { Filter, FolderPlus, Plus, Trash2, X } from 'lucide-react';
import { useId, type JSX, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { Button } from '../button/button';
import type { DateRange } from '../calendar/calendar';
import { Combobox } from '../combobox/combobox';
import { DatePicker } from '../date-picker/date-picker';
import { EmptyState } from '../feedback/feedback';
import { Input } from '../input/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../select/select';
import { ToggleGroup, ToggleGroupItem } from '../toggle/toggle';
import {
  addCondition,
  addGroup,
  conditionsOf,
  removeItem,
  setMatch,
  updateCondition,
  type FilterCondition,
  type FilterField,
  type FilterGroup,
  type FilterValueKind,
} from './filter-model';

export { isConditionComplete } from './filter-model';
export type {
  FilterCondition,
  FilterField,
  FilterGroup,
  FilterOperator,
  FilterSubgroup,
  FilterValueKind,
} from './filter-model';

/**
 * Conditions, one per row: a field, an operator, a value.
 *
 * The rows read as a sentence — "Where Department is any of Engineering,
 * Research; and Start date is between 1 Jan and 31 Mar" — because that is
 * how somebody checks a filter they did not write, and `describeFilter()`
 * turns the value into that sentence.
 *
 * ### Presentational
 *
 * The application supplies the fields and, for each, the operators it will
 * honour and the options it may offer. The builder knows nothing of what a
 * field means and evaluates nothing. It holds no state either: `value` in,
 * `onChange` out, so the application decides whether a change applies at
 * once or waits for an Apply. The helpers in `filter-model.ts` are the only
 * way the value changes.
 *
 * ### Groups are the advanced mode
 *
 * With `allowGroups`, a group of conditions can sit inside the filter with its
 * own all-or-any, which is how "Engineering, and Berlin or Remote" is said. One
 * level only: past that nobody can read the filter back, and the plain-language
 * summary stops being plain.
 *
 * ### On its own, or in a panel
 *
 * With a `title` the builder is a card of its own, with a heading, the match
 * beside it and a Clear. Without one it is the bare rows, for a sheet or a
 * panel that already has a heading and its own Clear and Apply.
 *
 * ### Under a finger
 *
 * A row of three fields does not fit a phone, so each condition becomes a
 * small card with its parts stacked. Same controls, same order.
 */

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
  /** Lets people add a nested all-or-any group. */
  allowGroups?: boolean;
  /** A message per condition id, for a value the caller cannot use. */
  errors?: Readonly<Record<string, string>>;
  /** A heading, which makes the builder a card of its own with a Clear. */
  title?: ReactNode;
  /** What the builder is for, said when there is nothing in it yet. */
  emptyDescription?: ReactNode;
  /** The trailing action: typically "Show 48 people". */
  action?: ReactNode;
  className?: string;
}

export function FilterBuilder({
  fields,
  value,
  onChange,
  label = 'Conditions',
  maxConditions = 10,
  newId = () => crypto.randomUUID(),
  allowGroups = false,
  errors = {},
  title,
  emptyDescription = 'Add a condition to narrow the list.',
  action,
  className,
}: FilterBuilderProps): JSX.Element {
  const matchId = useId();
  const groups = value.groups ?? [];
  const count = conditionsOf(value).length;
  const full = count >= maxConditions;

  const blank = (): FilterCondition | undefined => {
    const field = fields[0];
    const operator = field?.operators[0];
    if (field === undefined || operator === undefined) return undefined;
    return { id: newId(), field: field.id, operator: operator.id, values: [] };
  };
  const add = (groupId: string | null): void => {
    const condition = blank();
    if (condition !== undefined) onChange(addCondition(value, groupId, condition));
  };
  const addNested = (): void => {
    const condition = blank();
    if (condition !== undefined) {
      onChange(addGroup(value, { id: newId(), match: 'any', conditions: [condition] }));
    }
  };

  if (count === 0) {
    return (
      <EmptyState
        className={cn('border-0 bg-surface shadow-sm', className)}
        icon={<Filter />}
        title="No conditions yet"
        description={emptyDescription}
        action={
          <Button
            size="sm"
            variant="secondary"
            startIcon={<Plus />}
            disabled={fields.length === 0}
            onClick={() => {
              add(null);
            }}
          >
            Add condition
          </Button>
        }
      />
    );
  }

  // One running number, so "Condition 3" names one row wherever it sits.
  let n = 0;
  const row = (condition: FilterCondition, index: number, match: FilterGroup['match']) => {
    n += 1;
    return (
      <ConditionRow
        key={condition.id}
        n={n}
        joiner={index === 0 ? 'Where' : match === 'all' ? 'and' : 'or'}
        fields={fields}
        condition={condition}
        error={errors[condition.id]}
        onChange={(patch) => {
          onChange(updateCondition(value, condition.id, patch, fields));
        }}
        onRemove={() => {
          onChange(removeItem(value, condition.id));
        }}
      />
    );
  };

  const items = value.conditions.length + groups.length;

  const list = (
    <ol aria-label={label} className="flex flex-col gap-2">
      {value.conditions.map((condition, index) => row(condition, index, value.match))}
      {groups.map((group, index) => (
        <li
          key={group.id}
          className="grid grid-cols-[4rem_minmax(0,1fr)] items-start gap-2 touch:flex touch:flex-col"
        >
          <JoinLabel
            joiner={
              value.conditions.length + index === 0 ? 'Where' : value.match === 'all' ? 'and' : 'or'
            }
          />
          <div
            role="group"
            aria-label={`Group, ${group.match} of these`}
            className="flex flex-col gap-2 rounded-md bg-surface-sunken p-3 touch:p-2.5"
          >
            <div className="flex flex-wrap items-center gap-2">
              <MatchToggle
                label="Match in this group"
                match={group.match}
                onChange={(match) => {
                  onChange(setMatch(value, group.id, match));
                }}
              />
              <span className="text-xs font-medium text-fg-muted">of these are true</span>
              <Button
                size="sm"
                variant="ghost"
                className="ms-auto"
                aria-label="Remove this group"
                startIcon={<Trash2 />}
                onClick={() => {
                  onChange(removeItem(value, group.id));
                }}
              />
            </div>
            <ol aria-label="Conditions in this group" className="flex flex-col gap-2">
              {group.conditions.map((condition, i) => row(condition, i, group.match))}
            </ol>
            <div>
              <Button
                size="sm"
                variant="ghost"
                startIcon={<Plus />}
                disabled={full}
                onClick={() => {
                  add(group.id);
                }}
              >
                Condition
              </Button>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );

  const footer = (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <Button
        size="sm"
        variant="secondary"
        startIcon={<Plus />}
        onClick={() => {
          add(null);
        }}
        disabled={full || fields.length === 0}
      >
        Add condition
      </Button>
      {allowGroups ? (
        <Button
          size="sm"
          variant="ghost"
          startIcon={<FolderPlus />}
          disabled={full || fields.length === 0}
          onClick={addNested}
        >
          Add group
        </Button>
      ) : null}
      {full ? (
        <span className="text-xs text-fg-muted">
          Up to {maxConditions} conditions. Remove one to add another.
        </span>
      ) : null}
      {action ? <div className="ms-auto">{action}</div> : null}
    </div>
  );

  const match =
    items < 2 ? null : (
      <MatchToggle
        label="Match"
        match={value.match}
        onChange={(next) => {
          onChange(setMatch(value, null, next));
        }}
        {...(title === undefined ? { labelledBy: matchId } : {})}
      />
    );

  if (title === undefined) {
    return (
      <div className={cn('flex flex-col gap-3', className)}>
        {match === null ? null : (
          <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
            <span id={matchId}>Match</span>
            {match}
          </div>
        )}
        {list}
        {footer}
      </div>
    );
  }

  return (
    <section
      aria-label={typeof title === 'string' ? title : 'Filters'}
      className={cn('flex flex-col gap-3 rounded-lg bg-surface p-5 shadow-sm touch:p-4', className)}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <h3 className="font-display text-md font-bold text-fg">{title}</h3>
        {match}
        <Button
          size="sm"
          variant="ghost"
          className="ms-auto"
          onClick={() => {
            onChange({ match: value.match, conditions: [] });
          }}
        >
          Clear
        </Button>
      </div>
      {list}
      {footer}
    </section>
  );
}

function MatchToggle({
  label,
  labelledBy,
  match,
  onChange,
}: {
  label: string;
  labelledBy?: string;
  match: FilterGroup['match'];
  onChange: (match: FilterGroup['match']) => void;
}): JSX.Element {
  return (
    <ToggleGroup
      type="single"
      {...(labelledBy === undefined ? { 'aria-label': label } : { 'aria-labelledby': labelledBy })}
      value={match}
      onValueChange={(next) => {
        // Radix clears a single toggle group when its value is pressed again;
        // a filter always matches one way or the other.
        if (next === 'all' || next === 'any') onChange(next);
      }}
    >
      <ToggleGroupItem size="sm" value="all">
        All
      </ToggleGroupItem>
      <ToggleGroupItem size="sm" value="any">
        Any
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

/** "Where" before the first item, then the group's "and" or "or". */
function JoinLabel({ joiner }: { joiner: string }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="text-end text-xs font-semibold text-fg-muted touch:text-start"
    >
      {joiner}
    </span>
  );
}

function ConditionRow({
  n,
  joiner,
  fields,
  condition,
  error,
  onChange,
  onRemove,
}: {
  n: number;
  joiner: string;
  fields: readonly FilterField[];
  condition: FilterCondition;
  error: string | undefined;
  onChange: (patch: Partial<Pick<FilterCondition, 'field' | 'operator' | 'values'>>) => void;
  onRemove: () => void;
}): JSX.Element {
  const errorId = useId();
  const field = fields.find((f) => f.id === condition.field);
  const operator = field?.operators.find((o) => o.id === condition.operator);
  const name = String(n);
  const fieldName = field?.label ?? 'field';
  const remove = `Remove condition ${name}, ${fieldName}`;

  return (
    <li
      className={cn(
        'grid grid-cols-[4rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_2rem] items-center gap-2',
        // A card per condition under a finger, the parts stacked.
        'touch:flex touch:flex-col touch:items-stretch touch:rounded-md touch:bg-surface-sunken touch:p-3',
      )}
    >
      <JoinLabel joiner={joiner} />

      <Select
        value={condition.field}
        onValueChange={(id) => {
          onChange({ field: id });
        }}
      >
        <SelectTrigger size="sm" aria-label={`Condition ${name} field`}>
          <SelectValue placeholder="Field" />
        </SelectTrigger>
        <SelectContent>
          {fields.map((f) => (
            <SelectItem key={f.id} value={f.id}>
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={condition.operator}
        onValueChange={(id) => {
          onChange({ operator: id });
        }}
      >
        <SelectTrigger size="sm" aria-label={`Condition ${name} operator`}>
          <SelectValue placeholder="Is" />
        </SelectTrigger>
        <SelectContent>
          {(field?.operators ?? []).map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="min-w-0 touch:flex touch:items-start touch:gap-1.5">
        <div className="min-w-0 flex-1">
          <ValueInput
            kind={operator?.value ?? 'none'}
            label={`Condition ${name} value for ${fieldName}`}
            options={field?.options ?? []}
            values={condition.values}
            onValues={(values) => {
              onChange({ values });
            }}
            {...(error === undefined ? {} : { errorId })}
          />
          {error === undefined ? null : (
            <p id={errorId} className="mt-1 text-xs text-danger-fg">
              {error}
            </p>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          aria-label={remove}
          startIcon={<X />}
          className="hidden touch:inline-flex"
          onClick={onRemove}
        />
      </div>

      <Button
        size="sm"
        variant="ghost"
        aria-label={remove}
        startIcon={<X />}
        className="touch:hidden"
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
  errorId,
}: {
  kind: FilterValueKind;
  label: string;
  options: readonly { value: string; label: string }[];
  values: readonly string[];
  onValues: (values: readonly string[]) => void;
  /** Set when the value has a message: it describes the control and marks it invalid. */
  errorId?: string;
}): JSX.Element | null {
  const first = values[0] ?? '';
  const invalid =
    errorId === undefined ? {} : { 'aria-invalid': true as const, 'aria-describedby': errorId };
  switch (kind) {
    case 'none':
      return null;
    case 'text':
    case 'number':
      return (
        <Input
          size="sm"
          aria-label={label}
          placeholder="Value"
          type={kind === 'number' ? 'number' : 'text'}
          {...(kind === 'number' ? { inputMode: 'decimal' as const } : {})}
          {...invalid}
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
          {...invalid}
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
          {...invalid}
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
          <SelectTrigger size="sm" aria-label={label} {...invalid}>
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
          {...invalid}
          value={values}
          onChange={(next) => {
            onValues(next === null ? [] : typeof next === 'string' ? [next] : next);
          }}
        />
      );
  }
}
