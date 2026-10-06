import { ChevronDown, ChevronRight, Lock, Pin, Search, type LucideIcon } from 'lucide-react-native';
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { WEB } from '../../lib/floating.tsx';
import { Icon } from '../icon/icon.tsx';
import { Input } from '../input/input.tsx';
import { List, ListItem, type IconTone } from '../list-item/list-item.tsx';
import { Text } from '../text/text.tsx';
import { NavGroup, NavItem } from './nav.tsx';

/**
 * A long list of destinations in labelled groups, as Settings is. On a phone
 * each row pushes a new screen, so there is never an indented tree: an item
 * with children is a row with a chevron, and `onSelect` opens its screen. On a
 * tablet beside the detail (`presentation="sidebar"`) it is the sidebar's
 * plainer rows.
 *
 * Searchable, collapsible, with counts, badges, pins and locks, as the web's.
 * The group holding the current item always starts open.
 */
export type GroupedNavItem = {
  id: string;
  label: string;
  icon?: LucideIcon;
  count?: number;
  /** A status: New, Required, Enterprise. */
  badge?: ReactNode;
  pinned?: boolean;
  /** Visible, but behind a plan or a permission. */
  locked?: boolean;
  disabled?: boolean;
  /** Children: on a phone, the next screen. */
  items?: readonly GroupedNavItem[];
};

export type GroupedNavGroup = {
  id: string;
  label: string;
  icon?: LucideIcon;
  items: readonly GroupedNavItem[];
};

function filterItems(items: readonly GroupedNavItem[], needle: string): GroupedNavItem[] {
  return items.flatMap((item) => {
    if (item.label.toLowerCase().includes(needle)) return [item];
    const kids = filterItems(item.items ?? [], needle);
    return kids.length > 0 ? [{ ...item, items: kids }] : [];
  });
}

/** Groups narrowed to items matching the query, keeping the parents of a nested match. */
export function filterNavGroups(
  groups: readonly GroupedNavGroup[],
  query: string,
): readonly GroupedNavGroup[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return groups;
  return groups
    .map((group) => ({ ...group, items: filterItems(group.items, needle) }))
    .filter((group) => group.items.length > 0);
}

function holds(items: readonly GroupedNavItem[], id: string | undefined): boolean {
  return id !== undefined && items.some((item) => item.id === id || holds(item.items ?? [], id));
}

/** The matched part of a label, marked as the web marks it. */
function Marked({ text, query }: { text: string; query: string }): React.JSX.Element {
  const needle = query.trim();
  const at = needle === '' ? -1 : text.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <Text className="rounded-[3px] bg-warning-subtle">{text.slice(at, at + needle.length)}</Text>
      {text.slice(at + needle.length)}
    </>
  );
}

type WebNode = {
  querySelectorAll: (selector: string) => ArrayLike<WebNode>;
  getAttribute: (name: string) => string | null;
  focus: () => void;
  click: () => void;
  tagName: string;
  ownerDocument: { activeElement: WebNode | null };
};

type WebKey = { key: string; currentTarget: unknown; preventDefault: () => void };

/**
 * With a hardware keyboard, as the web's: the arrows move between rows, left
 * and right fold and unfold a group from its heading, and "/" finds the
 * search field. Tab still walks every row.
 */
function onNavKey(event: WebKey): void {
  const root = event.currentTarget as WebNode;
  const active = root.ownerDocument.activeElement;
  const typing = active?.tagName === 'INPUT';
  if (event.key === '/' && !typing) {
    const field = root.querySelectorAll('input')[0];
    if (field) {
      event.preventDefault();
      field.focus();
    }
    return;
  }
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    const rows = Array.from(root.querySelectorAll('[tabindex="0"]'));
    const at = active ? rows.indexOf(active) : -1;
    const next = rows[event.key === 'ArrowDown' ? at + 1 : Math.max(at - 1, 0)];
    if (next) {
      event.preventDefault();
      next.focus();
    }
    return;
  }
  if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && active && !typing) {
    const expanded = active.getAttribute('aria-expanded');
    if (expanded === (event.key === 'ArrowLeft' ? 'true' : 'false')) {
      event.preventDefault();
      active.click();
    }
  }
}

export type GroupedNavProps = {
  /** Names the landmark. */
  label: string;
  groups: readonly GroupedNavGroup[];
  currentId?: string;
  onSelect?: (id: string) => void;
  /** Group headings fold their items away. */
  collapsible?: boolean;
  /** Group ids that start folded. The one holding `currentId` opens regardless. */
  defaultCollapsed?: readonly string[];
  /** Adds a search field that filters the list as the reader types. */
  searchable?: boolean;
  searchPlaceholder?: string;
  defaultQuery?: string;
  /** Where else to look, under "No matches"; or a whole empty state to show instead. */
  noResults?: ReactNode;
  /** `sidebar` beside the detail on a tablet; `list` (rows that push a screen) otherwise. */
  presentation?: 'list' | 'sidebar';
  className?: string | undefined;
};

const TONES: readonly IconTone[] = [1, 2, 3, 4, 5, 6];

