import { Fragment, type ReactNode } from 'react';
import { Text as CssText, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { Icon, type LucideIcon } from '../icon/icon.tsx';

/**
 * Label and value pairs for a record's details, as the web's `KeyValues`. A
 * value may be text or anything else (an avatar and a name, a badge, a link,
 * `Money`).
 *
 * Two layouts on a phone. `split` (the default here) puts the key quiet on the
 * left and the value clear on the right, a hairline between pairs: how a phone
 * lists settings, and what the web's `aligned` becomes under a finger.
 * `stacked` puts each label above its value, for values long enough to wrap.
 * `detail` is a record read at a glance: a glyph in a tile, a small grey
 * label, and the value large under it, so the answer is what the eye lands
 * on; anything about the value (a pending change, why it was refused) sits
 * under it, and an action at the end of the row.
 */

type Tone = 'neutral' | 'danger' | 'warning' | 'accent';

const TILE: Record<Tone, string> = {
  neutral: 'bg-surface-sunken',
  danger: 'bg-danger-subtle',
  warning: 'bg-warning-subtle',
  accent: 'bg-accent-subtle',
};

export type KeyValueItem = {
  /** Stable key. Defaults to the label when the label is a string. */
  id?: string;
  label: ReactNode;
  value: ReactNode;
  /** `detail`: the glyph in the row's tile. */
  icon?: LucideIcon;
  /** `detail`: the tile's wash, for a value that is refused or waits. */
  tone?: Tone;
  /** `detail`: beside the label, a `Badge`. */
  badge?: ReactNode;
  /** `detail`: under the value. */
  below?: ReactNode;
  /** `detail`: at the end of the row, a `Button`. */
  trailing?: ReactNode;
  /** `detail`: the value is not there yet, in the quiet ink. */
  empty?: boolean;
};

export type KeyValuesProps = {
  items: readonly KeyValueItem[];
  /** `aligned` is `split` on a phone: a fixed label column would leave the values a sliver. */
  layout?: 'stacked' | 'aligned' | 'split' | 'detail';
  className?: string | undefined;
};

const TONE_GLYPH = { neutral: 'muted', danger: 'danger', warning: 'warning', accent: 'accent' } as const;

const keyOf = (item: KeyValueItem, index: number): string =>
  item.id ?? (typeof item.label === 'string' ? item.label : String(index));

/** Text in the given class, anything else as it is. */
function Part({ children, className }: { children: ReactNode; className: string }) {
  return typeof children === 'string' || typeof children === 'number' ? (
    <CssText selectable className={className}>
      {children}
    </CssText>
  ) : (
    <>{children}</>
  );
}

export function KeyValues({
  items,
  layout = 'split',
  className,
}: KeyValuesProps): React.JSX.Element {
  if (layout === 'detail') {
    return (
      <View role="list" className={cn(className)}>
        {items.map((item, i) => (
          <View key={keyOf(item, i)} role="listitem" className="flex-row items-start gap-3.5 pl-4">
            <View
              aria-hidden
              className={cn(
                'mt-3.5 size-9 items-center justify-center rounded-[11px]',
                TILE[item.tone ?? 'neutral'],
              )}
            >
              {item.icon ? (
                <Icon icon={item.icon} size={17} tone={TONE_GLYPH[item.tone ?? 'neutral']} />
              ) : null}
            </View>
            <View
              className={cn(
                'min-w-0 flex-1 flex-row items-center gap-2.5 py-3.5 pr-4',
                i < items.length - 1 && 'border-b border-border',
              )}
            >
              <View className="min-w-0 flex-1 gap-1">
                <View className="flex-row flex-wrap items-center gap-1.5">
                  <Part className="text-[13px] font-medium leading-[1.2] text-fg-subtle">
                    {item.label}
                  </Part>
                  {item.badge}
                </View>
                <Part
                  className={cn(
                    'text-[17px] leading-[1.35]',
                    item.empty ? 'font-medium text-fg-subtle' : 'font-semibold text-fg',
                  )}
                >
                  {item.value}
                </Part>
                {item.below}
              </View>
              {item.trailing}
            </View>
          </View>
        ))}
      </View>
    );
  }
  if (layout === 'stacked') {
    return (
      <View role="list" className={cn('gap-3', className)}>
        {items.map((item, i) => (
          <View key={keyOf(item, i)} role="listitem" className="min-w-0 gap-0.5">
            <Part className="text-footnote leading-[1.4] text-fg-muted">{item.label}</Part>
            <View className="min-w-0 flex-row flex-wrap items-center gap-1.5">
              <Part className="text-callout leading-[1.4] font-medium text-fg tabular-nums">
                {item.value}
              </Part>
            </View>
          </View>
        ))}
      </View>
    );
  }
  return (
    <View role="list" className={cn(className)}>
      {items.map((item, i) => (
        <Fragment key={keyOf(item, i)}>
          {i > 0 ? <View aria-hidden className="h-px bg-border" /> : null}
          <View
            role="listitem"
            className="min-h-[52px] flex-row items-center justify-between gap-4 py-2.5"
          >
            <View className="shrink-0">
              <Part className="text-callout leading-[1.4] text-fg-muted">{item.label}</Part>
            </View>
            {typeof item.value === 'string' || typeof item.value === 'number' ? (
              <CssText
                selectable
                className="shrink text-right text-callout leading-[1.4] font-medium text-fg tabular-nums"
              >
                {item.value}
              </CssText>
            ) : (
              <View className="min-w-0 shrink flex-row items-center justify-end gap-1.5">
                {item.value}
              </View>
            )}
          </View>
        </Fragment>
      ))}
    </View>
  );
}
