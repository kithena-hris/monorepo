import { Filter, FolderPlus, Plus, Trash2 } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Text as CssText, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { Button } from '../button/button.tsx';
import { Card } from '../card/card.tsx';
import { Chip } from '../chip/chip.tsx';
import { Combobox } from '../combobox/combobox.tsx';
import { DatePicker } from '../date-picker/date-picker.tsx';
import { EmptyState } from '../feedback/feedback.tsx';
import { Icon } from '../icon/icon.tsx';
import { Input } from '../input/input.tsx';
import { SegmentedControl, SegmentedControlItem } from '../segmented-control/segmented-control.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../select/select.tsx';
import { Text } from '../text/text.tsx';
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
} from '@reach/ui/filter-model';
import { t } from '../../lib/i18n';

/**
 * Filters built out of conditions, as the web's `FilterBuilder`: each a
 * field, an operator and a value, joined by "all" or "any", and with
 * `allowGroups` one level of groups of their own. On a phone each condition
 * is a small stacked card (field, operator, then the value beside its remove
 * button) rather than a row of four, as the web draws it under a finger.
 *
 * The model is the web's own, `@reach/ui/filter-model`.
 */

export {
  addCondition,
  addGroup,
  conditionsOf,
  describeFilter,
  isConditionComplete,
  removeItem,
  setMatch,
  updateCondition,
} from '@reach/ui/filter-model';
export type {
  FilterCondition,
  FilterField,
  FilterGroup,
  FilterOperator,
  FilterSubgroup,
  FilterValueKind,
} from '@reach/ui/filter-model';

