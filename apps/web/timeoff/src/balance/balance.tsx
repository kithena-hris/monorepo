import { List, ListItem, PageHeader, PageSection, Progress, Skeleton, Stat } from '@reach/ui';
import type { JSX } from 'react';

import { Loaded, type Loadable } from '../load';
import { amount, chartTone, leaveIcon, monthName, shortDate, signed } from '../words';

/**
 * Where the days went (MT20, and the desk's view of a balance card): one
 * leave type's balance this leave year and every ledger entry it folds
 * from, newest first (PRD §7.1). "Why do I have 11.5?" has its one-screen
 * answer, and nothing here adds anything up: the balance is Time Off's.
 *
 * Each line is effective on its domain date; one recorded on another day
 * says so, as a correction entered later must. A corrected entry is left
 * out, as the fold leaves it out, and its correction says what it is.
 */

export interface LedgerEntry {
  readonly entryId: string;
  readonly kind: string;
  /** Signed decimal string: "-5.000", "2.083". */
  readonly amount: string;
  readonly unit: 'day' | 'hour';
  readonly effectiveOn: string;
  readonly occurredAt: string;
  readonly reason: string | null;
  readonly requestId: string | null;
  readonly supersedes: string | null;
}

export interface BalanceData {
  readonly balance: {
    readonly leaveTypeKey: string;
    readonly name: string;
    readonly unit: 'day' | 'hour';
    readonly colorToken: string;
    readonly icon: string;
    readonly left: string;
    readonly used: string;
    readonly booked: string;
    readonly yearly: string | null;
  };
  readonly entries: readonly LedgerEntry[];
}

export function Balance({ load }: { readonly load: Loadable<BalanceData> }): JSX.Element {
  if (load.status === 'loading') return <BalanceSkeleton />;
  return (
    <div className="@container/balance flex flex-col gap-6">
      {load.status === 'error' ? <PageHeader title="Where the days went" /> : null}
      <Loaded load={load} what="this balance">
        {(data) => <Ready data={data} />}
      </Loaded>
    </div>
  );
}

const body =
  'flex flex-col gap-5 @min-[52rem]/balance:grid @min-[52rem]/balance:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] @min-[52rem]/balance:items-start';

function Ready({ data }: { readonly data: BalanceData }): JSX.Element {
  const { balance } = data;
  const hours = balance.unit === 'hour';
  const corrected = new Set(
    data.entries.flatMap((e) => (e.supersedes === null ? [] : [e.supersedes])),
  );
  const lines = data.entries.filter((e) => !corrected.has(e.entryId)).toReversed();
  return (
    <>
      <PageHeader title={balance.name} description="Where the days went this year" />
      <div className={body}>
        <Stat
          label={balance.name}
          icon={leaveIcon(balance.icon)}
          value={hours ? `${amount(balance.left)}h` : amount(balance.left)}
          unit={hours ? 'banked' : 'days left'}
        >
          {balance.yearly === null ? null : (
            <Progress
              label={balance.name}
              max={Number(balance.yearly)}
              showValue
              valueLabel={`${amount(balance.yearly)} a year`}
              segments={[
                {
                  value: Number(balance.used),
                  label: `${amount(balance.used)} used`,
                  tone: chartTone(balance.colorToken),
                },
                ...(Number(balance.booked) > 0
                  ? [
                      {
                        value: Number(balance.booked),
                        label: `${amount(balance.booked)} booked`,
                        tone: chartTone(balance.colorToken),
                        pattern: 'hatched' as const,
                      },
                    ]
                  : []),
              ]}
            />
          )}
        </Stat>
        <PageSection title="Every change" aria-label="Every change">
          {lines.length === 0 ? (
            <p className="text-sm text-fg-muted">Nothing has changed this balance this year.</p>
          ) : (
            <List>
              {lines.map((e) => {
                const recorded = e.occurredAt.slice(0, 10);
                const description = [
                  shortDate(e.effectiveOn),
                  recorded === e.effectiveOn ? null : `recorded ${shortDate(recorded)}`,
                  e.reason,
                ]
                  .filter(Boolean)
                  .join(' · ');
                const value = (
                  <span className="text-sm font-semibold tabular-nums">
                    {`${signed(e.amount)}${e.unit === 'hour' ? 'h' : ''}`}
                  </span>
                );
                return e.requestId === null ? (
                  <ListItem key={e.entryId} description={description} trailing={value}>
                    {what(e)}
                  </ListItem>
                ) : (
                  <ListItem key={e.entryId} asChild description={description} trailing={value}>
                    <a href={`/time-off/requests/${e.requestId}`}>{what(e)}</a>
                  </ListItem>
                );
              })}
            </List>
          )}
        </PageSection>
      </div>
    </>
  );
}

/** What an entry is, in a person's words (PRD §7.1's kinds). */
function what(e: LedgerEntry): string {
  const year = Number(e.effectiveOn.slice(0, 4));
  const label: Record<string, string> = {
    grant: `Allowance for ${String(year)}`,
    accrual: `Earned in ${monthName(e.effectiveOn)}`,
    carry_over: `Carried over from ${String(year - 1)}`,
    expiry: 'Lost, not used in time',
    booking: 'Booked',
    taken: 'Taken',
    release: 'Given back',
    borrow: `Borrowed from ${String(year + 1)}`,
    adjustment: 'Corrected by HR',
    comp_earned: 'Overtime banked',
  };
  const said = label[e.kind] ?? e.kind;
  return e.supersedes === null || e.kind === 'adjustment' ? said : `${said} (corrected)`;
}

/** The page while it loads, in its shape: the balance beside its ledger. */
function BalanceSkeleton(): JSX.Element {
  return (
    <div className="@container/balance flex flex-col gap-6">
      <PageHeader title="Where the days went" description={' '} />
      <div role="status" className={body}>
        <span className="sr-only">Loading this balance</span>
        <Skeleton className="h-40 rounded-lg" />
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <Skeleton key={n} className="h-14 rounded-md" />
          ))}
        </div>
      </div>
    </div>
  );
}
