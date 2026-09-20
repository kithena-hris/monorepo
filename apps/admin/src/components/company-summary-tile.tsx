import { icons } from '@reach/ui';
import type { JSX } from 'react';

const PeopleIcon = icons.people;
const PendingIcon = icons.pending;
const PersonIcon = icons.person;
const CalendarIcon = icons.calendar;

/**
 * One card, holding what an operator opens a company to glance at.
 *
 * It was four. Four cards carry four numbers and no relationship between them,
 * take a full row each on a phone, and push the reason anybody came here below
 * the fold. Grouped, they read as one sentence about one company.
 *
 * `dl` rather than four boxes: these describe the same subject, and a
 * definition list is what that is. The weather deliberately does not live here
 * — it belongs on the card about the place, which is `AddressCard`.
 */
export interface CompanySummaryTileProps {
  readonly companyName: string;
  readonly createdAt: string;
  readonly counts: {
    readonly active: number;
    readonly invited: number;
    readonly other: number;
  };
}

export function CompanySummaryTile({
  companyName,
  createdAt,
  counts,
}: CompanySummaryTileProps): JSX.Element {
  return (
    <section
      aria-label={`${companyName} at a glance`}
      className="border-border bg-surface rounded-xl border p-5 sm:p-6"
    >
      <dl className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4">
        <Figure icon={<PeopleIcon aria-hidden className="size-4" />} label="Can sign in" value={counts.active} />
        <Figure
          icon={<PendingIcon aria-hidden className="size-4" />}
          label="Awaiting enrolment"
          value={counts.invited}
          /* The one number here that is ever a problem, so it is the one that
             gets a colour. Everything highlighted is nothing highlighted. */
          alarm={counts.invited > 0}
        />
        <Figure icon={<PersonIcon aria-hidden className="size-4" />} label="Other accounts" value={counts.other} />
        <Figure
          icon={<CalendarIcon aria-hidden className="size-4" />}
          label="Customer since"
          value={new Date(createdAt).toLocaleDateString('en-GB', {
            month: 'short',
            year: 'numeric',
          })}
        />
      </dl>
    </section>
  );
}

function Figure({
  icon,
  label,
  value,
  alarm = false,
}: {
  readonly icon: JSX.Element;
  readonly label: string;
  readonly value: string | number;
  readonly alarm?: boolean;
}): JSX.Element {
  return (
    <div>
      <dt className="text-fg-muted flex items-center gap-1.5 text-xs">
        {icon}
        {label}
      </dt>
      <dd className={`mt-1 text-2xl font-semibold tabular-nums ${alarm ? 'text-warning-fg' : 'text-fg'}`}>
        {value}
      </dd>
    </div>
  );
}
