'use client';

import { Filter, FolderPlus, Plus, Trash2, X } from 'lucide-react';
import { useId, useRef, type JSX, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { Button } from '../button/button';
import { EmptyState } from '../feedback/feedback';
import { Input } from '../input/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../select/select';
import { ToggleGroup, ToggleGroupItem } from '../toggle/toggle';
import {
  addItem,
  removeItem,
  setMatch,
  updateCondition,
  type FilterCondition,
  type FilterField,
  type FilterGroup,
} from './filter-model';

/**
 * Build a filter out of conditions: a field, an operator and a value, joined
 * by "and" or "or".
 *
 * Controlled, and the value is plain data (`FilterGroup`), so a saved view is
 * that object stored and handed back. The helpers in `filter-model.ts` are the
 * only way it changes, and `describeFilter()` turns it into the sentence people
 * actually read to check it.
 *
 * ### Groups are the advanced mode
 *
 * With `allowGroups`, a group of conditions can sit inside the filter with its
 * own all-or-any, which is how "Engineering, and Berlin or Remote" is said. One
 * level only: past that nobody can read the filter back, and the plain-language
 * summary stops being plain.
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
  /** Lets people add a nested all-or-any group. */
  allowGroups?: boolean;
  /** A message per condition id, for a value the caller cannot use. */
  errors?: Readonly<Record<string, string>>;
  /** Heading over the builder. */
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
  allowGroups = false,
  errors = {},
  title = 'Filters',
  emptyDescription,
  action,
  className,
}: FilterBuilderProps): JSX.Element {
  const base = useId();
  const next = useRef(0);
  const newId = (): string => `${base}-${String((next.current += 1))}`;

  const blank = (): FilterCondition => {
    const field = fields[0];
    return {
      kind: 'condition',
      id: newId(),
      field: field?.id ?? '',
      operator: field?.operators[0]?.id ?? '',
      value: '',
    };
  };
  const addCondition = (groupId: string): void => {
    onChange(addItem(value, groupId, blank()));
  };
  const addGroup = (): void => {
    onChange(
      addItem(value, value.id, { kind: 'group', id: newId(), match: 'any', items: [blank()] }),
    );
  };

  if (value.items.length === 0) {
    return (
      <EmptyState
        className={cn('border-0 bg-surface shadow-sm', className)}
        icon={<Filter />}
        title="No filters yet"
        description={emptyDescription}
        action={
          <Button
            size="sm"
            variant="secondary"
            startIcon={<Plus />}
            onClick={() => {
              addCondition(value.id);
            }}
          >
            Add condition
          </Button>
        }
      />
    );
  }

  const renderGroup = (group: FilterGroup, nested: boolean): JSX.Element => (
    <div
      role="group"
      aria-label={nested ? `Group, ${group.match === 'all' ? 'all' : 'any'} of these` : undefined}
      className={cn(
        'flex flex-col gap-2',
        nested && 'rounded-md bg-surface-sunken p-3 touch:p-2.5',
      )}
    >
      {nested ? (
        <div className="flex flex-wrap items-center gap-2">
          <MatchToggle
            group={group}
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
      ) : null}

      {group.items.map((item, index) =>
        item.kind === 'group' ? (
          <div
            key={item.id}
            className="grid grid-cols-[4rem_minmax(0,1fr)] items-start gap-2 touch:flex touch:flex-col"
          >
            <JoinLabel index={index} match={group.match} />
            {renderGroup(item, true)}
          </div>
        ) : (
          <ConditionRow
            key={item.id}
            condition={item}
            index={index}
            match={group.match}
            fields={fields}
            error={errors[item.id]}
            onChange={(patch) => {
              onChange(updateCondition(value, item.id, patch, fields));
            }}
            onRemove={() => {
              onChange(removeItem(value, item.id));
            }}
          />
        ),
      )}

      {nested ? (
        <div>
          <Button
            size="sm"
            variant="ghost"
            startIcon={<Plus />}
            onClick={() => {
              addCondition(group.id);
            }}
          >
            Condition
          </Button>
        </div>
      ) : null}
    </div>
  );

  return (
    <section
      aria-label={typeof title === 'string' ? title : 'Filters'}
      className={cn('flex flex-col gap-3 rounded-lg bg-surface p-5 shadow-sm touch:p-4', className)}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <h3 className="font-display text-md font-bold text-fg">{title}</h3>
        {value.items.length > 1 ? (
          <MatchToggle
            group={value}
            onChange={(match) => {
              onChange(setMatch(value, value.id, match));
            }}
          />
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          className="ms-auto"
          onClick={() => {
            onChange({ ...value, items: [] });
          }}
        >
          Clear
        </Button>
      </div>

      {renderGroup(value, false)}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          size="sm"
          variant="secondary"
          startIcon={<Plus />}
          onClick={() => {
            addCondition(value.id);
          }}
        >
          Add condition
        </Button>
        {allowGroups ? (
          <Button size="sm" variant="ghost" startIcon={<FolderPlus />} onClick={addGroup}>
            Add group
          </Button>
        ) : null}
        {action ? <div className="ms-auto">{action}</div> : null}
      </div>
    </section>
  );
}

function MatchToggle({
  group,
  onChange,
}: {
  group: FilterGroup;
  onChange: (match: FilterGroup['match']) => void;
}): JSX.Element {
  return (
    <ToggleGroup
      type="single"
      aria-label="Match"
      value={group.match}
      onValueChange={(match) => {
        // Radix clears a single toggle group when its value is pressed again;
        // a filter always matches one way or the other.
        if (match === 'all' || match === 'any') onChange(match);
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
function JoinLabel({ index, match }: { index: number; match: FilterGroup['match'] }): JSX.Element {
  return (
    <span className="text-end text-xs font-semibold text-fg-muted touch:text-start">
      {index === 0 ? 'Where' : match === 'all' ? 'and' : 'or'}
    </span>
  );
}

function ConditionRow({
  condition,
  index,
  match,
  fields,
  error,
  onChange,
  onRemove,
}: {
  condition: FilterCondition;
  index: number;
  match: FilterGroup['match'];
  fields: readonly FilterField[];
  error: string | undefined;
  onChange: (patch: Partial<Pick<FilterCondition, 'field' | 'operator' | 'value'>>) => void;
  onRemove: () => void;
}): JSX.Element {
  const errorId = useId();
  const field = fields.find((entry) => entry.id === condition.field);
  const name = `condition ${String(index + 1)}`;

  return (
    <div
      role="group"
      aria-label={`Condition ${String(index + 1)}`}
      className={cn(
        'grid grid-cols-[4rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_2rem] items-center gap-2',
        // A card per condition under a finger, the parts stacked.
        'touch:flex touch:flex-col touch:items-stretch touch:rounded-md touch:bg-surface-sunken touch:p-3',
      )}
    >
      <JoinLabel index={index} match={match} />

      <Select
        value={condition.field}
        onValueChange={(id) => {
          onChange({ field: id });
        }}
      >
        <SelectTrigger size="sm" aria-label={`Field for ${name}`}>
          <SelectValue placeholder="Field" />
        </SelectTrigger>
        <SelectContent>
          {fields.map((entry) => (
            <SelectItem key={entry.id} value={entry.id}>
              {entry.label}
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
        <SelectTrigger size="sm" aria-label={`Operator for ${name}`}>
          <SelectValue placeholder="Is" />
        </SelectTrigger>
        <SelectContent>
          {(field?.operators ?? []).map((operator) => (
            <SelectItem key={operator.id} value={operator.id}>
              {operator.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="min-w-0 touch:flex touch:items-start touch:gap-1.5">
        <div className="min-w-0 flex-1">
          {field?.options ? (
            <Select
              value={condition.value}
              onValueChange={(next) => {
                onChange({ value: next });
              }}
            >
              <SelectTrigger
                size="sm"
                aria-label={`Value for ${name}`}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
              >
                <SelectValue placeholder="Value" />
              </SelectTrigger>
              <SelectContent>
                {field.options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              size="sm"
              type={field?.inputType ?? 'text'}
              placeholder="Value"
              aria-label={`Value for ${name}`}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              value={condition.value}
              onChange={(event) => {
                onChange({ value: event.target.value });
              }}
            />
          )}
          {error ? (
            <p id={errorId} className="mt-1 text-xs text-danger-fg">
              {error}
            </p>
          ) : null}
        </div>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Remove ${name}`}
          startIcon={<X />}
          className="hidden touch:inline-flex"
          onClick={onRemove}
        />
      </div>

      <Button
        size="sm"
        variant="ghost"
        aria-label={`Remove ${name}`}
        startIcon={<X />}
        className="touch:hidden"
        onClick={onRemove}
      />
    </div>
  );
}
