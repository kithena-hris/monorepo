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
  /** The change: "+12 this quarter". */
  delta?: string;
  /** Which way the number moved. Up by default. */
  direction?: 'up' | 'down' | 'flat';
  /** Whether that is good. Neutral by default: a change is not always news. */
  sentiment?: StatSentiment;
  /** A `Sparkline`, beside the value. */
  chart?: ReactNode;
  /** A line under the change. */
  description?: string;
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
  delta,
  direction = 'up',
  sentiment = 'neutral',
  chart,
  description,
  size = 30,
  className,
}: StatProps): React.JSX.Element {
  const tone = TONE[sentiment];
  return (
    <Card className={cn('min-w-0', className)}>
      <Text variant="subhead" weight="medium" tone="muted">
        {label}
      </Text>
      <View className="min-w-0 flex-row flex-wrap items-end justify-between gap-x-3 gap-y-2">
        <CssText
          className="shrink-0 leading-[1.05] font-bold tracking-[-0.03em] text-fg tabular-nums"
          style={{ fontSize: size }}
        >
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
      {delta ? (
        <View
          accessible
          accessibilityLabel={`${WORD[direction]}: ${delta}`}
          className="flex-row items-center gap-1"
        >
          <Icon icon={ARROW[direction]} size={14} tone={tone} />
          <Text variant="footnote" weight="semibold" tone={tone} className="leading-[1.2]">
            {delta}
          </Text>
        </View>
      ) : null}
      {description ? (
        <Text variant="subhead" tone="muted" className="leading-[1.5]">
          {description}
        </Text>
      ) : null}
    </Card>
  );
}
