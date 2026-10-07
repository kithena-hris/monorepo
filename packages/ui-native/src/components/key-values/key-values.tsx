import { Fragment, type ReactNode } from 'react';
import { Text as CssText, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';

/**
 * Label and value pairs for a record's details, as the web's `KeyValues`. A
 * value may be text or anything else (an avatar and a name, a badge, a link,
 * `Money`).
 *
 * Two layouts on a phone. `split` (the default here) puts the key quiet on the
 * left and the value clear on the right, a hairline between pairs: how a phone
 * lists settings, and what the web's `aligned` becomes under a finger.
 * `stacked` puts each label above its value, for values long enough to wrap.
 */

export type KeyValueItem = {
  /** Stable key. Defaults to the label when the label is a string. */
  id?: string;
  label: ReactNode;
  value: ReactNode;
};

export type KeyValuesProps = {
  items: readonly KeyValueItem[];
  /** `aligned` is `split` on a phone: a fixed label column would leave the values a sliver. */
  layout?: 'stacked' | 'aligned' | 'split';
  className?: string | undefined;
};

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

export function KeyValues({ items, layout = 'split', className }: KeyValuesProps): React.JSX.Element {
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
