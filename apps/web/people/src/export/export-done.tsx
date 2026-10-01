import {
  Alert,
  Button,
  Card,
  Field,
  FieldControl,
  FieldLabel,
  KeyValues,
  PageSection,
  Stack,
  Textarea,
  icons,
} from '@reach/ui';
import { useEffect, useState, type JSX, type ReactNode } from 'react';

import type { Outcome } from '../load';
import { FORMAT_LABEL, firstName, listed, spokenDate, type ExportFormat } from './words';

type Person = { readonly accountId: string; readonly name: string | null };

/** A finished export as its requester or recipient sees it (design AI14). */
export interface ExportRecord {
  readonly id: string;
  readonly code: string;
  readonly status: 'queued' | 'completed' | 'expired';
  readonly mine: boolean;
  readonly requestedBy: Person;
  readonly sentTo: Person | null;
  readonly openedAt: string | null;
  readonly approvedBy: (Person & { readonly at: string | null }) | null;
  readonly reason: string | null;
  readonly rowCount: number | null;
  readonly fields: readonly string[];
  readonly sensitive: number;
  readonly asOf: string | null;
  readonly format: string | null;
  readonly expiresAt: string | null;
  readonly about: {
    readonly title: string;
    readonly paragraphs: readonly string[];
    readonly footnote: string;
  } | null;
  /** How long the record is kept; null while no period is decided (PEO-129). */
  readonly keptUntil: string | null;
  readonly links: readonly { readonly name: string; readonly url: string }[];
  readonly now: string;
}

/** A request to send an export, waiting for a People administrator. */
export interface ShareRequest {
  readonly id: string;
  readonly state: 'pending' | 'approved' | 'rejected' | 'expired' | 'withdrawn';
  readonly requestedBy: Person;
  readonly recipient: Person;
  readonly reason: string;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly decidedBy: Person | null;
  readonly decidedAt: string | null;
  readonly note: string | null;
  readonly fields: readonly string[];
  readonly gap: {
    readonly fields: readonly {
      readonly key: string;
      readonly label: string;
      readonly people: number;
    }[];
    readonly unlisted: number;
  } | null;
  readonly asOf: string | null;
  readonly format: ExportFormat;
  readonly audience: string | null;
  readonly exportId: string | null;
  readonly mine: boolean;
  readonly canDecide: boolean;
}

/** The reader's zone once in their browser; UTC for the server's render and the first. */
function useZone(): string | undefined {
  const [zone, setZone] = useState<string | undefined>('UTC');
  useEffect(() => {
    setZone(undefined);
  }, []);
  return zone;
}

/** "at 14:31" today, "on 15 Sep at 09:02" before. */
function at(iso: string, now: string, zone: string | undefined): string {
  const day = (i: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: zone, dateStyle: 'short' }).format(new Date(i));
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
  if (day(iso) === day(now)) return `at ${time}`;
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso));
  return `on ${date} at ${time}`;
}

