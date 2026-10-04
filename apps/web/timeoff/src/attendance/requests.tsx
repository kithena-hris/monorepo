import {
  Alert,
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  List,
  ListItem,
  PageHeader,
  PageSection,
  RadioCard,
  RadioGroup,
  Skeleton,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';
import { duration, shortDate, weekdayName } from './time';

/**
 * The attendance Requests tab (TOF-099; T22's "Needs you", PRD §11.5,
 * §11.6): for a manager, the overtime their reports worked that nobody has
 * decided — approved as comp time hour for hour, paid at the multiplier, or
 * declined, as the attendance rules allow — and corrections made more than a
 * day late, shown beside the original. For everyone, their own overtime of
 * the last month and where each day stands.
 *
 * One component at every width: a row per day, its decision in a dialog.
 */

type Outcome3 = 'comp' | 'paid' | 'declined';

export interface AttendanceRequestsData {
  readonly overtime: { readonly becomes: 'comp' | 'paid' | 'choose'; readonly multiplier: string };
  readonly needsYou: readonly {
    readonly kind: 'correction' | 'overtime';
    readonly personId: string;
    readonly displayName: string;
    readonly date: string;
    readonly minutes: number | null;
    readonly punch: { readonly kind: string } | null;
  }[];
  readonly mine: readonly {
    readonly date: string;
    readonly minutes: number;
    readonly status: 'waiting' | Outcome3;
  }[];
}

export interface AttendanceRequestsProps {
  readonly load: Loadable<AttendanceRequestsData>;
  readonly onDecide?: (input: {
    readonly personId: string;
    readonly date: string;
    readonly approve: boolean;
    readonly choice: 'comp' | 'paid' | null;
  }) => Promise<Outcome>;
}

const STATUS: Record<
  'waiting' | Outcome3,
  { label: string; tone: 'warning' | 'success' | 'neutral' }
> = {
  waiting: { label: 'Waiting', tone: 'warning' },
  comp: { label: 'Comp time', tone: 'success' },
  paid: { label: 'Paid', tone: 'success' },
  declined: { label: 'Declined', tone: 'neutral' },
};

export function AttendanceRequests(props: AttendanceRequestsProps): JSX.Element {
  const { load } = props;
  if (load.status === 'loading') return <AttendanceRequestsSkeleton />;
  return (
    <div className="flex flex-col gap-6">
      {load.status === 'error' ? <PageHeader title="Attendance" /> : null}
      <Loaded load={load} what="your attendance requests">
        {(data) => <Ready data={data} onDecide={props.onDecide} />}
      </Loaded>
    </div>
  );
}

type Item = AttendanceRequestsData['needsYou'][number];

function Ready({
  data,
  onDecide,
}: {
  readonly data: AttendanceRequestsData;
  readonly onDecide: AttendanceRequestsProps['onDecide'];
}): JSX.Element {
  const [deciding, setDeciding] = useState<Item | null>(null);
  const overtime = data.needsYou.filter((n) => n.kind === 'overtime');
  const corrections = data.needsYou.filter((n) => n.kind === 'correction');
  const manages = data.needsYou.length > 0;
  return (
    <>
      <PageHeader
        title="Attendance"
        description={
          manages
            ? `${String(overtime.length)} overtime to decide, ${String(corrections.length)} late ${corrections.length === 1 ? 'correction' : 'corrections'}`
            : 'Your overtime and where it stands'
        }
      />
      {manages ? (
        <PageSection title="Needs you">
          <List aria-label="Needs you">
            {overtime.map((n) => (
              <ListItem
                key={`${n.personId} ${n.date}`}
                leading={<Avatar name={n.displayName} />}
                description={`${shortDate(n.date)} · ${duration(n.minutes ?? 0)} over the plan`}
                trailing={
                  onDecide === undefined ? undefined : (
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`Decide ${n.displayName}’s overtime on ${shortDate(n.date)}`}
                      onClick={() => {
                        setDeciding(n);
                      }}
                    >
                      Decide
                    </Button>
                  )
                }
              >
                {`${n.displayName} · ${duration(n.minutes ?? 0)} overtime`}
              </ListItem>
            ))}
            {corrections.map((n) => (
              <ListItem
                key={`${n.personId} ${n.date} correction`}
                icon={<icons.history aria-hidden />}
                iconTone="danger"
                description={`${shortDate(n.date)} · added more than a day afterwards`}
                trailing={
                  <Button asChild size="sm" variant="ghost">
                    <a
                      href={`/time-off/attendance/timesheets?person=${n.personId}&week=${n.date}`}
                      aria-label={`See ${n.displayName}’s ${weekdayName(n.date)} beside the original`}
                    >
                      See
                    </a>
                  </Button>
                }
              >
                {`${n.displayName} · ${weekdayName(n.date)} ${n.punch?.kind === 'in' ? 'clock-in' : 'clock-out'}`}
              </ListItem>
            ))}
          </List>
        </PageSection>
      ) : null}
      <PageSection
        title="Your overtime"
        description="The last month. Your manager decides each day as comp time or pay."
      >
        {data.mine.length === 0 ? (
          <p className="text-sm text-fg-muted">No overtime in the last month.</p>
        ) : (
          <List aria-label="Your overtime">
            {data.mine.map((m) => (
              <ListItem
                key={m.date}
                icon={<icons.overtime aria-hidden />}
                iconTone="info"
                description={`${duration(m.minutes)} over the plan`}
                trailing={
                  <Badge size="sm" tone={STATUS[m.status].tone} dot={m.status === 'waiting'}>
                    {STATUS[m.status].label}
                  </Badge>
                }
              >
                {shortDate(m.date)}
              </ListItem>
            ))}
          </List>
        )}
      </PageSection>
      {deciding === null || onDecide === undefined ? null : (
        <Decide
          item={deciding}
          overtime={data.overtime}
          onDecide={onDecide}
          onClose={() => {
            setDeciding(null);
          }}
        />
      )}
    </>
  );
}

