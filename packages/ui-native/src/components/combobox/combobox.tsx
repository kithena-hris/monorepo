import { ChevronsUpDown, Plus, SearchX, X } from 'lucide-react-native';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text as CssText, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { useFocusRing } from '../../lib/focus-ring.ts';
import { Button } from '../button/button.tsx';
import { Chip } from '../chip/chip.tsx';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../dialog/dialog.tsx';
import { Field, FieldLabel } from '../field/field.tsx';
import { Icon } from '../icon/icon.tsx';
import { FieldBox, fieldText, useFieldState } from '../input/input.tsx';
import { ListFooter, ListHeading, ListSeparator, OptionRow } from '../select/listbox.tsx';
import { Spinner } from '../spinner/spinner.tsx';
import { Text } from '../text/text.tsx';
import { SearchField } from '../typed-fields/typed-fields.tsx';

/**
 * A select you can type into, for a list too long to scan: a manager out of
 * nine hundred people, a country, a time zone.
 *
 * On a phone the trigger opens a centred dialog with a search field over the
 * list, the keyboard already up. Matches are drawn in the accent; the first is
 * on the fill, and the keyboard's return key picks it. Several can be chosen
 * with `multiple`, and then a Done button closes the list. Already inside a
 * dialog, `inline` draws the search and the list in place rather than opening
 * a second dialog over the first.
 */

export type ComboboxOption = {
  value: string;
  label: string;
  /** A second line: a team, a job title, whatever tells two Grace Hoppers apart. */
  description?: string;
  /** An `<Icon>` or a 32pt `<Avatar>`. A single choice's shows on the trigger too. */
  icon?: ReactNode;
  disabled?: boolean;
  /** Options sharing a group render under one heading. */
  group?: string;
};

export type ComboboxProps = {
  options: readonly ComboboxOption[];
  /** A single value, or an array when `multiple` is set. */
  value: string | readonly string[] | null;
  onChange: (value: string | readonly string[] | null) => void;
  multiple?: boolean;
  /**
   * With `multiple`, the choice shows in the field as chips, each with a button
   * that removes it: for a choice read back as often as it is made.
   */
  chips?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  /** Said when nothing matches; given the query when it is a function. */
  emptyMessage?: string | ((query: string) => string);
  /** The control's name, and the dialog's title. A `Field`'s label wins. */
  label: string;
  disabled?: boolean;
  invalid?: boolean;
  /** Adds a clear button once something is chosen. */
  clearable?: boolean;
  /** `sm` 44pt; `md` and `lg` 56 under a thumb. */
  size?: 'sm' | 'md' | 'lg';
  /**
   * Filter elsewhere: pass the options already filtered and take the query
   * here. The mode for a list that lives on a server.
   */
  onSearchChange?: (query: string) => void;
  /** A server search is in flight: a spinner in the search field. */
  loading?: boolean;
  /** A line under the list, such as "Searching all 312 people…". */
  footer?: string;
  /** Offers to create what was typed when it matches no option exactly. */
  onCreate?: (query: string) => void;
  /** The create row's label. */
  createLabel?: (query: string) => string;
  /** Draw the search and the list in place: for a combobox already in a dialog. */
  inline?: boolean;
  /** The search as it opens, for a story or a restored screen. */
  defaultQuery?: string;
  defaultOpen?: boolean;
  /** Draw in the `OverlayHost` of this name instead of the root one. */
  portalHost?: string;
  className?: string | undefined;
};

const asList = (value: ComboboxProps['value']): readonly string[] =>
  value == null ? [] : typeof value === 'string' ? [value] : value;

