import { PageSection } from '@reach/ui';
import type { JSX } from 'react';

/**
 * HR's view of somebody's employment (PEO-119): whose day it is for them,
 * which every lifecycle move runs on (PRD §6.8). Only HR is sent it; anybody
 * else's profile has no such section, not an empty one.
 */
export interface EmploymentState {
  readonly calendar: { readonly today: string; readonly timeZone: string };
}

export function Employment({ state }: { readonly state: EmploymentState }): JSX.Element {
  return (
    <PageSection surface title="Employment">
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[minmax(10rem,auto)_1fr]">
        <dt className="text-sm text-fg-muted">Their day</dt>
        <dd className="text-sm" data-testid="their-day">
          {state.calendar.today} ({state.calendar.timeZone})
        </dd>
      </dl>
    </PageSection>
  );
}
