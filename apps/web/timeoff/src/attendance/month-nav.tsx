import { Button, icons } from '@reach/ui';
import type { JSX } from 'react';

import { monthName, shiftMonth } from './time';

/** The month before and after (`YYYY-MM`) as links to the same page, `?month=` in the address. */
export function MonthNav({
  month,
  path,
}: {
  readonly month: string;
  readonly path: string;
}): JSX.Element {
  const link = (by: number): JSX.Element => {
    const to = shiftMonth(month, by);
    return <a href={`${path}?month=${to}`}>{monthName(`${to}-01`)}</a>;
  };
  return (
    <nav aria-label="Month" className="flex items-center gap-2">
      <Button asChild size="sm" variant="ghost" startIcon={<icons.previous aria-hidden />}>
        {link(-1)}
      </Button>
      <Button asChild size="sm" variant="ghost" endIcon={<icons.next aria-hidden />}>
        {link(1)}
      </Button>
    </nav>
  );
}
