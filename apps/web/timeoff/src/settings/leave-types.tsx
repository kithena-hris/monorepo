import { Badge, List, ListItem, PageHeader, Skeleton } from '@reach/ui';
import type { JSX } from 'react';

import { Loaded, type Loadable } from '../load';
import { chartTone, leaveIcon } from '../overview/overview';
import {
  PackNotice,
  appliesToLabel,
  approversLabel,
  ruleFor,
  type ApprovalRule,
  type LeaveTypeRow,
  type Pack,
} from './shared';

/**
 * Leave types (T29, TOF-078): every kind of time off people can ask for, one
 * row each saying how it is paid, who it reaches and who approves it, each
 * opening its policy. Statutory types came from a country pack; a pack nobody
 * has reviewed says so above the list.
 *
 * One list at every width: a row is a place to go, so it is the same row
 * under a finger, its second line wrapping where a desk has room for it.
 */

export interface LeaveTypesData {
  readonly leaveTypes: readonly LeaveTypeRow[];
  readonly packs: readonly Pack[];
  /** The approval rules (§9.1), for who approves each type. */
  readonly rules: readonly ApprovalRule[];
}

export interface LeaveTypesProps {
  readonly load: Loadable<LeaveTypesData>;
}

const TITLE = 'Leave types';
const DESCRIPTION =
  'The kinds of time off people can request, and how each one is paid and approved.';

export function LeaveTypes({ load }: LeaveTypesProps): JSX.Element {
  if (load.status === 'loading') return <LeaveTypesSkeleton />;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={TITLE} description={DESCRIPTION} />
      <Loaded load={load} what="the leave types">
        {(data) => <Ready data={data} />}
      </Loaded>
    </div>
  );
}

const PAID: Record<LeaveTypeRow['definition']['paid'], string> = {
  paid: 'Paid',
  unpaid: 'Not paid',
  statutory: 'Paid by Social Security',
};

/** "Paid · tracked balance · note after 3 days". */
function terms(t: LeaveTypeRow['definition']): string {
  return [
    PAID[t.paid],
    t.tracked ? `tracked in ${t.unit === 'hour' ? 'hours' : 'days'}` : 'no balance',
    t.requiresNote === null ? null : `note after ${String(t.requiresNote.afterDays)} days`,
    t.visibility === 'off_only' ? 'teammates see “Off”' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function Ready({ data }: { readonly data: LeaveTypesData }): JSX.Element {
  return (
    <>
      <PackNotice packs={data.packs} />
      <List navigable aria-label="Leave types">
        {data.leaveTypes.map(({ definition: t, hidden }) => {
          const rule = ruleFor(data.rules, t.key);
          return (
            <ListItem
              key={t.key}
              asChild
              icon={leaveIcon(t.icon)}
              iconTone={chartTone(t.colorToken)}
              description={terms(t)}
              supporting={`${appliesToLabel(t.appliesTo)} · ${
                rule === undefined
                  ? 'No approval rule'
                  : `${approversLabel(rule.approvers)} approves`
              }`}
              trailing={
                hidden ? (
                  <Badge size="sm" variant="outline">
                    Hidden
                  </Badge>
                ) : t.statutory ? (
                  <Badge size="sm">Statutory</Badge>
                ) : undefined
              }
              chevron
            >
              <a href={`/settings/time-off/leave-types/${t.key}`}>{t.name.default}</a>
            </ListItem>
          );
        })}
      </List>
    </>
  );
}

/** The page while it loads: the header, then the list's rows at their height. */
export function LeaveTypesSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={TITLE} description={DESCRIPTION} />
      <div role="status" className="flex flex-col gap-px overflow-hidden rounded-[1.125rem]">
        <span className="sr-only">Loading the leave types</span>
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-[5.25rem] rounded-none" />
        ))}
      </div>
    </div>
  );
}