/** One day's overtime: comp time, pay or decline, as the rules allow. */
function Decide({
  item,
  overtime,
  onDecide,
  onClose,
}: {
  readonly item: Item;
  readonly overtime: AttendanceRequestsData['overtime'];
  readonly onDecide: NonNullable<AttendanceRequestsProps['onDecide']>;
  readonly onClose: () => void;
}): JSX.Element {
  const offered: Outcome3[] =
    overtime.becomes === 'choose' ? ['comp', 'paid', 'declined'] : [overtime.becomes, 'declined'];
  const [choice, setChoice] = useState<Outcome3>(offered[0] ?? 'declined');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const minutes = item.minutes ?? 0;
  const text: Record<Outcome3, { label: string; description: string }> = {
    comp: {
      label: 'Comp time',
      description: `${duration(minutes)} banked, hour for hour, to take as time off.`,
    },
    paid: {
      label: 'Pay it',
      description: `${duration(minutes)} at ${overtime.multiplier}×, sent to Payroll with the month.`,
    },
    declined: { label: 'Decline', description: 'Not counted as overtime. They can ask you why.' },
  };
  const save = (): void => {
    setBusy(true);
    setRefused(null);
    void onDecide({
      personId: item.personId,
      date: item.date,
      approve: choice !== 'declined',
      choice: choice === 'declined' ? null : choice,
    }).then((outcome) => {
      setBusy(false);
      if (outcome.ok) onClose();
      else setRefused(outcome.message);
    });
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`${item.displayName}’s overtime on ${weekdayName(item.date)}`}</DialogTitle>
          <DialogDescription>
            {`${duration(minutes)} over the plan on ${shortDate(item.date)}.`}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <RadioGroup
            aria-label="What it becomes"
            value={choice}
            onValueChange={(v) => {
              setChoice(v as Outcome3);
            }}
          >
            {offered.map((o) => (
              <RadioCard key={o} value={o} description={text[o].description}>
                {text[o].label}
              </RadioCard>
            ))}
          </RadioGroup>
          {refused === null ? null : (
            <Alert tone="danger" title="Not decided">
              {refused}
            </Alert>
          )}
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            startIcon={<icons.confirm aria-hidden />}
            loading={busy}
            loadingLabel="Saving"
            onClick={save}
          >
            {choice === 'declined' ? 'Decline' : 'Approve'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The tab while it loads: the header, what needs you and your own overtime. */
export function AttendanceRequestsSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Attendance" description={' '} />
      <div role="status" className="flex flex-col gap-6">
        <span className="sr-only">Loading your attendance requests</span>
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((n) => (
            <Skeleton key={n} className="h-16 rounded-sm" />
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((n) => (
            <Skeleton key={n} className="h-16 rounded-sm" />
          ))}
        </div>
      </div>
    </div>
  );
}
