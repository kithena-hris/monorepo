import { Fragment, type ReactNode } from 'react';
import { Text as CssText, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';

/**
 * Label and value pairs for a record's details, as the web's `KeyValues`:
 * the key quiet on the left, the value clear on the right, a hairline
 * between pairs. A value may be text or anything else (an avatar and a name,
 * a badge, a link, `Money`).
 */

export type KeyValue = {
  label: string;
  value: ReactNode;
};

export type KeyValuesProps = {
  items: readonly KeyValue[];
  className?: string | undefined;
};

export function KeyValues({ items, className }: KeyValuesProps): React.JSX.Element {
  return (
    <View role="list" className={cn(className)}>
      {items.map(({ label, value }, i) => (
        <Fragment key={label}>
          {i > 0 ? <View aria-hidden className="h-px bg-border" /> : null}
          <View
            role="listitem"
            className="min-h-[52px] flex-row items-center justify-between gap-4 py-2.5"
          >
            <CssText className="shrink-0 text-callout leading-[1.4] text-fg-muted">{label}</CssText>
            {typeof value === 'string' || typeof value === 'number' ? (
              <CssText
                selectable
                className="shrink text-right text-callout leading-[1.4] font-medium text-fg"
              >
                {value}
              </CssText>
            ) : (
              <View className="min-w-0 shrink flex-row items-center justify-end gap-1.5">
                {value}
              </View>
            )}
          </View>
        </Fragment>
      ))}
    </View>
  );
}
