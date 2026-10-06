import {
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Ellipsis,
  type LucideIcon,
} from 'lucide-react-native';
import { Fragment, type ReactNode } from 'react';
import { Pressable, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../dropdown-menu/dropdown-menu.tsx';
import { Icon } from '../icon/icon.tsx';
import { Text } from '../text/text.tsx';

/**
 * Where you are in a hierarchy: every item but the last is a link. On a
 * phone the trail rarely fits, so `maxItems` folds the middle into a menu
 * behind "…", and a pushed screen usually needs only its back link
 * (`BreadcrumbBack`, or the app bar's own back).
 */
export type BreadcrumbItem = {
  label: string;
  /** Goes there. The last item is the page you are on and takes none. */
  onPress?: () => void;
  icon?: LucideIcon;
  /**
   * The item opens a menu of its siblings instead of linking: the rows of a
   * `DropdownMenuContent` (items, radio items, checkbox items).
   */
  menu?: ReactNode;
};

export type BreadcrumbProps = {
  items: readonly BreadcrumbItem[];
  separator?: 'chevron' | 'slash' | 'dot';
  /**
   * Fold the middle into "…" beyond this many, keeping the first and the
   * last `maxItems - 2`. At least 3.
   */
  maxItems?: number;
  /** Names the landmark. */
  label?: string;
  className?: string | undefined;
};

function Separator({ kind }: { kind: 'chevron' | 'slash' | 'dot' }): React.JSX.Element {
  return kind === 'chevron' ? (
    <Icon icon={ChevronRight} size={14} tone="subtle" />
  ) : (
    <Text variant="subhead" tone="subtle" aria-hidden>
      {kind === 'slash' ? '/' : '·'}
    </Text>
  );
}

const link =
  'rounded-[6px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-border-focus';

function Crumb({ item, last }: { item: BreadcrumbItem; last: boolean }): React.JSX.Element {
  const label = (
    <>
      {item.icon ? <Icon icon={item.icon} size={14} tone={last ? 'default' : 'muted'} /> : null}
      <Text
        variant="subhead"
        weight={last ? 'semibold' : 'medium'}
        tone={last ? 'default' : 'muted'}
        numberOfLines={1}
        className={cn('leading-[1.3]', last && 'shrink')}
      >
        {item.label}
      </Text>
    </>
  );
  if (item.menu) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.label}, choose another`}
            className={cn(
              'h-7 shrink-0 flex-row items-center gap-1 rounded-[8px] bg-surface-sunken px-2',
              link,
            )}
          >
            {label}
            <Icon icon={ChevronsUpDown} size={13} tone="muted" />
          </Pressable>
        </DropdownMenuTrigger>
        <DropdownMenuContent label={item.label}>{item.menu}</DropdownMenuContent>
      </DropdownMenu>
    );
  }
  if (last) {
    return (
      <View
        {...({ 'aria-current': 'page' } as object)}
        className="min-w-0 shrink flex-row items-center gap-1"
      >
        {label}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="link"
      {...(item.onPress ? { onPress: item.onPress } : {})}
      className={cn('shrink-0 flex-row items-center gap-1', link)}
    >
      {label}
    </Pressable>
  );
}

/** The folded middle: "…", which opens the items it hides. */
function Folded({ items }: { items: readonly BreadcrumbItem[] }): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${String(items.length)} more`}
          className={cn(
            'h-6 w-7 shrink-0 items-center justify-center rounded-[8px] bg-surface-sunken',
            link,
          )}
        >
          <Icon icon={Ellipsis} size={15} tone="muted" />
        </Pressable>
      </DropdownMenuTrigger>
      <DropdownMenuContent label="Hidden levels">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.label}
            {...(item.icon ? { icon: item.icon } : {})}
            {...(item.onPress ? { onSelect: item.onPress } : {})}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Breadcrumb({
  items,
  separator = 'chevron',
  maxItems,
  label = 'Breadcrumb',
  className,
}: BreadcrumbProps): React.JSX.Element {
  const keep = maxItems === undefined ? items.length : Math.max(3, maxItems);
  const fold = items.length > keep;
  const tail = fold ? items.slice(items.length - (keep - 2)) : [];
  const shown: readonly (BreadcrumbItem | 'folded')[] = fold
    ? [items[0] as BreadcrumbItem, 'folded', ...tail]
    : items;
  const hidden = fold ? items.slice(1, items.length - (keep - 2)) : [];
  return (
    <View
      {...({ role: 'navigation', 'aria-label': label } as object)}
      className={cn('min-w-0 flex-row items-center gap-1.5 overflow-hidden', className)}
    >
      {shown.map((item, index) => {
        const last = index === shown.length - 1;
        return (
          <Fragment key={item === 'folded' ? '…' : `${item.label}-${String(index)}`}>
            {item === 'folded' ? <Folded items={hidden} /> : <Crumb item={item} last={last} />}
            {last ? null : <Separator kind={separator} />}
          </Fragment>
        );
      })}
    </View>
  );
}

/** All that is left of the trail on a pushed screen: back to the parent. */
export function BreadcrumbBack({
  label,
  onPress,
  className,
}: {
  /** The parent's name: "Platform". */
  label: string;
  onPress: () => void;
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Back to ${label}`}
      onPress={onPress}
      className={cn('min-h-m-tap flex-row items-center gap-1 self-start', link, className)}
    >
      <Icon icon={ChevronLeft} size={18} tone="accent" />
      <Text variant="subhead" weight="medium" tone="accent">
        {label}
      </Text>
    </Pressable>
  );
}
