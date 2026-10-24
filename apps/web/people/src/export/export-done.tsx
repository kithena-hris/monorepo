import {
  Alert,
  Button,
  Card,
  dateFormat,
  Field,
  FieldControl,
  FieldLabel,
  icons,
  KeyValues,
  PageSection,
  Stack,
  Textarea,
} from '@reach/ui';
import { useEffect, useState, type JSX, type ReactNode } from 'react';

import type { Outcome } from '../load';
import { FORMAT_LABEL, firstName, listed, spokenDate, type ExportFormat } from './words';
import { t } from '../i18n';

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
  /** Whoever asked, with their photo where the viewer may see it (absent from an older People). */
  readonly requestedBy: Person & { readonly avatarUrl?: string | null };
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
  /** People in it, as the requester read it when they asked; null or absent for an older request. */
  readonly people?: number | null;
  readonly exportId: string | null;
  readonly mine: boolean;
  readonly canDecide: boolean;
  readonly approvers: readonly Person[];
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
  const time = dateFormat({
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
  if (day(iso) === day(now)) return t('export.export-done.at', 'at {{time}}', { time });
  const date = dateFormat({
    timeZone: zone,
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso));
  return t('export.export-done.on_at', 'on {{date}} at {{time}}', { date, time });
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
      <Alert
        tone="warning"
        title={t(
          'export.export-done.this_export_is_no_longer_available',
          'This export is no longer available',
        )}
      >
        {t(
          'export.export-done.it_was_made_for_somebody_else',
          'It was made for somebody else, or it no longer exists.',
        )}
      </Alert>
    );
  }
  if (record.status === 'queued') {
    return (
      <Alert tone="info">
        {t(
          'export.export-done.your_export_is_still_being_prepared',
          'Your export is still being prepared. Try again in a minute.',
        )}
      </Alert>
    );
  }
  const sentTo = record.sentTo;
  const lines = [
    record.approvedBy === null || record.approvedBy.at === null
      ? null
      : record.approvedBy.name === null
        ? t(
            'export.export-done.an_administrator_approved',
            'A People administrator approved {{at}}',
            {
              at: at(record.approvedBy.at, record.now, zone),
            },
          )
        : t('export.export-done.approved', '{{value}} approved {{at}}', {
            value: record.approvedBy.name,
            at: at(record.approvedBy.at, record.now, zone),
          }),
    sentTo === null
      ? null
      : record.openedAt === null
        ? t('export.export-done.not_opened_yet', 'not opened yet')
        : t('export.export-done.the_link_opened', 'the link opened {{at}}', {
            at: at(record.openedAt, record.now, zone),
          }),
  ].filter((l): l is string => l !== null);
  const title = !record.mine
    ? record.requestedBy.name === null
      ? t('export.export-done.from_a_colleague', 'From a colleague')
      : t('export.export-done.from', 'From {{value}}', { value: record.requestedBy.name })
    : sentTo === null
      ? t('export.export-done.your_export_is_ready', 'Your export is ready')
      : sentTo.name === null
        ? t('export.export-done.sent_to_them', 'Sent to them')
        : t('export.export-done.sent_to', 'Sent to {{value}}', { value: sentTo.name });
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
                    ? t('export.export-done.its_link_has_expired', 'Its link has expired.')
                    : t(
                        'export.export-done.its_link_works_until',
                        'Its link works until {{spokenDate}}.',
                        { spokenDate: spokenDate(record.expiresAt ?? record.now) },
                      )
                  : lines.join(' · ').charAt(0).toUpperCase() + lines.join(' · ').slice(1)}
              </p>
            </div>
          </div>
          {expired ? (
            <Alert
              tone="warning"
              title={t(
                'export.export-done.this_export_is_no_longer_available',
                'This export is no longer available',
              )}
            >
              {sentTo === null
                ? t(
                    'export.export-done.exports_are_deleted_24_hours_after',
                    'Exports are deleted 24 hours after they are made.',
                  )
                : t(
                    'export.export-done.a_file_sent_to_somebody_is',
                    'A file sent to somebody is deleted 7 days after it is made.',
                  )}
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
              <p className="text-xs font-semibold text-fg-subtle">
                {t(
                  'export.export-done.about_the_files_first_sheet',
                  'About · the file’s first sheet',
                )}
              </p>
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
        <PageSection surface title={t('export.export-done.recorded', 'Recorded')}>
          <KeyValues
            items={[
              {
                label: t('export.export-done.reason', 'Reason'),
                value: record.reason ?? 'None given',
              },
              {
                label: t('export.export-done.people', 'People'),
                value: String(record.rowCount ?? 0),
              },
              {
                label: t('export.export-done.fields', 'Fields'),
                value: `${String(record.fields.length)}${record.sensitive === 0 ? '' : `, ${String(record.sensitive)} sensitive`}`,
              },
              ...(record.approvedBy === null
                ? []
                : [
                    {
                      label: t('export.export-done.approved_by', 'Approved by'),
                      value: record.approvedBy.name ?? 'A People administrator',
                    },
                  ]),
              {
                label: t('export.export-done.kept_until', 'Kept until'),
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
            loadingLabel={t('export.export-done.scheduling', 'Scheduling')}
            disabled={scheduled?.ok === true}
            onClick={() => {
              setBusy(true);
              void onSchedule().then((o) => {
                setBusy(false);
                setScheduled(o);
              });
            }}
          >
            {t('export.export-done.make_this_a_monthly_schedule', 'Make this a monthly schedule')}
          </Button>
        ) : null}
        {scheduled === null ? null : scheduled.ok ? (
          <Alert tone="success" title={t('export.export-done.scheduled', 'Scheduled')}>
            {t(
              'export.export-done.it_goes_on_the_1st_of',
              'It goes on the 1st of every month at 07:00',
            )}
            {sentTo === null
              ? ''
              : ' ' +
                t('export.export-done.to', 'to {{firstName}}', {
                  firstName: firstName(sentTo.name),
                })}
            {t('export.export-done.as', ', as')} {sentTo === null ? 'you' : firstName(sentTo.name)}{' '}
            {t('export.export-done.can_see_it_that_morning', 'can see it that morning.')}
          </Alert>
        ) : (
          <Alert tone="danger" title={t('export.export-done.not_scheduled', 'Not scheduled')}>
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
      <Alert
        tone="warning"
        title={t('export.export-done.this_request_is_not_here', 'This request is not here')}
      >
        {t(
          'export.export-done.it_was_made_for_somebody_else',
          'It was made for somebody else, or it no longer exists.',
        )}
      </Alert>
    );
  }
  const them = firstName(share.recipient.name);
  const decided =
    share.decidedBy?.name ??
    t('export.export-done.a_people_administrator', 'A People administrator');
  const heading =
    share.state === 'pending'
      ? share.canDecide
        ? share.requestedBy.name === null
          ? t(
              'export.export-done.a_colleague_wants_to_send',
              'A colleague wants to send an export to {{value2}}',
              {
                value2: share.recipient.name ?? them,
              },
            )
          : t(
              'export.export-done.wants_to_send_an_export_to',
              '{{value}} wants to send an export to {{value2}}',
              { value: share.requestedBy.name, value2: share.recipient.name ?? them },
            )
        : share.approvers.length === 0
          ? t(
              'export.export-done.waiting_for_approval_to_send_it',
              'Waiting for approval to send it to {{value}}',
              { value: share.recipient.name ?? them },
            )
          : t(
              'export.export-done.waiting_for_to_approve_sending_it',
              'Waiting for {{listed}} to approve sending it to {{value}}',
              {
                listed: listed(share.approvers.map((a) => firstName(a.name))),
                value: share.recipient.name ?? them,
              },
            )
      : share.state === 'approved'
        ? t('export.export-done.sent_to', 'Sent to {{value}}', {
            value: share.recipient.name ?? them,
          })
        : share.state === 'rejected'
          ? t(
              'export.export-done.didnt_approve_sending_it',
              '{{decided}} didn’t approve sending it',
              { decided },
            )
          : t(
              'export.export-done.nobody_approved_it_within_7_days',
              'Nobody approved it within 7 days',
            );
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
              title={t('export.export-done.cant_see_all_of_it', '{{them}} can’t see all of it', {
                them,
              })}
            >
              {listed(
                share.gap.fields.map((f) =>
                  t(
                    'export.export-done.for',
                    {
                      one: '{{label}} for {{count}} person',
                      other: '{{label}} for {{count}} people',
                    },
                    { count: f.people, label: f.label },
                  ),
                ),
              )}
              {share.gap.unlisted > 0
                ? t(
                    'export.export-done.and_people_cant_see_at_all',
                    ', and {{unlisted}} people {{them}} can’t see at all',
                    { unlisted: String(share.gap.unlisted), them },
                  )
                : ''}
              {t(
                'export.export-done.approving_sends_this_one_file_built',
                '. Approving sends this one file, built as {{firstName}} sees it; it changes nothing else {{them}} can see.',
                { firstName: firstName(share.requestedBy.name), them },
              )}
            </Alert>
          )}
          <KeyValues
            layout="split"
            items={[
              {
                label: t('export.export-done.who', 'Who'),
                // "you" is the requester's word for themselves; said to anybody else, it is them.
                value: (share.audience ?? 'Everybody you can see').replace(
                  /\byou\b/u,
                  share.mine ? 'you' : firstName(share.requestedBy.name),
                ),
              },
              { label: t('export.export-done.fields', 'Fields'), value: listed(share.fields) },
              {
                label: t('export.export-done.as_of', 'As of'),
                value: share.asOf === null ? 'The day it is sent' : spokenDate(share.asOf),
              },
              {
                label: t('export.export-done.format', 'Format'),
                value: FORMAT_LABEL[share.format],
              },
              { label: t('export.export-done.reason', 'Reason'), value: share.reason },
            ]}
          />
          {share.state === 'rejected' && share.note !== null ? (
            <p className="text-sm text-fg-muted">“{share.note}”</p>
          ) : null}
          {share.state === 'approved' && share.exportId !== null && share.mine ? (
            <div>
              <Button asChild variant="secondary" size="sm">
                <a href={`/people/export?export=${encodeURIComponent(share.exportId)}`}>
                  {t('export.export-done.open_the_sent_export', 'Open the sent export')}
                </a>
              </Button>
            </div>
          ) : null}
          {share.canDecide && onDecide !== undefined ? (
            <Stack gap={3}>
              <Field>
                <FieldLabel>{t('export.export-done.note', 'Note')}</FieldLabel>
                <FieldControl>
                  <Textarea
                    value={note}
                    maxLength={500}
                    placeholder={t(
                      'export.export-done.optional_shown_to_whoever_asked',
                      'Optional. Shown to whoever asked.',
                    )}
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
                  loadingLabel={t('export.export-done.rejecting', 'Rejecting')}
                  onClick={() => {
                    void decide(false);
                  }}
                >
                  {t('export.export-done.reject', 'Reject')}
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  startIcon={<icons.send aria-hidden />}
                  loading={busy === 'approve'}
                  loadingLabel={t('export.export-done.approving', 'Approving')}
                  onClick={() => {
                    void decide(true);
                  }}
                >
                  {t('export.export-done.approve_and_send', 'Approve and send')}
                </Button>
              </div>
              {failed === null ? null : (
                <Alert
                  tone="danger"
                  title={t('export.export-done.nothing_was_decided', 'Nothing was decided')}
                >
                  {failed}
                </Alert>
              )}
            </Stack>
          ) : null}
        </Stack>
      </PageSection>
      <PageSection surface title={t('export.export-done.recorded', 'Recorded')}>
        <KeyValues
          items={[
            {
              label: t('export.export-done.asked_by', 'Asked by'),
              value: share.requestedBy.name ?? 'A colleague',
            },
            {
              label: t('export.export-done.for_2', 'For'),
              value: share.recipient.name ?? 'A colleague',
            },
            {
              label:
                share.state === 'pending'
                  ? t('export.export-done.waits_until', 'Waits until')
                  : t('export.export-done.decided', 'Decided'),
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
