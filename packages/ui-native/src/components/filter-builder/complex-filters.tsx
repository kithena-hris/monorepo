import { FolderPlus, Plus, Trash2, X } from 'lucide-react-native';
import { Fragment, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { Pressable, Text as CssText, TextInput, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { menuRowClass, menuSurface } from '../../lib/menu.tsx';
import { Button } from '../button/button.tsx';
import { CheckboxBox } from '../checkbox/checkbox.tsx';
import { Chip } from '../chip/chip.tsx';
import { Icon } from '../icon/icon.tsx';
import {
  SegmentedControl,
  SegmentedControlItem,
} from '../segmented-control/segmented-control.tsx';
import { Text } from '../text/text.tsx';
import type { FilterCondition, FilterField, FilterGroup } from './filter-builder.tsx';

/**
 * The pieces a big list's filters are built from, past one row of
 * conditions: facets with counts, nested and/or groups, and query tokens for
 * people who type. Each ends as the same applied chips.
 */

const WEB = Platform.OS === 'web';

/* ------------------------------------------------------------------ facets */

export type FacetOption = { value: string; label: string; count: number };

export type FacetListProps = {
  title: string;
  options: readonly FacetOption[];
  selected: readonly string[];
  onSelectedChange: (selected: readonly string[]) => void;
  /** "Show all": more options than are listed. */
  onShowAll?: () => void;
  className?: string | undefined;
};

/**
 * One facet: its options, each with how many results it would leave. An
 * option with none is dimmed but can still be picked: the count is advice.
 */
export function FacetList({
  title,
  options,
  selected,
  onSelectedChange,
  onShowAll,
  className,
}: FacetListProps): React.JSX.Element {
  return (
    <View role="group" aria-label={title} className={cn('gap-1.5', className)}>
      <View className="flex-row items-center">
        <Text variant="callout" weight="semibold">
          {title}
        </Text>
        {onShowAll ? (
          <Button variant="link" size="sm" className="ml-auto" onPress={onShowAll}>
            Show all
          </Button>
        ) : null}
      </View>
      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <Pressable
            key={o.value}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            aria-checked={on}
            accessibilityLabel={`${o.label}, ${String(o.count)} results`}
            onPress={() => {
              onSelectedChange(
                on ? selected.filter((v) => v !== o.value) : [...selected, o.value],
              );
            }}
            className={cn('min-h-11 flex-row items-center gap-2.5', o.count === 0 && 'opacity-45')}
          >
            <CheckboxBox checked={on} />
            <CssText className="flex-1 text-callout leading-[1.2] text-fg">{o.label}</CssText>
            <CssText className="text-[12px] leading-none font-medium text-fg-subtle tabular-nums">
              {o.count}
            </CssText>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ groups */

export type FilterGroupEditorProps = {
  fields: readonly FilterField[];
  value: FilterGroup;
  onChange: (value: FilterGroup) => void;
  /** "Condition": the caller asks for one (a field, an operator, values) and adds it. */
  onAddCondition?: (groupId: string | null) => void;
  /** A new subgroup's id. */
  newId?: () => string;
  className?: string | undefined;
};

let next = 0;
const defaultId = (): string => {
  next += 1;
  return `group-${String(next)}`;
};

/**
 * Conditions in "all" or "any" groups, one level of nesting at most: deeper
 * than that, nobody can read the filter back. Each condition is a small card
 * with its values as chips; the sentence `describeFilters` writes belongs
 * underneath, since that is what people actually read.
 */
export function FilterGroupEditor({
  fields,
  value,
  onChange,
  onAddCondition,
  newId = defaultId,
  className,
}: FilterGroupEditorProps): React.JSX.Element {
  const removeFrom = (groupId: string | null, id: string): void => {
    if (groupId === null) {
      onChange({ ...value, conditions: value.conditions.filter((c) => c.id !== id) });
      return;
    }
    onChange({
      ...value,
      groups: (value.groups ?? []).map((g) =>
        g.id === groupId ? { ...g, conditions: g.conditions.filter((c) => c.id !== id) } : g,
      ),
    });
  };
  return (
    <Group
      fields={fields}
      match={value.match}
      onMatch={(match) => {
        onChange({ ...value, match });
      }}
      conditions={value.conditions}
      onRemove={(id) => {
        removeFrom(null, id);
      }}
      {...(onAddCondition
        ? {
            onAddCondition: () => {
              onAddCondition(null);
            },
          }
        : {})}
      onAddGroup={() => {
        onChange({
          ...value,
          groups: [...(value.groups ?? []), { id: newId(), match: 'any', conditions: [] }],
        });
      }}
      className={className}
    >
      {(value.groups ?? []).map((g) => (
        <Group
          key={g.id}
          nested
          fields={fields}
          match={g.match}
          onMatch={(match) => {
            onChange({
              ...value,
              groups: (value.groups ?? []).map((x) => (x.id === g.id ? { ...x, match } : x)),
            });
          }}
          conditions={g.conditions}
          onRemove={(id) => {
            removeFrom(g.id, id);
          }}
          {...(onAddCondition
            ? {
                onAddCondition: () => {
                  onAddCondition(g.id);
                },
              }
            : {})}
          onRemoveGroup={() => {
            onChange({ ...value, groups: (value.groups ?? []).filter((x) => x.id !== g.id) });
          }}
        />
      ))}
    </Group>
  );
}

function Group({
  fields,
  match,
  onMatch,
  conditions,
  onRemove,
  onAddCondition,
  onAddGroup,
  onRemoveGroup,
  nested = false,
  children,
  className,
}: {
  fields: readonly FilterField[];
  match: 'all' | 'any';
  onMatch: (match: 'all' | 'any') => void;
  conditions: readonly FilterCondition[];
  onRemove: (id: string) => void;
  onAddCondition?: () => void;
  onAddGroup?: () => void;
  onRemoveGroup?: () => void;
  nested?: boolean;
  children?: ReactNode;
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <View
      role="group"
      aria-label={nested ? 'Nested group' : 'Filter group'}
      className={cn(
        'gap-2 rounded-[18px] p-2.5',
        nested ? 'bg-surface-sunken' : 'border border-border-strong',
        className,
      )}
    >
      <View className="flex-row flex-wrap items-center gap-2">
        <SegmentedControl
          size="sm"
          value={match}
          onValueChange={(m) => {
            onMatch(m === 'any' ? 'any' : 'all');
          }}
          accessibilityLabel={nested ? 'Nested group matches' : 'Group matches'}
        >
          <SegmentedControlItem value="all">All</SegmentedControlItem>
          <SegmentedControlItem value="any">Any</SegmentedControlItem>
        </SegmentedControl>
        <CssText className="text-[13px] leading-none font-medium text-fg-muted">
          of these are true
        </CssText>
        {onRemoveGroup ? (
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto"
            startIcon={<Icon icon={Trash2} />}
            accessibilityLabel="Remove this group"
            onPress={onRemoveGroup}
          />
        ) : null}
      </View>
      {conditions.map((c) => (
        <ConditionCard
          key={c.id}
          fields={fields}
          condition={c}
          onRemove={() => {
            onRemove(c.id);
          }}
        />
      ))}
      {children}
      <View className="flex-row gap-1.5">
        <Button
          variant="ghost"
          size="xs"
          startIcon={<Icon icon={Plus} />}
          {...(onAddCondition ? { onPress: onAddCondition } : {})}
        >
          Condition
        </Button>
        {onAddGroup && !nested ? (
          <Button variant="ghost" size="xs" startIcon={<Icon icon={FolderPlus} />} onPress={onAddGroup}>
            Group
          </Button>
        ) : null}
      </View>
    </View>
  );
}

function ConditionCard({
  fields,
  condition,
  onRemove,
}: {
  fields: readonly FilterField[];
  condition: FilterCondition;
  onRemove: () => void;
}): React.JSX.Element {
  const field = fields.find((f) => f.id === condition.field);
  const operator = field?.operators.find((o) => o.id === condition.operator);
  const name = field?.label ?? condition.field;
  return (
    <View className="gap-2 rounded-[14px] bg-surface p-3 shadow-sm">
      <View className="flex-row items-center gap-1.5">
        <CssText className="text-[15px] font-semibold text-fg">{name}</CssText>
        <CssText className="text-[15px] text-fg-muted">{operator?.label ?? ''}</CssText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${name} ${operator?.label ?? ''}`}
          hitSlop={14}
          onPress={onRemove}
          className="ml-auto"
        >
          <Icon icon={X} size={16} tone="subtle" />
        </Pressable>
      </View>
      <View className="flex-row flex-wrap gap-1.5">
        {condition.values.map((v) => (
          <Chip key={v} selected>
            {field?.options?.find((o) => o.value === v)?.label ?? v}
          </Chip>
        ))}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------- query */

export type QuerySuggestion = { value: string; description: string };

export type FilterQueryProps = {
  /** Finished tokens, `team:eng`: each the same filter a menu would make. */
  tokens: readonly string[];
  onTokensChange: (tokens: readonly string[]) => void;
  /** The token being typed. */
  text: string;
  onTextChange: (text: string) => void;
  /** Completions for `text`, from the caller. */
  suggestions?: readonly QuerySuggestion[];
  /** A heading over the completions: the key being completed, `start:`. */
  suggestionsTitle?: string | undefined;
  label?: string;
  className?: string | undefined;
};

/**
 * A search field that takes `key:value` tokens, for people who would rather
 * type than tap. A space finishes a token and it becomes a chip; backspace in
 * an empty field takes the last one back. Completions list underneath.
 */
export function FilterQuery({
  tokens,
  onTokensChange,
  text,
  onTextChange,
  suggestions = [],
  suggestionsTitle,
  label = 'Filter query',
  className,
}: FilterQueryProps): React.JSX.Element {
  const finish = (value: string): void => {
    const token = value.trim();
    if (token) onTokensChange([...tokens, token]);
    onTextChange('');
  };
  return (
    <View className={cn('gap-1.5', className)}>
      <View className="min-h-m-field flex-row flex-wrap items-center gap-1.5 rounded-[16px] border-2 border-accent bg-surface px-3 py-2">
        {tokens.map((t, i) => (
          <Pressable
            key={`${t}-${String(i)}`}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${t}`}
            onPress={() => {
              onTokensChange(tokens.filter((_, j) => j !== i));
            }}
            className="rounded-[6px] bg-accent-subtle px-1.5 py-0.5"
          >
            <Text mono className="text-[15px] text-accent-fg">
              {t}
            </Text>
          </Pressable>
        ))}
        <TextInput
          value={text}
          onChangeText={(v: string) => {
            if (v.endsWith(' ')) finish(v);
            else onTextChange(v);
          }}
          onSubmitEditing={() => {
            finish(text);
          }}
          onKeyPress={(e: { nativeEvent: { key: string } }) => {
            if (e.nativeEvent.key === 'Backspace' && text === '' && tokens.length > 0) {
              onTokensChange(tokens.slice(0, -1));
            }
          }}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={label}
          style={{ fontFamily: WEB ? "ui-monospace, 'SF Mono', Menlo, monospace" : Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}
          className="min-w-20 flex-1 p-0 text-[15px] text-fg outline-none"
        />
      </View>
      {suggestions.length > 0 ? (
        <View role="list" aria-label="Completions" className={menuSurface}>
          {suggestionsTitle ? (
            <Text mono className="px-3 pt-2 pb-1 text-[12px] font-semibold text-fg-subtle">
              {suggestionsTitle}
            </Text>
          ) : null}
          {suggestions.map((s, i) => (
            <Fragment key={s.value}>
              <Pressable
                role="listitem"
                accessibilityRole="button"
                onPress={() => {
                  finish(s.value);
                }}
                className={menuRowClass({ highlighted: i === 0 })}
              >
                <View className="flex-1 gap-0.5">
                  <Text mono className="text-[15px]">
                    {s.value}
                  </Text>
                  <Text variant="footnote" tone="muted">
                    {s.description}
                  </Text>
                </View>
              </Pressable>
            </Fragment>
          ))}
        </View>
      ) : null}
    </View>
  );
}
