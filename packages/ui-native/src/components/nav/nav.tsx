import { ChevronDown, ChevronRight, ChevronUp, type LucideIcon } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { Icon } from '../icon/icon.tsx';
import { Text } from '../text/text.tsx';

/**
 * Section navigation: a list of places, the current one marked. On a phone
 * the top-level sections live in the tab bar; this is for the sidebar of a
 * tablet, a drawer, or the sections inside one area.
 */
export function Nav({
  label,
  children,
  className,
}: {
  /** Names the landmark: "Main", "Settings". */
  label: string;
  children?: ReactNode;
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <View
      {...({ role: 'navigation', 'aria-label': label } as object)}
      className={cn('w-full gap-0.5', className)}
    >
      {children}
    </View>
  );
}

export type NavItemProps = {
  children: string;
  icon?: LucideIcon | undefined;
  /** A second line: what is there. */
  description?: string | undefined;
  /** How many are waiting there. */
  count?: number | undefined;
  /** Something at the end other than a count: a badge, a lock, a pin. */
  end?: ReactNode;
  /** The page you are on: `aria-current`, and the accent. */
  current?: boolean | undefined;
  /** It opens a further list, as a row in a drill-down does. */
  chevron?: boolean | undefined;
  /** 2 indents it under a parent, 3 further. */
  level?: 1 | 2 | 3;
  disabled?: boolean | undefined;
  /** Drawn smaller, for a narrow sidebar beside the detail. */
  compact?: boolean | undefined;
  onPress?: (() => void) | undefined;
  /** The label as drawn, when it is more than text (a search match marked). */
  rendered?: ReactNode;
};

const indent = { 1: 'pl-2.5', 2: 'pl-[34px]', 3: 'pl-[52px]' } as const;

export function NavItem({
  children,
  icon,
  description,
  count,
  end,
  current = false,
  chevron = false,
  level = 1,
  disabled = false,
  compact = false,
  onPress,
  rendered,
}: NavItemProps): React.JSX.Element {
  const tone = disabled ? 'disabled' : current ? 'accent' : 'default';
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityState={{ selected: current, disabled }}
      accessibilityLabel={count === undefined ? children : `${children}, ${String(count)}`}
      {...(current ? ({ 'aria-current': 'page' } as object) : {})}
      disabled={disabled}
      {...(onPress ? { onPress } : {})}
      className={cn(
        'flex-row items-center gap-2.5 rounded-[12px] pr-2.5',
        indent[level],
        compact ? 'min-h-[34px]' : description ? 'min-h-[52px] py-2' : 'min-h-12',
        current ? 'bg-accent-subtle' : 'active:bg-surface-sunken',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus',
      )}
    >
      {icon ? (
        <Icon
          icon={icon}
          size={compact ? 14 : 18}
          tone={current ? 'accent' : disabled ? 'disabled' : 'muted'}
        />
      ) : null}
      <View className="min-w-0 flex-1 gap-0.5">
        <Text
          tone={tone}
          weight={current ? 'semibold' : 'medium'}
          numberOfLines={1}
          className={cn(compact ? 'text-[12px]' : 'text-[16px]', 'leading-[1.3]')}
        >
          {rendered ?? children}
        </Text>
        {description ? (
          <Text variant="caption" tone="muted" className="font-normal">
            {description}
          </Text>
        ) : null}
      </View>
      {end}
      {count === undefined ? null : (
        <View
          className={cn(
            'h-5 min-w-5 items-center justify-center rounded-full px-1.5',
            current ? 'bg-accent' : 'bg-surface-active',
          )}
        >
          <Text
            tone={current ? 'on-accent' : 'muted'}
            weight="bold"
            tabular
            className="text-[11px] leading-5"
          >
            {String(count)}
          </Text>
        </View>
      )}
      {chevron ? <Icon icon={ChevronRight} size={15} tone="subtle" /> : null}
    </Pressable>
  );
}

export type NavGroupProps = {
  /** The heading. */
  label: string;
  /** The heading folds the group's items away. */
  collapsible?: boolean;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Shown beside the heading while folded: how many are inside. */
  count?: number;
  icon?: LucideIcon | undefined;
  compact?: boolean;
  children?: ReactNode;
};

/** A labelled group of items; collapsible ones fold away under their heading. */
export function NavGroup({
  label,
  collapsible = false,
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  count,
  icon,
  compact = false,
  children,
}: NavGroupProps): React.JSX.Element {
  const [own, setOwn] = useState(defaultOpen);
  const open = openProp ?? own;
  const heading = (
    <>
      {icon ? <Icon icon={icon} size={13} tone="subtle" /> : null}
      <Text
        variant="caption"
        weight="semibold"
        tone="subtle"
        className={cn('flex-1 leading-none', compact && 'text-[11px]')}
      >
        {label}
      </Text>
      {collapsible && !open && count !== undefined ? (
        <Text variant="caption" tone="subtle" tabular className="leading-none">
          {String(count)}
        </Text>
      ) : null}
      {collapsible ? <Icon icon={open ? ChevronUp : ChevronDown} size={14} tone="subtle" /> : null}
    </>
  );
  return (
    <View className="gap-0.5">
      {collapsible ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          aria-expanded={open}
          onPress={() => {
            setOwn(!open);
            onOpenChange?.(!open);
          }}
          className="min-h-m-tap flex-row items-center gap-2 px-2.5 pt-3.5 pb-1.5"
        >
          {heading}
        </Pressable>
      ) : (
        <View
          accessibilityRole="header"
          className="flex-row items-center gap-2 px-2.5 pt-3.5 pb-1.5"
        >
          {heading}
        </View>
      )}
      {open ? children : null}
    </View>
  );
}
