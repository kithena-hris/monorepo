import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Text as CssText, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { Card } from '../card/card.tsx';
import { Icon } from '../icon/icon.tsx';
import { Text } from '../text/text.tsx';

/**
 * One number with context, as the web's `Stat`. Direction and sentiment are
 * separate: fewer leavers is down, and that is good, so the arrow follows the
 * number and the colour follows what it means.
 */

export type StatSentiment = 'positive' | 'negative' | 'neutral';

export type StatProps = {
  label: string;
  /** The figure: text, or `Money`. */
  value: ReactNode;
  /** After the value, half its size: `%`, `days`. */
  unit?: string;
  /**
   * The value before a change, printed small ahead of an arrow: "18 → 13".
   * For a preview of what an action will do, not a trend over time (that is
   * `delta`).
   */
  from?: ReactNode;
  /** The change: "+12 this quarter". */
  delta?: string;
  /** What the delta is measured against, quieter after it: "on August". */
  deltaLabel?: string;
  /** Which way the number moved. Flat by default. */
  direction?: 'up' | 'down' | 'flat';
  /** Whether that is good. Neutral by default: a change is not always news. */
  sentiment?: StatSentiment;
  /** A `Sparkline`, beside the value. */
  chart?: ReactNode;
  /** A line under the change. */
  description?: ReactNode;
  /** An `Icon` at the label's end. */
  icon?: ReactNode;
  /**
   * A tile inside a card: on the card's sunken fill with no shadow of its
   * own, so it reads as part of the card rather than a second card on top.
   */
  inset?: boolean;
  /** Full width under the value, before the delta: a meter of what the number is out of. */
  children?: ReactNode;
  /** The value's size, in points. 30 by default; 28 in a narrow column. */
  size?: number;
  className?: string | undefined;
};

const ARROW = { up: ArrowUpRight, down: ArrowDownRight, flat: ArrowRight } as const;
const TONE = { positive: 'success', negative: 'danger', neutral: 'muted' } as const;
const WORD = { up: 'up', down: 'down', flat: 'unchanged' } as const;

export function Stat({
  label,
  value,
  unit,
  from,
  delta,
  deltaLabel,
  direction = 'flat',
  sentiment = 'neutral',
  chart,
  description,
  icon,
  inset = false,
  children,
  size = 30,
  className,
}: StatProps): React.JSX.Element {
  const tone = TONE[sentiment];
  return (
    <Card variant={inset ? 'fill' : 'raised'} className={cn('min-w-0', className)}>
      <View className="flex-row items-start justify-between gap-2">
        <Text variant="subhead" weight="medium" tone="muted" className="shrink">
          {label}
        </Text>
        {icon}
      </View>
      <View className="min-w-0 flex-row flex-wrap items-end justify-between gap-x-3 gap-y-2">
        <CssText
          className="shrink-0 leading-[1.05] font-bold tracking-[-0.03em] text-fg tabular-nums"
          style={{ fontSize: size }}
        >
          {from === undefined ? null : (
            <CssText
              accessibilityLabel="from"
              className="font-semibold tracking-normal text-fg-muted"
              style={{ fontSize: size * 0.55 }}
            >
              {from}
              {' → '}
            </CssText>
          )}
          {value}
          {unit ? (
            <CssText
              className="tracking-normal text-fg-muted"
              style={{ fontSize: size / 2 }}
            >{` ${unit}`}</CssText>
          ) : null}
        </CssText>
        {chart}
      </View>
      {children}
      {delta ? (
        <View
          accessible
          accessibilityLabel={`${WORD[direction]}: ${delta}${deltaLabel ? ` ${deltaLabel}` : ''}`}
          className="flex-row items-center gap-1"
        >
          <Icon icon={ARROW[direction]} size={14} tone={tone} />
          <Text variant="footnote" weight="semibold" tone={tone} className="leading-[1.2]">
            {delta}
          </Text>
          {deltaLabel ? (
            <Text
              variant="footnote"
              tone="muted"
              numberOfLines={1}
              className="shrink leading-[1.2]"
            >
              {deltaLabel}
            </Text>
          ) : null}
        </View>
      ) : null}
      {typeof description === 'string' ? (
        <Text variant="subhead" tone="muted" className="leading-[1.5]">
          {description}
        </Text>
      ) : (
        description
      )}
    </Card>
  );
}