export type FilterBuilderProps = {
  fields: readonly FilterField[];
  value: FilterGroup;
  onChange: (value: FilterGroup) => void;
  /** Names the list of conditions for a screen reader. */
  label?: string;
  /** Past this, Add is disabled and says why. */
  maxConditions?: number;
  /** A fresh condition id. */
  newId?: () => string;
  /** Lets people add a nested all-or-any group. */
  allowGroups?: boolean;
  /** A message per condition id, for a value the caller cannot use. */
  errors?: Readonly<Record<string, string>>;
  /** A heading, which makes the builder a card of its own with a Clear. */
  title?: ReactNode;
  /** What the builder is for, said when there is nothing in it yet. */
  emptyDescription?: string;
  /** The trailing action: typically "Show 48 people". */
  action?: ReactNode;
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
  label = t('components.filter-builder.filter-builder.conditions', 'Conditions'),
  maxConditions = 10,
  newId = defaultId,
  allowGroups = false,
  errors = {},
  title,
  emptyDescription = t(
    'components.filter-builder.filter-builder.add_a_condition_to_narrow_the',
    'Add a condition to narrow the list.',
  ),
  action,
  className,
}: FilterBuilderProps): React.JSX.Element {
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
      <Card className={className}>
        <EmptyState
          icon={Filter}
          title={t('components.filter-builder.filter-builder.no_filters_yet', 'No filters yet')}
          description={emptyDescription}
          action={
            <Button
              variant="secondary"
              size="sm"
              startIcon={<Icon icon={Plus} />}
              disabled={fields.length === 0}
              onPress={() => {
                add(null);
              }}
            >
              Add condition
            </Button>
          }
          className="py-2.5"
        />
      </Card>
    );
  }

  // One running number, so "Condition 3" names one card wherever it sits.
  let n = 0;
  const card = (
    condition: FilterCondition,
    index: number,
    match: FilterGroup['match'],
  ): React.JSX.Element => {
    n += 1;
    return (
      <ConditionCard
        key={condition.id}
        n={n}
        joiner={index === 0 ? undefined : match === 'all' ? 'and' : 'or'}
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
  const match =
    items < 2 ? null : (
      <MatchToggle
        label={t('components.filter-builder.filter-builder.match', 'Match')}
        match={value.match}
        onChange={(m) => {
          onChange(setMatch(value, null, m));
        }}
      />
    );

  const list = (
    <View role="list" aria-label={label} className="gap-2.5">
      {value.conditions.map((c, i) => card(c, i, value.match))}
      {groups.map((group, index) => (
        <View key={group.id} role="listitem" className="gap-2">
          {value.conditions.length + index > 0 ? (
            <CssText className="text-[12px] leading-none font-semibold text-fg-muted">
              {value.match === 'all'
                ? t('components.filter-builder.filter-builder.and', 'and')
                : t('components.filter-builder.filter-builder.or', 'or')}
            </CssText>
          ) : null}
          <View
            role="group"
            aria-label={t(
              'components.filter-builder.filter-builder.group_of_these',
              'Group, {{match}} of these',
              { match: group.match },
            )}
            className="gap-2 rounded-[16px] border border-border-strong p-2.5"
          >
            <View className="flex-row flex-wrap items-center gap-2">
              <MatchToggle
                label={t(
                  'components.filter-builder.filter-builder.match_in_this_group',
                  'Match in this group',
                )}
                match={group.match}
                onChange={(m) => {
                  onChange(setMatch(value, group.id, m));
                }}
              />
              <CssText className="text-[13px] leading-none font-medium text-fg-muted">
                {t(
                  'components.filter-builder.filter-builder.of_these_are_true',
                  'of these are true',
                )}
              </CssText>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                startIcon={<Icon icon={Trash2} />}
                accessibilityLabel={t(
                  'components.filter-builder.filter-builder.remove_this_group',
                  'Remove this group',
                )}
                onPress={() => {
                  onChange(removeItem(value, group.id));
                }}
              />
            </View>
            <View
              role="list"
              aria-label={t(
                'components.filter-builder.filter-builder.conditions_in_this_group',
                'Conditions in this group',
              )}
              className="gap-2"
            >
              {group.conditions.map((c, i) => card(c, i, group.match))}
            </View>
            <View className="flex-row">
              <Button
                variant="ghost"
                size="sm"
                startIcon={<Icon icon={Plus} />}
                disabled={full}
                onPress={() => {
                  add(group.id);
                }}
              >
                {t('components.filter-builder.filter-builder.condition', 'Condition')}
              </Button>
            </View>
          </View>
        </View>
      ))}
    </View>
  );

  const footer = (
    <View className="flex-row flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        startIcon={<Icon icon={Plus} />}
        disabled={full || fields.length === 0}
        onPress={() => {
          add(null);
        }}
      >
        {t('components.filter-builder.filter-builder.add_condition', 'Add condition')}
      </Button>
      {allowGroups ? (
        <Button
          variant="ghost"
          size="sm"
          startIcon={<Icon icon={FolderPlus} />}
          disabled={full || fields.length === 0}
          onPress={addNested}
        >
          {t('components.filter-builder.filter-builder.add_group', 'Add group')}
        </Button>
      ) : null}
      {action ? <View className="ml-auto">{action}</View> : null}
      {full ? (
        <Text variant="footnote" tone="muted" className="basis-full">
          {t(
            'components.filter-builder.filter-builder.up_to_conditions_remove_one_to',
            'Up to {{String}} conditions. Remove one to add another.',
            { String: String(maxConditions) },
          )}
        </Text>
      ) : null}
    </View>
  );

  if (title === undefined) {
    return (
      <View className={cn('gap-2.5', className)}>
        {match ? (
          <View className="flex-row items-center gap-2">
            <Text variant="subhead" tone="muted">
              {t('components.filter-builder.filter-builder.match', 'Match')}
            </Text>
            {match}
          </View>
        ) : null}
        {list}
        {footer}
      </View>
    );
  }

  return (
    <Card className={cn('gap-2.5', className)}>
      <View className="flex-row items-center gap-2.5">
        {typeof title === 'string' ? (
          <Text variant="title3" weight="bold" accessibilityRole="header" className="text-[18px]">
            {title}
          </Text>
        ) : (
          title
        )}
        {match}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onPress={() => {
            onChange({ match: value.match, conditions: [] });
          }}
        >
          {t('components.filter-builder.filter-builder.clear', 'Clear')}
        </Button>
      </View>
      {list}
      {footer}
    </Card>
  );
}

function MatchToggle({
  label,
  match,
  onChange,
}: {
  label: string;
  match: FilterGroup['match'];
  onChange: (match: FilterGroup['match']) => void;
}): React.JSX.Element {
  return (
    <SegmentedControl
      size="sm"
      value={match}
      onValueChange={(m) => {
        onChange(m === 'any' ? 'any' : 'all');
      }}
      accessibilityLabel={label}
    >
      <SegmentedControlItem value="all">
        {t('components.filter-builder.filter-builder.all', 'All')}
      </SegmentedControlItem>
      <SegmentedControlItem value="any">
        {t('components.filter-builder.filter-builder.any', 'Any')}
      </SegmentedControlItem>
    </SegmentedControl>
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
  onChange: (patch: Partial<Pick<FilterCondition, 'field' | 'operator' | 'values'>>) => void;
  onRemove: () => void;
}): React.JSX.Element {
  const field = fields.find((f) => f.id === condition.field);
  const operator = field?.operators.find((o) => o.id === condition.operator);
  const said = `Condition ${String(n)}`;
  const fieldName = field?.label ?? 'field';
  return (
    <View role="listitem" aria-label={said} className="gap-2 rounded-[16px] bg-surface-sunken p-3">
      {joiner ? (
        <CssText className="text-[12px] leading-none font-semibold text-fg-muted">{joiner}</CssText>
      ) : null}
      <Choice
        label={t('components.filter-builder.filter-builder.field', '{{said}}, field', { said })}
        value={condition.field}
        options={fields.map((f) => ({ value: f.id, label: f.label }))}
        onChange={(id) => {
          onChange({ field: id });
        }}
      />
      <Choice
        label={t('components.filter-builder.filter-builder.operator', '{{said}}, operator', {
          said,
        })}
        value={condition.operator}
        options={(field?.operators ?? []).map((o) => ({ value: o.id, label: o.label }))}
        onChange={(id) => {
          onChange({ operator: id });
        }}
      />
      <View className="flex-row items-center gap-1.5">
        <View className="flex-1">
          <ValueInput
            kind={operator?.value ?? 'none'}
            label={t(
              'components.filter-builder.filter-builder.value_for',
              '{{said}}, value for {{fieldName}}',
              { said, fieldName },
            )}
            options={field?.options ?? []}
            values={condition.values}
            invalid={error !== undefined}
            onValues={(values) => {
              onChange({ values });
            }}
          />
        </View>
        <Button
          variant="ghost"
          size="sm"
          startIcon={<Icon icon={Trash2} />}
          accessibilityLabel={t(
            'components.filter-builder.filter-builder.remove_condition',
            'Remove condition {{String}}, {{fieldName}}',
            { String: String(n), fieldName },
          )}
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

/** The value an operator asks for, in the control that suits it. */
function ValueInput({
  kind,
  label,
  options,
  values,
  invalid,
  onValues,
}: {
  kind: FilterValueKind;
  label: string;
  options: readonly { value: string; label: string }[];
  values: readonly string[];
  invalid: boolean;
  onValues: (values: readonly string[]) => void;
}): React.JSX.Element | null {
  const first = values[0] ?? '';
  switch (kind) {
    case 'none':
      return null;
    case 'text':
    case 'number':
      return (
        <Input
          size="sm"
          value={first}
          placeholder={t('components.filter-builder.filter-builder.value', 'Value')}
          accessibilityLabel={label}
          invalid={invalid}
          {...(kind === 'number' ? { keyboardType: 'decimal-pad' as const } : {})}
          onChangeText={(text: string) => {
            onValues([text]);
          }}
        />
      );
    case 'date':
      return (
        <DatePicker
          size="sm"
          label={label}
          invalid={invalid}
          value={first === '' ? null : first}
          onChange={(date) => {
            onValues(date === null ? [] : [date]);
          }}
        />
      );
    case 'date-range':
      return (
        <DatePicker
          size="sm"
          mode="range"
          label={label}
          placeholder={t('components.filter-builder.filter-builder.pick_a_period', 'Pick a period')}
          invalid={invalid}
          value={values.length === 0 ? null : { start: values[0] || null, end: values[1] || null }}
          onChange={(range) => {
            onValues([range.start ?? '', range.end ?? '']);
          }}
        />
      );
    case 'option':
      return (
        <Choice
          label={label}
          value={first}
          placeholder={t('components.filter-builder.filter-builder.choose_one', 'Choose one')}
          options={options}
          invalid={invalid}
          onChange={(v) => {
            onValues([v]);
          }}
        />
      );
    case 'options':
      return (
        <Combobox
          size="sm"
          multiple
          label={label}
          placeholder={t('components.filter-builder.filter-builder.choose_any', 'Choose any')}
          options={options}
          invalid={invalid}
          value={values}
          onChange={(chosen) => {
            onValues(chosen === null ? [] : typeof chosen === 'string' ? [chosen] : chosen);
          }}
        />
      );
  }
}

/** A field, an operator or an option value: Select, as a centred list. */
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
          removeLabel={t(
            'components.filter-builder.filter-builder.remove',
            'Remove {{field}} {{label}}',
            { field: f.field, label: f.label },
          )}
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
          {t('components.filter-builder.filter-builder.clear_all', 'Clear all')}
        </Button>
      ) : null}
    </View>
  );
}
