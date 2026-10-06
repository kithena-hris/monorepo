import * as DialogPrimitive from '@rn-primitives/dialog';
import { ChevronLeft, ChevronRight, Search, type LucideIcon } from 'lucide-react-native';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { styled } from 'react-native-css';
import { Pressable, ScrollView, TextInput, View } from 'react-native-css/components';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cn } from '../../lib/cn.ts';
import { useOverlayContainer } from '../../lib/overlay-host.tsx';
import { flatStyle, InertOutside, quietFrame } from '../../lib/overlay.tsx';
import { BackGuard } from '../dialog/dialog.tsx';
import { Skeleton } from '../feedback/feedback.tsx';
import { Icon } from '../icon/icon.tsx';
import { Spinner } from '../spinner/spinner.tsx';
import { Text } from '../text/text.tsx';

/**
 * Search everything and run actions from one field.
 *
 * `Command` is the field and its results, and renders anywhere; on a phone
 * `CommandPalette` opens it full screen from a search button. It is the
 * combobox pattern, not a menu: the reader is typing, so focus stays in the
 * field and the highlighted result is pointed at. The number of results is
 * announced as it changes.
 *
 * With a hardware keyboard: ↑ ↓ move through the results, Enter runs the
 * highlighted one, Backspace on an empty field goes back a page.
 */
export type CommandItem = {
  id: string;
  label: string;
  /** Second line: a job title, where a page lives. */
  description?: string;
  /** Drawn in a small tile. */
  icon?: LucideIcon;
  /** Drawn bare, without the tile: an `Avatar` at 28. */
  avatar?: ReactNode;
  /** Items sharing a group render under one heading, in the order groups first appear. */
  group?: string;
  /** Extra words that should find this item without being shown. */
  keywords?: readonly string[];
  disabled?: boolean;
  onSelect?: () => void;
  /** Makes the item open a page of its own commands instead of running. */
  items?: readonly CommandItem[];
};

/**
 * Filters and ranks by the query, as the web's does: a label starting with
 * it, then a word in the label starting with it, then a label containing it,
 * then a match in the description or keywords. Ties keep the caller's order.
 */
