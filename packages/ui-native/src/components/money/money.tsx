import { Text as CssText } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { formatMoney, isNegative, type MoneyFormat } from '../../lib/money.ts';

/**
 * An amount held in minor units, as the web's `Money`: formatted for the
 * locale, always with its currency, never a float on the way to the screen.
 * Presentation only: it neither adds, converts nor rounds. Sum amounts in the
 * domain with `decimal.js` and pass the result.
 *
 * Size and weight from `className`; tabular figures, so a column of amounts
 * lines up.
 */
export type MoneyProps = MoneyFormat & {
  /** Integer amount in minor units: `"420050"` for 4,200.50. */
  minorUnits: string | bigint;
  /** ISO 4217 code: `"EUR"`. */
  currency: string;
  /** Negatives in the danger tone. Off by default: a refund is not an error. */
  signColored?: boolean;
  className?: string | undefined;
};

export function Money({
  minorUnits,
  currency,
  signColored = false,
  className,
  ...format
}: MoneyProps): React.JSX.Element {
  return (
    <CssText
      className={cn(
        'text-fg tabular-nums',
        signColored && isNegative(minorUnits) && 'text-danger-fg',
        className,
      )}
    >
      {formatMoney(minorUnits, currency, format)}
    </CssText>
  );
}
