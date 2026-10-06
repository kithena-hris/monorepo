import type { ReactNode } from 'react';
import { View } from 'react-native-css/components';

import { Icon, type LucideIcon } from '../components/icon/icon.tsx';
import { Text } from '../components/text/text.tsx';
import { cn } from './cn.ts';

/*
 * How a menu row looks on a phone: Dropdown menu, Context menu, a hover
 * card's actions, and lane A's Select list. 48 points tall (above the 44-point
 * floor), a 20-point icon, the label at body size. Shared so every list that
 * pops over the page reads as one.
 */

/** The surface rows sit on: the floating surface, with a little inset. */
export const menuSurface = 'rounded-[20px] bg-surface-raised p-1.5 shadow-lg';

/** A row, as a pressable. `highlighted` is the pressed or keyboard-active row. */
export function menuRowClass({
  highlighted = false,
  disabled = false,
}: {
  highlighted?: boolean;
  disabled?: boolean;
} = {}): string {
  return cn(
    'min-h-12 flex-row items-center gap-2.5 rounded-[14px] px-3 py-2 outline-none',
    highlighted && 'bg-surface-sunken',
    !disabled && 'active:bg-surface-sunken hover:bg-surface-sunken focus:bg-surface-sunken',
  );
}

export type MenuRowContentProps = {
  icon?: LucideIcon | undefined;
  /** A leading slot instead of an icon: a check, a radio dot, an avatar. */
  lead?: ReactNode;
  /** Deletes or loses something: red. */
  destructive?: boolean | undefined;
  disabled?: boolean | undefined;
  /** A second line: what it does, or why it cannot be done now. */
  description?: string | undefined;
  /** Something at the end: a count, a chevron. */
  end?: ReactNode;
  children?: ReactNode;
};

/** What goes inside a row: the lead, the label and its second line, the end. */
export function MenuRowContent({
  icon,
  lead,
  destructive = false,
  disabled = false,
  description,
  end,
  children,
}: MenuRowContentProps): React.JSX.Element {
  const tone = disabled ? 'disabled' : destructive ? 'danger' : 'default';
  return (
    <>
      {lead ??
        (icon ? (
          <Icon
            icon={icon}
            size={20}
            tone={disabled ? 'disabled' : destructive ? 'danger' : 'muted'}
          />
        ) : null)}
      <View className="min-w-0 flex-1 gap-0.5">
        <Text tone={tone} className="leading-[1.3]">
          {children}
        </Text>
        {description ? (
          <Text variant="caption" tone="muted" className="font-normal">
            {description}
          </Text>
        ) : null}
      </View>
      {end}
    </>
  );
}

/** A rule between groups of rows. */
export function MenuSeparator(): React.JSX.Element {
  return <View aria-hidden className="mx-3 my-1.5 h-px bg-border" />;
}

/** A group's heading. */
export function MenuHeading({ children }: { children: string }): React.JSX.Element {
  return (
    <Text variant="caption" weight="semibold" tone="subtle" className="px-2.5 pt-2 pb-1">
      {children}
    </Text>
  );
}
