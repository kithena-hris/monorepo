import { Button, cn, icons } from '@reach/ui';
import type { JSX, ReactNode } from 'react';

import { t } from './i18n';

/** One step of a period: a link the host follows, or a press the screen handles. */
export interface Step {
  readonly label: string;
  readonly href?: string;
  readonly onPress?: () => void;
}

function stepButton(step: Step, icon: ReactNode): JSX.Element {
  return step.href === undefined ? (
    <Button
      size="sm"
      variant="ghost"
      aria-label={step.label}
      startIcon={icon}
      onClick={step.onPress}
    />
  ) : (
    <Button asChild size="sm" variant="ghost" aria-label={step.label} startIcon={icon}>
      <a href={step.href} />
    </Button>
  );
}

/**
 * The period a page shows and the way to the ones either side: "Today ‹ ›
 * October 2026". Every Time Off page that walks through time (the calendar,
 * a week of a timesheet, a month of exceptions or a pay period) draws it the
 * same way, at the start of its toolbar row.
 */
export function PeriodNav({
  title,
  previous,
  next,
  today,
  className,
}: {
  readonly title: ReactNode;
  readonly previous: Step;
  readonly next: Step;
  /** Back to the period that holds today, where that is somewhere else. */
  readonly today?: Step;
  readonly className?: string;
}): JSX.Element {
  return (
    <nav
      aria-label={t('period.period', 'Period')}
      className={cn('flex min-w-0 items-center gap-1', className)}
    >
      {today === undefined ? null : today.href === undefined ? (
        <Button size="sm" className="me-1" onClick={today.onPress}>
          {today.label}
        </Button>
      ) : (
        <Button asChild size="sm" className="me-1">
          <a href={today.href}>{today.label}</a>
        </Button>
      )}
      {stepButton(previous, <icons.previous aria-hidden />)}
      {stepButton(next, <icons.next aria-hidden />)}
      <h2 className="ms-1 truncate font-display text-lg font-bold text-fg tabular-nums">{title}</h2>
    </nav>
  );
}