export function GroupedNav({
  label,
  groups,
  currentId,
  onSelect,
  collapsible = false,
  defaultCollapsed = [],
  searchable = false,
  searchPlaceholder = 'Search',
  defaultQuery = '',
  noResults = 'Try a shorter or different word.',
  presentation = 'list',
  className,
}: GroupedNavProps): React.JSX.Element {
  const [query, setQuery] = useState(defaultQuery);
  const [closed, setClosed] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        defaultCollapsed.filter(
          (id) => !holds(groups.find((group) => group.id === id)?.items ?? [], currentId),
        ),
      ),
  );
  const shown = useMemo(() => filterNavGroups(groups, query), [groups, query]);
  const searching = query.trim() !== '';
  const sidebar = presentation === 'sidebar';

  const end = (item: GroupedNavItem, withCount: boolean): ReactNode =>
    item.pinned ||
    item.locked ||
    item.badge !== undefined ||
    (withCount && item.count !== undefined) ? (
      <View className="flex-row items-center gap-1.5">
        {item.badge}
        {withCount && item.count !== undefined ? (
          <Text variant="subhead" tone="muted" tabular>
            {String(item.count)}
          </Text>
        ) : null}
        {item.locked ? <Icon icon={Lock} size={14} tone="subtle" label="Locked" /> : null}
        {item.pinned ? <Icon icon={Pin} size={14} tone="subtle" label="Pinned" /> : null}
      </View>
    ) : null;

  return (
    <View
      {...({ role: 'navigation', 'aria-label': label } as object)}
      {...(WEB ? ({ onKeyDown: onNavKey } as object) : {})}
      className={cn(sidebar ? 'gap-1' : 'gap-[18px]', className)}
    >
      {searchable ? (
        <Input
          size={sidebar ? 'sm' : 'md'}
          value={query}
          onChangeText={setQuery}
          placeholder={searchPlaceholder}
          accessibilityLabel={searchPlaceholder}
          startAdornment={<Icon icon={Search} size={18} tone="muted" />}
          returnKeyType="go"
          onSubmitEditing={() => {
            const first = shown[0]?.items[0];
            if (first) onSelect?.(first.id);
          }}
        />
      ) : null}
      {shown.length === 0 ? (
        typeof noResults === 'string' ? (
          <View className="gap-1 px-4 py-2">
            <Text weight="semibold">No matches</Text>
            <Text variant="subhead" tone="muted">
              {noResults}
            </Text>
          </View>
        ) : (
          noResults
        )
      ) : null}
      {shown.map((group, groupIndex) => {
        // A search shows every match, folded or not.
        const open = searching || !closed.has(group.id);
        const fold = (next: boolean): void => {
          const set = new Set(closed);
          if (next) set.delete(group.id);
          else set.add(group.id);
          setClosed(set);
        };
        if (sidebar) {
          return (
            <NavGroup
              key={group.id}
              label={group.label}
              icon={collapsible ? group.icon : undefined}
              compact
              collapsible={collapsible}
              open={open}
              onOpenChange={fold}
              count={group.items.length}
            >
              {group.items.map((item) => (
                <NavItem
                  key={item.id}
                  compact
                  icon={item.icon}
                  count={item.count}
                  current={item.id === currentId}
                  disabled={item.disabled}
                  end={end(item, false)}
                  rendered={<Marked text={item.label} query={query} />}
                  onPress={() => onSelect?.(item.id)}
                >
                  {item.label}
                </NavItem>
              ))}
            </NavGroup>
          );
        }
        return (
          <View key={group.id} className="gap-1.5">
            {collapsible ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                aria-expanded={open}
                onPress={() => {
                  fold(!open);
                }}
                // Drawn at the heading's size; the slop makes it a full tap target.
                hitSlop={{ top: 14, bottom: 14 }}
                className="flex-row items-center justify-between px-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus"
              >
                <Text variant="footnote" weight="medium" tone="muted">
                  {group.label}
                </Text>
                <Icon icon={open ? ChevronDown : ChevronRight} size={15} tone="muted" />
              </Pressable>
            ) : (
              <View accessibilityRole="header" className="px-4">
                <Text variant="footnote" weight="medium" tone="muted">
                  {group.label}
                </Text>
              </View>
            )}
            {open ? (
              <List>
                {group.items.map((item, index) => {
                  // Each group starts one colour on, so the first tiles differ.
                  const tone = TONES[(index + groupIndex) % TONES.length] ?? 1;
                  return (
                    <ListItem
                      key={item.id}
                      {...(item.icon ? { icon: item.icon, iconTone: tone } : {})}
                      selected={item.id === currentId}
                      disabled={item.disabled ?? false}
                      chevron
                      trailing={end(item, true)}
                      className="min-h-[52px] focus-visible:bg-surface-sunken focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus"
                      onPress={() => onSelect?.(item.id)}
                      accessibilityLabel={[
                        item.label,
                        item.count === undefined ? null : String(item.count),
                        item.locked ? 'locked' : null,
                        item.pinned ? 'pinned' : null,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                    >
                      <Text weight="medium">
                        <Marked text={item.label} query={query} />
                      </Text>
                    </ListItem>
                  );
                })}
              </List>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