export function filterCommands(
  items: readonly CommandItem[],
  query: string,
): readonly CommandItem[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return items;
  const rank = (item: CommandItem): number => {
    const label = item.label.toLowerCase();
    if (label.startsWith(needle)) return 0;
    if (label.split(/\s+/).some((word) => word.startsWith(needle))) return 1;
    if (label.includes(needle)) return 2;
    const rest = [item.description ?? '', ...(item.keywords ?? [])].join(' ').toLowerCase();
    return rest.includes(needle) ? 3 : -1;
  };
  return items
    .map((item, index) => ({ item, index, score: rank(item) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.item);
}

function groupCommands(items: readonly CommandItem[]): [string, CommandItem[]][] {
  const map = new Map<string, CommandItem[]>();
  for (const item of items) {
    const key = item.group ?? '';
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return [...map.entries()];
}

/** The next enabled index from `from`, stepping by `delta` and wrapping. */
function step(items: readonly CommandItem[], from: number, delta: 1 | -1): number {
  for (let n = 1; n <= items.length; n += 1) {
    const index = (((from + delta * n) % items.length) + items.length) % items.length;
    if (!items[index]?.disabled) return index;
  }
  return from;
}

function Highlight({ text, query }: { text: string; query: string }): React.JSX.Element {
  const needle = query.trim();
  const at = needle === '' ? -1 : text.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <Text weight="bold" tone="accent" className="text-[16px]">
        {text.slice(at, at + needle.length)}
      </Text>
      {text.slice(at + needle.length)}
    </>
  );
}

const WEB = Platform.OS === 'web';

/** Says how many results there are, politely, once the count settles. */
function Announce({ message }: { message: string }): React.JSX.Element | null {
  useEffect(() => {
    if (!WEB && message) AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
  if (!WEB) return null;
  return (
    <View aria-live="polite" className="absolute h-px w-px overflow-hidden opacity-0">
      <Text>{message}</Text>
    </View>
  );
}

/** ARIA the combobox pattern needs and React Native's types do not list. */
function aria(props: Record<string, string | boolean | undefined>): object {
  return WEB ? props : {};
}

export type CommandProps = {
  items: readonly CommandItem[];
  /** Accessible name of the field and the results. */
  label?: string;
  placeholder?: string;
  /** The starting query. Owned by the component from then on. */
  defaultQuery?: string;
  /** Called on every keystroke. Pair with `filter={false}` to search on a server. */
  onQueryChange?: (query: string) => void;
  /** `false` shows `items` exactly as given, for results filtered elsewhere. */
  filter?: boolean;
  /** A search is in flight: a spinner in the field, placeholders in the list. */
  loading?: boolean;
  /** Shown when nothing matches. */
  empty?: ReactNode;
  /** Ids of the pages to start inside, outermost first. */
  defaultPath?: readonly string[];
  /** Called after a command runs, and by Cancel. */
  onClose?: () => void;
  cancelLabel?: string;
  /** Focus the field when it appears, raising the keyboard: on in a palette. */
  autoFocus?: boolean;
  className?: string | undefined;
};

export function Command({
  items,
  label = 'Search or run a command',
  placeholder = 'Search or type a command',
  defaultQuery = '',
  onQueryChange,
  filter = true,
  loading = false,
  empty,
  defaultPath = [],
  onClose,
  cancelLabel = 'Cancel',
  autoFocus = false,
  className,
}: CommandProps): React.JSX.Element {
  const [query, setQuery] = useState(defaultQuery);
  const [path, setPath] = useState<readonly CommandItem[]>(() => {
    const found: CommandItem[] = [];
    let level: readonly CommandItem[] = items;
    for (const id of defaultPath) {
      const next = level.find((item) => item.id === id);
      if (!next?.items) break;
      found.push(next);
      level = next.items;
    }
    return found;
  });
  const [active, setActive] = useState(0);
  const listId = useId();
  const optionId = useId();

  const page = path.at(-1);
  const results = useMemo(() => {
    const source = page?.items ?? items;
    return filter ? filterCommands(source, query) : source;
  }, [page, items, filter, query]);
  const groups = useMemo(() => groupCommands(results), [results]);
  // The flat order drives the keys: the reader arrows through the list they see.
  const flat = useMemo(() => groups.flatMap(([, list]) => list), [groups]);
  const activeItem = flat[active];

  const change = (next: string): void => {
    setQuery(next);
    setActive(0);
    onQueryChange?.(next);
  };
  const run = (item: CommandItem | undefined): void => {
    if (!item || item.disabled) return;
    if (item.items) {
      setPath([...path, item]);
      change('');
      return;
    }
    item.onSelect?.();
    onClose?.();
  };
  const back = (): void => {
    setPath(path.slice(0, -1));
    change('');
  };

  const onKeyPress = (event: {
    nativeEvent: { key: string };
    preventDefault?: () => void;
  }): void => {
    const { key } = event.nativeEvent;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault?.();
      setActive(step(flat, active, key === 'ArrowDown' ? 1 : -1));
    } else if (key === 'Enter') {
      event.preventDefault?.();
      run(activeItem);
    } else if (key === 'Backspace' && query === '' && path.length > 0) {
      back();
    }
  };

  const count = loading
    ? ''
    : flat.length === 0
      ? 'No results'
      : `${String(flat.length)} result${flat.length === 1 ? '' : 's'}`;

  return (
    <View className={cn('overflow-hidden rounded-[24px] bg-surface-raised shadow-xl', className)}>
      <View className="h-14 flex-row items-center gap-3 border-b border-border px-4">
        {page ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Back from ${page.label}`}
            onPress={back}
            hitSlop={9}
            className="h-[26px] flex-row items-center gap-1 rounded-[8px] bg-surface-sunken px-2.5"
          >
            <Icon icon={ChevronLeft} size={13} />
            <Text variant="caption" weight="semibold" className="leading-none">
              {page.label}
            </Text>
          </Pressable>
        ) : (
          <Icon icon={Search} size={20} tone="muted" />
        )}
        <TextInput
          value={query}
          onChangeText={change}
          onKeyPress={onKeyPress}
          onSubmitEditing={() => {
            run(activeItem);
          }}
          placeholder={placeholder}
          accessibilityLabel={label}
          autoFocus={autoFocus}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          {...aria({
            role: 'combobox',
            'aria-expanded': true,
            'aria-controls': listId,
            'aria-autocomplete': 'list',
            'aria-activedescendant': activeItem ? `${optionId}-${activeItem.id}` : undefined,
          })}
          className="h-full min-w-0 flex-1 p-0 text-body text-fg outline-none placeholder:text-fg-subtle"
        />
        {loading ? <Spinner size={16} label="Searching" /> : null}
        {onClose ? (
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={12} className="shrink-0">
            <Text tone="accent" weight="medium" className="text-[15px]">
              {cancelLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        nativeID={listId}
        // A named listbox only while it lists: an empty state or placeholders
        // are not options, and a name on a view with no role names nothing.
        {...(flat.length > 0 && !loading
          ? { accessibilityLabel: label, ...aria({ role: 'listbox' }) }
          : {})}
        contentContainerClassName="p-1.5"
      >
        {loading ? (
          <View className="gap-3 p-2" aria-hidden>
            {[0, 1, 2].map((row) => (
              <View key={row} className="flex-row items-center gap-3">
                <Skeleton className="size-7 rounded-[8px]" />
                <View className="flex-1 gap-1.5">
                  <Skeleton className="h-2.5 w-3/5" />
                  <Skeleton className="h-2 w-[35%]" />
                </View>
              </View>
            ))}
          </View>
        ) : flat.length === 0 ? (
          (empty ?? (
            <Text tone="muted" className="p-4 text-center">
              No results
            </Text>
          ))
        ) : (
          groups.map(([heading, list]) => (
            <View key={heading} {...aria({ role: 'group', 'aria-label': heading || undefined })}>
              {heading ? (
                <Text
                  variant="caption"
                  weight="semibold"
                  tone="subtle"
                  className="px-2.5 pt-2 pb-1 leading-none"
                  {...aria({ role: 'presentation' })}
                >
                  {heading}
                </Text>
              ) : null}
              {list.map((item) => {
                const on = item === activeItem;
                return (
                  <Pressable
                    key={item.id}
                    nativeID={`${optionId}-${item.id}`}
                    disabled={item.disabled}
                    onPress={() => {
                      run(item);
                    }}
                    onHoverIn={() => {
                      setActive(flat.indexOf(item));
                    }}
                    accessibilityLabel={
                      item.description ? `${item.label}, ${item.description}` : item.label
                    }
                    accessibilityState={{ selected: on, disabled: item.disabled ?? false }}
                    {...(WEB
                      ? aria({
                          role: 'option',
                          'aria-selected': on,
                          'aria-disabled': item.disabled,
                        })
                      : { accessibilityRole: 'button' as const })}
                    className={cn(
                      'min-h-[52px] flex-row items-center gap-3 rounded-[10px] px-2.5',
                      on && 'bg-surface-sunken',
                      item.disabled && 'opacity-50',
                    )}
                  >
                    {item.avatar ?? (
                      <View className="size-7 items-center justify-center rounded-[8px] bg-surface-sunken">
                        {item.icon ? <Icon icon={item.icon} size={15} tone="muted" /> : null}
                      </View>
                    )}
                    <View className="min-w-0 flex-1 gap-0.5">
                      <Text weight="medium" className="text-[16px] leading-[1.2]">
                        <Highlight text={item.label} query={query} />
                      </Text>
                      {item.description ? (
                        <Text variant="caption" tone="muted" className="font-normal">
                          {item.description}
                        </Text>
                      ) : null}
                    </View>
                    {item.items ? <Icon icon={ChevronRight} size={15} tone="subtle" /> : null}
                  </Pressable>
                );
              })}
            </View>
          ))
        )}
      </ScrollView>
      <Announce message={count} />
    </View>
  );
}

const Content = styled(flatStyle(DialogPrimitive.Content));
const Title = styled(flatStyle(DialogPrimitive.Title));

export type CommandPaletteProps = CommandProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Draw in the `OverlayHost` of this name instead of the root one. */
  portalHost?: string;
};

/**
 * `Command` in a modal dialog, full screen on a phone, opened from a search
 * button. The field takes focus and the keyboard rises with it.
 */
export function CommandPalette({
  open,
  onOpenChange,
  portalHost,
  onClose,
  label = 'Command palette',
  ...props
}: CommandPaletteProps): React.JSX.Element {
  const container = useOverlayContainer(portalHost);
  const insets = useSafeAreaInsets();
  const close = (): void => {
    onClose?.();
    onOpenChange(false);
  };
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {open ? (
        <DialogPrimitive.Portal
          {...(portalHost ? { hostName: portalHost } : {})}
          container={container}
        >
          <View
            className="absolute inset-0 bg-canvas"
            style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
          >
            <Content
              ref={quietFrame}
              onOpenAutoFocus={(event: Event) => {
                // The field takes focus itself (`autoFocus`), not the first tabbable.
                (event as unknown as { preventDefault: () => void }).preventDefault();
              }}
              onAccessibilityEscape={close}
              className="flex-1 outline-none"
            >
              <Title className="absolute h-px w-px overflow-hidden opacity-0">{label}</Title>
              <Command
                {...props}
                label={label}
                autoFocus
                onClose={close}
                className="flex-1 rounded-none shadow-none"
              />
            </Content>
            <BackGuard onBack={close} />
            <InertOutside />
          </View>
        </DialogPrimitive.Portal>
      ) : null}
    </DialogPrimitive.Root>
  );
}