/** A round mark beside a heading: what happened, in its tone. */
function Mark({
  tone,
  children,
}: {
  readonly tone: 'success' | 'warning' | 'danger';
  readonly children: ReactNode;
}): JSX.Element {
  const tones = {
    success: 'bg-success-subtle text-success-fg',
    warning: 'bg-warning-subtle text-warning-fg',
    danger: 'bg-danger-subtle text-danger-fg',
  } as const;
  return (
    <span
      className={`grid size-11 shrink-0 place-items-center rounded-full [&_svg]:size-5 ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * The file explains itself (design AI14): where it went, who approved it and
 * when it was opened, the About sheet every file starts with, and what was
 * recorded. Its links are for its requester and recipient only, signed for
 * minutes at a time.
 */
export function ExportDone({
  record,
  canSchedule,
  onSchedule,
}: {
  readonly record: ExportRecord | { readonly status: 'missing' };
  readonly canSchedule: boolean;
  readonly onSchedule?: () => Promise<Outcome>;
}): JSX.Element {
  const zone = useZone();
  const [scheduled, setScheduled] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  if (record.status === 'missing') {
    return (
      <Alert tone="warning" title="This export is no longer available">
        It was made for somebody else, or it no longer exists.
      </Alert>
    );
  }
  if (record.status === 'queued') {
    return <Alert tone="info">Your export is still being prepared. Try again in a minute.</Alert>;
  }
  const sentTo = record.sentTo;
  const lines = [
    record.approvedBy === null || record.approvedBy.at === null
      ? null
      : `${record.approvedBy.name ?? 'A People administrator'} approved ${at(record.approvedBy.at, record.now, zone)}`,
    sentTo === null
      ? null
      : record.openedAt === null
        ? 'not opened yet'
        : `the link opened ${at(record.openedAt, record.now, zone)}`,
  ].filter((l): l is string => l !== null);
  const title = !record.mine
    ? `From ${record.requestedBy.name ?? 'a colleague'}`
    : sentTo === null
      ? 'Your export is ready'
      : `Sent to ${sentTo.name ?? 'them'}`;
  const expired = record.status === 'expired';

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 @5xl/page:grid-cols-[minmax(0,1fr)_23.75rem] @5xl/page:items-start">
      <PageSection surface>
        <Stack gap={4}>
          <div className="flex items-center gap-3">
            <Mark tone={expired ? 'warning' : 'success'}>
              {sentTo === null ? <icons.download aria-hidden /> : <icons.send aria-hidden />}
            </Mark>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-fg">{title}</h2>
              <p className="text-sm text-fg-muted">
                {lines.length === 0
                  ? expired
                    ? 'Its link has expired.'
                    : `Its link works until ${spokenDate(record.expiresAt ?? record.now)}.`
                  : lines.join(' · ').charAt(0).toUpperCase() + lines.join(' · ').slice(1)}
              </p>
            </div>
          </div>
          {expired ? (
            <Alert tone="warning" title="This export is no longer available">
              {sentTo === null
                ? 'Exports are deleted 24 hours after they are made.'
                : 'A file sent to somebody is deleted 7 days after it is made.'}
            </Alert>
          ) : record.links.length === 0 ? null : (
            <div className="flex flex-wrap gap-2">
              {record.links.map((link) => (
                <Button key={link.url} asChild size="sm" variant="secondary">
                  <a href={link.url}>
                    <icons.download aria-hidden />
                    {link.name}
                  </a>
                </Button>
              ))}
            </div>
          )}
          {record.about === null ? null : (
            <Card variant="outline" padded className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-fg-subtle">About · the file’s first sheet</p>
              <h3 className="text-lg font-semibold text-fg">{record.about.title}</h3>
              {record.about.paragraphs.map((p) => (
                <p key={p} className="text-sm text-fg">
                  {p}
                </p>
              ))}
              <p className="text-xs text-fg-muted">{record.about.footnote}</p>
            </Card>
          )}
        </Stack>
      </PageSection>
      <Stack gap={4}>
        <PageSection surface title="Recorded">
          <KeyValues
            items={[
              { label: 'Reason', value: record.reason ?? 'None given' },
              { label: 'People', value: String(record.rowCount ?? 0) },
              {
                label: 'Fields',
                value: `${String(record.fields.length)}${record.sensitive === 0 ? '' : `, ${String(record.sensitive)} sensitive`}`,
              },
              ...(record.approvedBy === null
                ? []
                : [
                    {
                      label: 'Approved by',
                      value: record.approvedBy.name ?? 'A People administrator',
                    },
                  ]),
              {
                label: 'Kept until',
                value:
                  record.keptUntil === null ? 'No end date set yet' : spokenDate(record.keptUntil),
              },
            ]}
          />
        </PageSection>
        {record.mine && canSchedule && onSchedule !== undefined ? (
          <Button
            variant="secondary"
            fullWidth
            startIcon={<icons.scheduled aria-hidden />}
            loading={busy}
            loadingLabel="Scheduling"
            disabled={scheduled?.ok === true}
            onClick={() => {
              setBusy(true);
              void onSchedule().then((o) => {
                setBusy(false);
                setScheduled(o);
              });
            }}
          >
            Make this a monthly schedule
          </Button>
        ) : null}
        {scheduled === null ? null : scheduled.ok ? (
          <Alert tone="success" title="Scheduled">
            It goes on the 1st of every month at 07:00
            {sentTo === null ? '' : ` to ${firstName(sentTo.name)}`}, as{' '}
            {sentTo === null ? 'you' : firstName(sentTo.name)} can see it that morning.
          </Alert>
        ) : (
          <Alert tone="danger" title="Not scheduled">
            {scheduled.message}
          </Alert>
        )}
      </Stack>
    </div>
  );
}

/**
 * A request to send an export, while it waits (design AI13's "Send when Nora
 * approves"): to its requester, what it waits on; to a People administrator
 * who may decide it, what it holds and what the recipient could not read,
 * with Approve and Reject.
 */
export function ShareWaiting({
  share,
  onDecide,
}: {
  readonly share: ShareRequest | { readonly state: 'missing' };
  readonly onDecide?: (requestId: string, approve: boolean, note: string) => Promise<Outcome>;
}): JSX.Element {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  if (share.state === 'missing') {
    return (
      <Alert tone="warning" title="This request is not here">
        It was made for somebody else, or it no longer exists.
      </Alert>
    );
  }
  const them = firstName(share.recipient.name);
  const decided = share.decidedBy?.name ?? 'A People administrator';
  const heading =
    share.state === 'pending'
      ? share.canDecide
        ? `${share.requestedBy.name ?? 'A colleague'} wants to send an export to ${share.recipient.name ?? them}`
        : `Waiting for approval to send it to ${share.recipient.name ?? them}`
      : share.state === 'approved'
        ? `Sent to ${share.recipient.name ?? them}`
        : share.state === 'rejected'
          ? `${decided} didn’t approve sending it`
          : 'Nobody approved it within 7 days';
  const decide = async (approve: boolean): Promise<void> => {
    if (onDecide === undefined) return;
    setBusy(approve ? 'approve' : 'reject');
    setFailed(null);
    const done = await onDecide(share.id, approve, note);
    setBusy(null);
    if (!done.ok) setFailed(done.message);
  };
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 @5xl/page:grid-cols-[minmax(0,1fr)_23.75rem] @5xl/page:items-start">
      <PageSection surface>
        <Stack gap={4}>
          <div className="flex items-center gap-3">
            <Mark
              tone={
                share.state === 'approved'
                  ? 'success'
                  : share.state === 'pending'
                    ? 'warning'
                    : 'danger'
              }
            >
              {share.state === 'approved' ? (
                <icons.send aria-hidden />
              ) : (
                <icons.locked aria-hidden />
              )}
            </Mark>
            <h2 className="min-w-0 text-lg font-semibold text-fg">{heading}</h2>
          </div>
          {share.gap === null || share.gap.fields.length === 0 ? null : (
            <Alert
              tone="warning"
              icon={<icons.locked aria-hidden />}
              title={`${them} can’t see all of it`}
            >
              {listed(
                share.gap.fields.map(
                  (f) =>
                    `${f.label} for ${String(f.people)} ${f.people === 1 ? 'person' : 'people'}`,
                ),
              )}
              {share.gap.unlisted > 0
                ? `, and ${String(share.gap.unlisted)} people ${them} can’t see at all`
                : ''}
              . Approving sends this one file, built as {firstName(share.requestedBy.name)} sees it;
              it changes nothing else {them} can see.
            </Alert>
          )}
          <KeyValues
            layout="split"
            items={[
              { label: 'Who', value: share.audience ?? 'Everybody they can see' },
              { label: 'Fields', value: listed(share.fields) },
              {
                label: 'As of',
                value: share.asOf === null ? 'The day it is sent' : spokenDate(share.asOf),
              },
              { label: 'Format', value: FORMAT_LABEL[share.format] },
              { label: 'Reason', value: share.reason },
            ]}
          />
          {share.state === 'rejected' && share.note !== null ? (
            <p className="text-sm text-fg-muted">“{share.note}”</p>
          ) : null}
          {share.state === 'approved' && share.exportId !== null && share.mine ? (
            <div>
              <Button asChild variant="secondary" size="sm">
                <a href={`/people/export?export=${encodeURIComponent(share.exportId)}`}>
                  Open the sent export
                </a>
              </Button>
            </div>
          ) : null}
          {share.canDecide && onDecide !== undefined ? (
            <Stack gap={3}>
              <Field>
                <FieldLabel>Note</FieldLabel>
                <FieldControl>
                  <Textarea
                    value={note}
                    maxLength={500}
                    placeholder="Optional. Shown to whoever asked."
                    onChange={(e) => {
                      setNote(e.target.value);
                    }}
                  />
                </FieldControl>
              </Field>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  loading={busy === 'reject'}
                  loadingLabel="Rejecting"
                  onClick={() => {
                    void decide(false);
                  }}
                >
                  Reject
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  startIcon={<icons.send aria-hidden />}
                  loading={busy === 'approve'}
                  loadingLabel="Approving"
                  onClick={() => {
                    void decide(true);
                  }}
                >
                  Approve and send
                </Button>
              </div>
              {failed === null ? null : (
                <Alert tone="danger" title="Nothing was decided">
                  {failed}
                </Alert>
              )}
            </Stack>
          ) : null}
        </Stack>
      </PageSection>
      <PageSection surface title="Recorded">
        <KeyValues
          items={[
            { label: 'Asked by', value: share.requestedBy.name ?? 'A colleague' },
            { label: 'For', value: share.recipient.name ?? 'A colleague' },
            {
              label: share.state === 'pending' ? 'Waits until' : 'Decided',
              value:
                share.state === 'pending'
                  ? spokenDate(share.expiresAt)
                  : share.decidedAt === null
                    ? 'Not decided'
                    : `${decided}, ${spokenDate(share.decidedAt)}`,
            },
          ]}
        />
      </PageSection>
    </div>
  );
}
