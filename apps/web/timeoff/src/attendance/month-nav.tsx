import type { JSX } from 'react';

import { PeriodNav } from '../period';
import { monthName, shiftMonth } from './time';
import { t } from '../i18n';

/**
 * A month of a page that walks month by month (`?month=YYYY-MM`): its name,
 * and the months either side as links to the same page.
 */
export function MonthNav({
  month,
  path,
}: {
  readonly month: string;
  readonly path: string;
}): JSX.Element {
  const step = (by: number) => {
    const to = shiftMonth(month, by);
    return {
      label:
        by < 0
          ? t('attendance.month-nav.previous', 'Previous month, {{month}}', {
              month: monthName(`${to}-01`),
            })
          : t('attendance.month-nav.next', 'Next month, {{month}}', {
              month: monthName(`${to}-01`),
            }),
      href: `${path}?month=${to}`,
    };
  };
  return <PeriodNav title={monthName(`${month}-01`)} previous={step(-1)} next={step(1)} />;
}
