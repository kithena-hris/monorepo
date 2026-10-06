import { Filter, Plus, Trash2 } from 'lucide-react-native';
import { Fragment, type ReactNode } from 'react';
import { Text as CssText, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { Button } from '../button/button.tsx';
import { Card } from '../card/card.tsx';
import { Chip } from '../chip/chip.tsx';
import { EmptyState } from '../feedback/feedback.tsx';
import { Icon } from '../icon/icon.tsx';
import { Input } from '../input/input.tsx';
import {
  SegmentedControl,
  SegmentedControlItem,
} from '../segmented-control/segmented-control.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../select/select.tsx';
import { Text } from '../text/text.tsx';

/**
 * Filters built out of conditions, as the web's `FilterBuilder`: each a
 * field, an operator and a value, joined by "all" or "any". On a phone each
 * condition is a small stacked card (field, operator, then the value beside
 * its remove button) rather than a row of four.
 *
 * The model is the web's (`FilterField`, `FilterCondition`, `FilterGroup`),
 * restated here because `packages/ui` is DOM code a phone cannot import.
 */

export type FilterValueKind = 'none' | 'text' | 'number' | 'date' | 'option';

export type FilterOperator = { id: string; label: string; value: FilterValueKind };

export type FilterField = {
  id: string;
  label: string;
  /** In the order to offer them. The first is the default. */
  operators: readonly FilterOperator[];
  /** For `option` operators. */
  options?: readonly { value: string; label: string }[];
};

export type FilterCondition = {
  id: string;
  field: string;
  operator: string;
  values: readonly string[];
};

export type FilterSubgroup = {
  id: string;
  match: 'all' | 'any';
  conditions: readonly FilterCondition[];
};

export type FilterGroup = {
  match: 'all' | 'any';
  conditions: readonly FilterCondition[];
  /** Joined to the conditions by the same `match`, one level deep. */
  groups?: readonly FilterSubgroup[];
};

/** A condition in words: "Location is Berlin". */
export function describeCondition(
  fields: readonly FilterField[],
  condition: FilterCondition,
): string {
  const field = fields.find((f) => f.id === condition.field);
  const operator = field?.operators.find((o) => o.id === condition.operator);
  const values = condition.values.map(
    (v) => field?.options?.find((o) => o.value === v)?.label ?? v,
  );
  return [field?.label ?? condition.field, operator?.label ?? condition.operator, ...values]
    .filter(Boolean)
    .join(' ');
}

/**
 * The whole filter as a sentence people actually read: "Team is Engineering
 * and Contract is Permanent and (Location is Berlin or Location is Remote)".
 */
export function describeFilters(fields: readonly FilterField[], group: FilterGroup): string {
  const join = group.match === 'all' ? ' and ' : ' or ';
  const parts = [
    ...group.conditions.map((c) => describeCondition(fields, c)),
    ...(group.groups ?? []).map(
      (g) =>
        `(${g.conditions.map((c) => describeCondition(fields, c)).join(g.match === 'all' ? ' and ' : ' or ')})`,
    ),
  ];
  return parts.join(join);
}

export type FilterBuilderProps = {
  fields: readonly FilterField[];
  value: FilterGroup;
  onChange: (value: FilterGroup) => void;
  /** Problems by condition id: an empty value where one is needed. */
  errors?: Readonly<Record<string, string>>;
  /** Offers "All" and "Any" above the conditions. */
  matchControl?: boolean;
  /** The apply button's words, with the count it would show: "Show 48 people". */
  applyLabel?: string;
  onApply?: () => void;
  /** Under "No filters yet": what narrowing will do. */
  emptyDescription?: string;
  /** A new condition's id. */
  newId?: () => string;
  className?: string | undefined;
};

let next = 0;
const defaultId = (): string => {
  next += 1;
  return `condition-${String(next)}`;
};

export function FilterBuilder({
  fields,
  value,
  onChange,
  errors = {},
  matchControl = false,
  applyLabel = 'Apply',
  onApply,
  emptyDescription,
  newId = defaultId,
  className,
}: FilterBuilderProps): React.JSX.Element {
  const add = (): void => {
    const field = fields[0];
    if (!field) return;
    onChange({
      ...value,
      conditions: [
        ...value.conditions,
        { id: newId(), field: field.id, operator: field.operators[0]?.id ?? '', values: [] },
      ],
    });
  };
  const update = (id: string, patch: Partial<FilterCondition>): void => {
    onChange({
      ...value,
      conditions: value.conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
  };
  const remove = (id: string): void => {
    onChange({ ...value, conditions: value.conditions.filter((c) => c.id !== id) });
  };
  const addButton = (
    <Button variant="secondary" size="sm" startIcon={<Icon icon={Plus} />} onPress={add}>
      Add condition
    </Button>
  );

  if (value.conditions.length === 0) {
    return (
      <Card className={className}>
        <EmptyState
          icon={Filter}
          title="No filters yet"
          {...(emptyDescription ? { description: emptyDescription } : {})}
          action={addButton}
          className="py-2.5"
        />
      </Card>
    );
  }

  return (
    <Card className={cn('gap-2.5', className)}>
      <View className="flex-row items-center gap-2.5">
        <Text variant="title3" weight="bold" className="text-[18px]">
          Filters
        </Text>
        {matchControl ? (
          <SegmentedControl
            size="sm"
            value={value.match}
            onValueChange={(match) => {
              onChange({ ...value, match: match === 'any' ? 'any' : 'all' });
            }}
            accessibilityLabel="Match"
          >
            <SegmentedControlItem value="all">All</SegmentedControlItem>
            <SegmentedControlItem value="any">Any</SegmentedControlItem>
          </SegmentedControl>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onPress={() => {
            onChange({ ...value, conditions: [], groups: [] });
          }}
        >
          Clear
        </Button>
      </View>
      {value.conditions.map((condition, i) => (
        <Fragment key={condition.id}>
          <ConditionCard
            n={i + 1}
            joiner={i === 0 ? undefined : value.match === 'all' ? 'and' : 'or'}
            fields={fields}
            condition={condition}
            error={errors[condition.id]}
            onChange={(patch) => {
              update(condition.id, patch);
            }}
            onRemove={() => {
              remove(condition.id);
            }}
          />
        </Fragment>
      ))}
      <View className="flex-row items-center gap-2">
        {addButton}
        <Button
          variant="primary"
          size="sm"
          className="ml-auto"
          {...(onApply ? { onPress: onApply } : {})}
        >
          {applyLabel}
        </Button>
      </View>
    </Card>
  );
}

function ConditionCard({
  n,
  joiner,
  fields,
  condition,
  error,
  onChange,
  onRemove,
}: {
  n: number;
  joiner: string | undefined;
  fields: readonly FilterField[];
  condition: FilterCondition;
  error: string | undefined;
  onChange: (patch: Partial<FilterCondition>) => void;
  onRemove: () => void;
}): React.JSX.Element {
  const field = fields.find((f) => f.id === condition.field);
  const operator = field?.operators.find((o) => o.id === condition.operator);
  const kind = operator?.value ?? 'none';
  const said = `Condition ${String(n)}`;
  return (
    <View
      role="group"
      aria-label={said}
      className="gap-2 rounded-[16px] bg-surface-sunken p-3"
    >
      {joiner ? (
        <CssText className="text-[12px] leading-none font-semibold text-fg-muted">{joiner}</CssText>
      ) : null}
      <Choice
        label={`${said}, field`}
        value={condition.field}
        options={fields.map((f) => ({ value: f.id, label: f.label }))}
        onChange={(id) => {
          const chosen = fields.find((f) => f.id === id);
          onChange({ field: id, operator: chosen?.operators[0]?.id ?? '', values: [] });
        }}
      />
      <Choice
        label={`${said}, operator`}
        value={condition.operator}
        options={(field?.operators ?? []).map((o) => ({ value: o.id, label: o.label }))}
        onChange={(id) => {
          onChange({ operator: id });
        }}
      />
      <View className="flex-row items-center gap-1.5">
        <View className="flex-1">
          {kind === 'option' ? (
            <Choice
              label={`${said}, value`}
              value={condition.values[0] ?? ''}
              placeholder="Value"
              options={field?.options ?? []}
              invalid={error !== undefined}
              onChange={(v) => {
                onChange({ values: [v] });
              }}
            />
          ) : kind === 'none' ? null : (
            <Input
              size="sm"
              value={condition.values[0] ?? ''}
              placeholder="Value"
              accessibilityLabel={`${said}, value`}
              invalid={error !== undefined}
              {...(kind === 'number' ? { keyboardType: 'decimal-pad' as const } : {})}
              onChangeText={(text: string) => {
                onChange({ values: [text] });
              }}
            />
          )}
        </View>
        <Button
          variant="ghost"
          size="sm"
          startIcon={<Icon icon={Trash2} />}
          accessibilityLabel={`Remove condition ${String(n)}`}
          onPress={onRemove}
        />
      </View>
      {error ? (
        <Text variant="footnote" tone="danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** A field, an operator or an option value: lane A's Select, as a centred list. */
function Choice({
  label,
  value,
  options,
  onChange,
  placeholder,
  invalid = false,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  placeholder?: string;
  invalid?: boolean;
}): React.JSX.Element {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" accessibilityLabel={label} invalid={invalid}>
        <SelectValue {...(placeholder ? { placeholder } : {})} />
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
}

/** An applied filter, as a chip shows it: "Team" muted, then "Engineering". */
export type AppliedFilter = { id: string; field: string; label: string };

export type AppliedFiltersProps = {
  filters: readonly AppliedFilter[];
  onRemove: (id: string) => void;
  /** Shown once two or more are applied. */
  onClearAll?: () => void;
  /** After the chips: a dashed "More filters" chip that opens the builder. */
  children?: ReactNode;
  className?: string | undefined;
};

/** Every applied filter as a chip that removes itself, so nothing narrows a list unseen. */
export function AppliedFilters({
  filters,
  onRemove,
  onClearAll,
  children,
  className,
}: AppliedFiltersProps): React.JSX.Element {
  return (
    <View className={cn('flex-row flex-wrap items-center gap-2', className)}>
      {filters.map((f) => (
        <Chip
          key={f.id}
          field={f.field}
          selected
          removeLabel={`Remove ${f.field} ${f.label}`}
          onRemove={() => {
            onRemove(f.id);
          }}
        >
          {f.label}
        </Chip>
      ))}
      {children}
      {onClearAll && filters.length > 1 ? (
        <Button variant="ghost" size="sm" onPress={onClearAll}>
          Clear all
        </Button>
      ) : null}
    </View>
  );
}
