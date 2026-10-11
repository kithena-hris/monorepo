import type { ReactNode } from 'react';
import { Pressable, Text as CssText, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';

/**
 * A short run of days side by side, each a tile with its day, one number
 * and a line under it: a team's week at a glance. Today is tinted; a day
 * that needs a look (below a minimum) is outlined in the warning ink, its
 * number too. Each tile opens what is behind its number.
 */

export type DayTile = {
  id: string;
  /** "Mon". */
  label: string;
  /** "6": how many are in. */
  value: string;
  /** Under the number: an `AvatarGroup` of who is out, or a word. */
  footer?: ReactNode;
  /** What a screen reader hears for the tile: "Wednesday, 4 in, below the minimum". */
  accessibilityLabel?: string;
  today?: boolean;
  attention?: boolean;
};

export type DayTilesProps = {
  days: readonly DayTile[];
  onPress?: (id: string) => void;
  className?: string | undefined;
};

export function DayTiles({ days, onPress, className }: DayTilesProps): React.JSX.Element {
  return (
    <View role="list" className={cn('flex-row gap-1.5', className)}>
      {days.map((d) => (
        <Pressable
          key={d.id}
          role="listitem"
          accessibilityRole={onPress ? 'button' : undefined}
          {...(d.accessibilityLabel ? { accessibilityLabel: d.accessibilityLabel } : {})}
          disabled={!onPress}
          onPress={() => onPress?.(d.id)}
          className={cn(
            'min-w-0 flex-1 items-center gap-1.5 rounded-[16px] px-1 py-2.5',
            d.today ? 'bg-accent-subtle' : 'bg-surface shadow-sm',
            d.attention && 'border-[1.5px] border-warning-fg',
          )}
        >
          <CssText
            className={cn(
              'text-[12px] font-semibold leading-none',
              d.today ? 'text-accent-fg' : 'text-fg-subtle',
            )}
          >
            {d.label}
          </CssText>
          <CssText
            className={cn(
              'text-[18px] font-bold leading-none tabular-nums',
              d.attention ? 'text-warning-fg' : 'text-fg',
            )}
          >
            {d.value}
          </CssText>
          <View className="h-6 items-center justify-center">
            {typeof d.footer === 'string' ? (
              <CssText className="text-[11px] font-medium leading-none text-fg-subtle">
                {d.footer}
              </CssText>
            ) : (
              d.footer
            )}
          </View>
        </Pressable>
      ))}
    </View>
  );
}