export function Combobox({
  options,
  value,
  onChange,
  multiple = false,
  chips = false,
  placeholder = 'Choose…',
  searchPlaceholder = 'Search',
  emptyMessage = (query) => `Nothing matches “${query}”`,
  label,
  disabled: disabledProp,
  invalid: invalidProp,
  clearable = false,
  size = 'md',
  onSearchChange,
  loading = false,
  footer,
  onCreate,
  createLabel = (query) => `Create “${query}”`,
  inline = false,
  defaultQuery = '',
  defaultOpen = false,
  portalHost,
  className,
}: ComboboxProps): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const state = useFieldState({ invalid: invalidProp, disabled: disabledProp });
  const name = state.name ?? label;
  const chosen = asList(value);
  const chosenOptions = chosen.map(
    (v) => options.find((o) => o.value === v) ?? { value: v, label: v },
  );
  const remove = (gone: string): void => {
    const next = chosen.filter((v) => v !== gone);
    onChange(next);
  };

  const panel = (
    <Panel
      options={options}
      chosen={chosen}
      multiple={multiple}
      name={name}
      searchPlaceholder={searchPlaceholder}
      emptyMessage={emptyMessage}
      onSearchChange={onSearchChange}
      loading={loading}
      footer={footer}
      onCreate={onCreate}
      createLabel={createLabel}
      defaultQuery={defaultQuery}
      inline={inline}
      onPick={(picked) => {
        if (multiple) {
          onChange(
            chosen.includes(picked) ? chosen.filter((v) => v !== picked) : [...chosen, picked],
          );
        } else {
          onChange(picked);
          setOpen(false);
        }
      }}
    />
  );

  if (inline) return <View className={cn('gap-1.5', className)}>{panel}</View>;

  const shown =
    multiple && chosen.length > 1
      ? `${String(chosen.length)} selected`
      : chosenOptions.map((o) => o.label).join(', ');
  const single = !multiple ? chosenOptions[0] : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next && !state.disabled);
      }}
    >
      {multiple && chips ? (
        <ChipsBox
          name={name}
          hint={state.hint}
          chosen={chosenOptions}
          placeholder={placeholder}
          disabled={state.disabled}
          invalid={state.invalid}
          open={open}
          onRemove={remove}
          className={className}
        />
      ) : (
        <View className={cn('relative', className)}>
          <Trigger
            name={name}
            hint={state.hint}
            shown={shown}
            placeholder={placeholder}
            icon={single?.icon}
            size={size}
            disabled={state.disabled}
            invalid={state.invalid}
            caution={state.caution}
            open={open}
            clearing={clearable && chosen.length > 0 && !state.disabled}
          />
          {/*
           * Beside the trigger, over its end, not inside it: a control nested
           * in a button is flattened into the button's name and cannot be
           * reached on its own.
           */}
          {clearable && chosen.length > 0 && !state.disabled ? (
            <View className="absolute top-0 right-11 bottom-0 justify-center">
              <Button
                variant="ghost"
                size="xs"
                startIcon={<Icon icon={X} />}
                accessibilityLabel={`Clear ${name}`}
                onPress={() => {
                  onChange(multiple ? [] : null);
                }}
              />
            </View>
          ) : null}
        </View>
      )}
      <DialogContent {...(portalHost ? { portalHost } : {})} className="gap-2 px-1.5 pb-1.5">
        <DialogHeader className="px-4 pt-0.5 pb-1">
          <DialogTitle>{name}</DialogTitle>
        </DialogHeader>
        {panel}
        {multiple ? (
          <DialogFooter className="px-1.5 pb-1.5">
            <Button
              variant="primary"
              onPress={() => {
                setOpen(false);
              }}
            >
              Done
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------- trigger */

function Trigger({
  name,
  hint,
  shown,
  placeholder,
  icon,
  size,
  disabled,
  invalid,
  caution,
  open,
  clearing = false,
  className,
}: {
  name: string;
  hint: string | undefined;
  shown: string;
  placeholder: string;
  icon: ReactNode;
  size: 'sm' | 'md' | 'lg';
  disabled: boolean;
  invalid: boolean;
  caution: boolean;
  open: boolean;
  /** Room at the end for the clear button drawn over it. */
  clearing?: boolean;
  className?: string | undefined;
}): React.JSX.Element {
  const ring = useFocusRing();
  return (
    <DialogTrigger asChild disabled={disabled}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${shown || 'nothing chosen'}`}
        {...(hint ? { accessibilityHint: hint } : {})}
        accessibilityState={{ disabled }}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onFocus={ring.onFocus}
        onBlur={ring.onBlur}
        className={cn('rounded-[16px] outline-none', className)}
      >
        <FieldBox
          size={size}
          focused={ring.focused || open}
          invalid={invalid}
          caution={caution}
          disabled={disabled}
          startAdornment={icon}
          endAdornment={<Icon icon={ChevronsUpDown} size={18} tone="muted" />}
        >
          <CssText
            aria-hidden
            numberOfLines={1}
            className={cn(fieldText, !shown && 'text-fg-subtle', clearing && 'pr-9')}
          >
            {shown || placeholder}
          </CssText>
        </FieldBox>
      </Pressable>
    </DialogTrigger>
  );
}

/** The field as chips, each removable, and a button after them that opens the list. */
function ChipsBox({
  name,
  hint,
  chosen,
  placeholder,
  disabled,
  invalid,
  open,
  onRemove,
  className,
}: {
  name: string;
  hint: string | undefined;
  chosen: readonly { value: string; label: string }[];
  placeholder: string;
  disabled: boolean;
  invalid: boolean;
  open: boolean;
  onRemove: (value: string) => void;
  className: string | undefined;
}): React.JSX.Element {
  const ring = useFocusRing();
  const focused = ring.focused || open;
  return (
    <View
      aria-disabled={disabled || undefined}
      className={cn(
        'min-h-m-field flex-row flex-wrap items-center gap-1.5 rounded-[16px] px-2 py-1.5',
        focused ? 'bg-surface' : 'bg-surface-sunken',
        disabled && 'opacity-50',
        className,
      )}
    >
      {chosen.map((option) => (
        <Chip
          key={option.value}
          {...(disabled
            ? {}
            : {
                onRemove: () => {
                  onRemove(option.value);
                },
              })}
        >
          {option.label}
        </Chip>
      ))}
      <DialogTrigger asChild disabled={disabled}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${placeholder}, ${name}, ${String(chosen.length)} selected`}
          {...(hint ? { accessibilityHint: hint } : {})}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onFocus={ring.onFocus}
          onBlur={ring.onBlur}
          className="min-h-9 min-w-20 flex-1 justify-center px-1 outline-none"
        >
          <CssText numberOfLines={1} className="text-[17px] text-fg-subtle">
            {placeholder}
          </CssText>
        </Pressable>
      </DialogTrigger>
      {focused || invalid ? (
        <View
          style={{ pointerEvents: 'none' }}
          className={cn(
            'absolute inset-0 rounded-[16px] border-2',
            focused ? 'border-accent' : 'border-danger',
          )}
        />
      ) : null}
    </View>
  );
}

/* ---------------------------------------------------------------- panel */

function Panel({
  options,
  chosen,
  multiple,
  name,
  searchPlaceholder,
  emptyMessage,
  onSearchChange,
  loading,
  footer,
  onCreate,
  createLabel,
  defaultQuery,
  inline,
  onPick,
}: {
  inline: boolean;
  options: readonly ComboboxOption[];
  chosen: readonly string[];
  multiple: boolean;
  name: string;
  searchPlaceholder: string;
  emptyMessage: string | ((query: string) => string);
  onSearchChange: ((query: string) => void) | undefined;
  loading: boolean;
  footer: string | undefined;
  onCreate: ((query: string) => void) | undefined;
  createLabel: (query: string) => string;
  defaultQuery: string;
  onPick: (value: string) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState(defaultQuery);
  const q = query.trim();
  const matches = useMemo(
    () =>
      onSearchChange || !q
        ? options
        : options.filter((o) => o.label.toLocaleLowerCase().includes(q.toLocaleLowerCase())),
    [options, q, onSearchChange],
  );
  const first = matches.find((o) => !o.disabled);
  const exact = options.some((o) => o.label.toLocaleLowerCase() === q.toLocaleLowerCase());
  const canCreate = Boolean(onCreate && q && !exact);

  const groups = new Map<string | undefined, ComboboxOption[]>();
  for (const option of matches) {
    const list = groups.get(option.group) ?? [];
    list.push(option);
    groups.set(option.group, list);
  }

  const said = multiple
    ? `${String(chosen.length)} selected`
    : loading
      ? 'Searching…'
      : `${String(matches.length)} ${matches.length === 1 ? 'match' : 'matches'}`;

  return (
    <>
      <View className={cn(!inline && 'px-1.5')}>
        <SearchBox inline={inline} name={name}>
          <SearchField
            value={query}
            onValueChange={(next) => {
              setQuery(next);
              onSearchChange?.(next);
            }}
            onSearch={() => {
              if (first) onPick(first.value);
              else if (canCreate) onCreate?.(q);
            }}
            label={`Search ${name.toLowerCase()}`}
            placeholder={searchPlaceholder}
            autoFocus
            {...(loading ? { endAdornment: <Spinner size={16} label="Searching" /> } : {})}
          />
        </SearchBox>
      </View>
      {matches.length === 0 && !canCreate ? (
        loading ? null : (
          <View className="items-center gap-2.5 px-4 pt-2 pb-3">
            <View className="size-14 items-center justify-center rounded-full bg-surface-sunken">
              <Icon icon={SearchX} size={26} tone="muted" />
            </View>
            <Text weight="semibold" className="text-center">
              {typeof emptyMessage === 'function' ? emptyMessage(q) : emptyMessage}
            </Text>
          </View>
        )
      ) : (
        <ScrollView className="max-h-[360px]">
          <View role={multiple ? 'group' : 'radiogroup'} accessibilityLabel={name}>
            {[...groups].map(([group, list], index) => (
              <Fragment key={group ?? `ungrouped-${String(index)}`}>
                {group ? <ListHeading>{group}</ListHeading> : null}
                {list.map((option) => (
                  <OptionRow
                    key={option.value}
                    label={option.label}
                    description={option.description}
                    icon={option.icon}
                    disabled={option.disabled}
                    multiple={multiple}
                    selected={chosen.includes(option.value)}
                    active={Boolean(q) && option === first}
                    match={q || undefined}
                    onPress={() => {
                      onPick(option.value);
                    }}
                  />
                ))}
              </Fragment>
            ))}
            {canCreate ? (
              <>
                {matches.length > 0 ? <ListSeparator /> : null}
                <CreateRow
                  label={createLabel(q)}
                  onPress={() => {
                    onCreate?.(q);
                  }}
                />
              </>
            ) : null}
          </View>
        </ScrollView>
      )}
      {footer || multiple ? <ListFooter>{footer ?? said}</ListFooter> : null}
      {/* Heard as the list narrows; the count is not drawn. */}
      {!footer && !multiple ? (
        <View className="absolute h-px w-px overflow-hidden opacity-0">
          <CssText accessibilityLiveRegion="polite" aria-live="polite">
            {said}
          </CssText>
        </View>
      ) : null}
    </>
  );
}

/** Inline, the search carries the control's name as its floating label: no dialog title says it. */
function SearchBox({
  inline,
  name,
  children,
}: {
  inline: boolean;
  name: string;
  children: ReactNode;
}): React.JSX.Element {
  if (!inline) return <>{children}</>;
  return (
    <Field>
      <FieldLabel>{name}</FieldLabel>
      {children}
    </Field>
  );
}

function CreateRow({ label, onPress }: { label: string; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="min-h-12 flex-row items-center gap-2.5 rounded-[14px] px-3 active:bg-surface-sunken"
    >
      <Icon icon={Plus} size={20} tone="muted" />
      <CssText aria-hidden className="flex-1 text-[17px] leading-[1.3] text-fg">
        {label}
      </CssText>
    </Pressable>
  );
}
