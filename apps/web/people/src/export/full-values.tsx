import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  formatList,
  icons,
  KeyValues,
  locale,
  PageSection,
  PINNED_BAR,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import type { Outcome } from '../load';
import { t } from '../i18n';

/**
 * Full values, through somebody else's hands (PEO-088, PEO-121; PRD §15.2).
 *
 * Finance never downloads a masked value directly: it asks for named fields
 * and says why; HR approves or rejects within seven days; an approval issues
 * one file behind a link that works once and for 24 hours, handed to the
 * requester alone. This screen is both halves: finance's form and its own
 * requests, HR's queue. Which half is drawn is People's answer, not a guess.
 */

export interface FullValuesRequest {
  readonly id: string;
  /** pending, approved, rejected, expired, issued or downloaded. */
  readonly state: string;
  readonly mine: boolean;
  readonly requestedBy: string | null;
  readonly reason: string;
  readonly fields: readonly string[];
  /** Whose values, in words: "Everybody · 128". Absent from an older People. */
  readonly people?: string;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly note: string | null;
  /** The one download, only the requester's, only while usable. */
  readonly link: string | null;
}

export interface FullValuesState {
  readonly canRequest: boolean;
  readonly canDecide: boolean;
  readonly fields: readonly { readonly key: string; readonly label: string }[];
  readonly requests: readonly FullValuesRequest[];
  /** The place of the next page of requests; null on the last. Absent from an older People. */
  readonly next?: string | null;
}

/** What a request for full values may have done to it, and asked. */
export interface FullValuesActions {
  readonly onRequest: (fields: readonly string[], reason: string) => Promise<Outcome>;
  readonly onDecide: (id: string, approve: boolean, note: string | null) => Promise<Outcome>;
}

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const STATE: Partial<Record<string, { readonly tone: Tone; readonly text: string }>> = {
  pending: { tone: 'warning', text: t('export.full-values.waiting_for_hr', 'Waiting for HR') },
  approved: {
    tone: 'info',
    text: t('export.full-values.approved_being_prepared', 'Approved, being prepared'),
  },
  issued: { tone: 'success', text: t('export.full-values.ready_to_download', 'Ready to download') },
  downloaded: { tone: 'neutral', text: t('export.full-values.downloaded', 'Downloaded') },
  rejected: { tone: 'danger', text: t('export.full-values.rejected', 'Rejected') },
  expired: { tone: 'neutral', text: t('export.full-values.expired', 'Expired') },
};

/** A request's state in words and tone: "Waiting for HR". */
export const stateOf = (r: FullValuesRequest): { readonly tone: Tone; readonly text: string } =>
  STATE[r.state] ?? { tone: 'neutral', text: r.state };

const day = (iso: string): string =>
  new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Who asked, as a decider reads it. */
export const askedBy = (r: FullValuesRequest): string =>
  r.mine
    ? t('export.full-values.you', 'You')
    : (r.requestedBy ?? t('export.full-values.somebody_in_finance', 'Somebody in finance'));

/**
 * One request for full values, as the decision it is (design E4): who wants
 * what and why, what approving issues, and Decline or Allow, each confirmed
 * with an optional note.
 */
export function AccessDetail({
  request,
  onDecide,
}: {
  readonly request: FullValuesRequest;
  readonly onDecide: FullValuesActions['onDecide'];
}): JSX.Element {
  const [deciding, setDeciding] = useState<boolean | null>(null);
  const who = askedBy(request);
  return (
    <Card padded className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <Avatar size="xl" name={who} />
        <div className="min-w-0 flex-1">
          <h2 className="text-md font-bold">
            {who}
            <span className="font-normal text-fg-muted">
              {' '}
              {t('export.full-values.wants_to_see', '· wants to see')} {formatList(request.fields)}
            </span>
          </h2>
          <p className="text-sm text-fg-muted">
            {t(
              'export.full-values.asked_expires_if_nobody_decides',
              'Asked {{requestedAt}} · expires {{expiresAt}} if nobody decides',
              { requestedAt: day(request.requestedAt), expiresAt: day(request.expiresAt) },
            )}
          </p>
        </div>
      </div>
      <KeyValues
        layout="aligned"
        labelWidth="7.5rem"
        items={[
          { label: t('export.full-values.fields', 'Fields'), value: request.fields.join(', ') },
          ...(request.people === undefined
            ? []
            : [{ label: t('export.full-values.people', 'People'), value: request.people }]),
          { label: t('export.full-values.reason', 'Reason'), value: `“${request.reason}”` },
        ]}
      />
      <Alert
        tone="warning"
        title={t(
          'export.full-values.these_values_are_masked_everywhere_else',
          'These values are masked everywhere else',
        )}
      >
        {t(
          'export.full-values.approving_issues_one_download_once_within',
          'Approving issues one download, once, within 24 hours. The people whose values are read can see that it happened.',
        )}
      </Alert>
      <div
        {...PINNED_BAR}
        className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4 touch:sticky touch:bottom-24 touch:z-10 touch:grid touch:grid-cols-2 touch:bg-surface touch:py-2"
      >
        <Button
          aria-label={t(
            'export.full-values.reject_the_request_from',
            'Reject the request from {{who}}',
            { who },
          )}
          onClick={() => {
            setDeciding(false);
          }}
        >
          {t('export.full-values.decline', 'Decline')}
        </Button>
        <Button
          variant="primary"
          aria-label={t(
            'export.full-values.approve_the_request_from',
            'Approve the request from {{who}}',
            { who },
          )}
          onClick={() => {
            setDeciding(true);
          }}
        >
          {t('export.full-values.allow', 'Allow')}
        </Button>
      </div>
      {deciding === null ? null : (
        <Decide
          request={request}
          approve={deciding}
          onDecide={onDecide}
          onClose={() => {
            setDeciding(null);
          }}
        />
      )}
    </Card>
  );
}

/** Requests as a table (design E11): when, what and why, their state, and the one download. */
export function RequestsTable({
  label,
  requests,
}: {
  readonly label: string;
  readonly requests: readonly FullValuesRequest[];
}): JSX.Element {
  return (
    <Table aria-label={label}>
      <TableHeader>
        <TableRow>
          <TableHead>{t('export.full-values.asked', 'Asked')}</TableHead>
          <TableHead>{t('export.full-values.fields_and_reason', 'Fields and reason')}</TableHead>
          <TableHead>{t('export.full-values.state', 'State')}</TableHead>
          <TableHead>{t('export.full-values.file', 'File')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {requests.map((r) => {
          const shown = stateOf(r);
          return (
            <TableRow key={r.id}>
              <TableCell>
                {askedBy(r)}
                <span className="block text-sm text-fg-muted">{day(r.requestedAt)}</span>
              </TableCell>
              <TableCell>
                <span className="font-medium">{r.fields.join(', ')}</span>
                <span className="block text-sm text-fg-muted">{r.reason}</span>
              </TableCell>
              <TableCell>
                <Badge tone={shown.tone}>{shown.text}</Badge>
                {r.note === null ? null : (
                  <span className="block text-sm text-fg-muted">“{r.note}”</span>
                )}
                {r.state === 'pending' ? (
                  <span className="block text-sm text-fg-muted">
                    {t('export.full-values.expires', 'Expires')} {day(r.expiresAt)}
                  </span>
                ) : null}
              </TableCell>
              <TableCell>
                {r.link === null ? (
                  '—'
                ) : (
                  // A signed bearer link that carries its own authority and
                  // works once: a real link, so the browser downloads it.
                  <Button
                    asChild
                    size="sm"
                    variant="primary"
                    startIcon={<icons.download aria-hidden />}
                  >
                    <a href={r.link} download>
                      {t('export.full-values.download_once', 'Download, once')}
                    </a>
                  </Button>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function AskForFullValues({
  state,
  onRequest,
}: {
  readonly state: FullValuesState;
  readonly onRequest: FullValuesActions['onRequest'];
}): JSX.Element {
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const [reason, setReason] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  if (state.fields.length === 0) {
    return (
      <Alert tone="info">
        {t(
          'export.full-values.nothing_in_the_published_fields_is',
          'Nothing in the published fields is masked in an export, so there is nothing to ask for.',
        )}
      </Alert>
    );
  }
  const problems = { fields: chosen.length === 0, reason: reason.trim() === '' };

  return (
    <PageSection title={t('export.full-values.ask_for_full_values', 'Ask for full values')}>
      <form
        aria-label={t('export.full-values.ask_for_full_values', 'Ask for full values')}
        onSubmit={(event) => {
          event.preventDefault();
          setShown(true);
          if (problems.fields || problems.reason) return;
          setBusy(true);
          setOutcome(null);
          void onRequest(chosen, reason.trim()).then((result) => {
            setBusy(false);
            setOutcome(result);
            if (result.ok) {
              setChosen([]);
              setReason('');
              setShown(false);
            }
          });
        }}
      >
        <Stack gap={4}>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">
              {t('export.full-values.fields', 'Fields')}
            </legend>
            {state.fields.map((f) => (
              <Field key={f.key} orientation="horizontal">
                <FieldControl>
                  <Checkbox
                    checked={chosen.includes(f.key)}
                    onCheckedChange={(on) => {
                      setChosen((c) =>
                        on === true ? [...c, f.key] : c.filter((k) => k !== f.key),
                      );
                    }}
                  />
                </FieldControl>
                <FieldLabel>{f.label}</FieldLabel>
              </Field>
            ))}
            {shown && problems.fields ? (
              <p className="text-danger-fg text-xs">
                {t('export.full-values.choose_at_least_one_field', 'Choose at least one field.')}
              </p>
            ) : null}
          </fieldset>
          <Field required invalid={shown && problems.reason}>
            <FieldLabel>{t('export.full-values.reason', 'Reason')}</FieldLabel>
            <FieldControl>
              <Textarea
                value={reason}
                maxLength={500}
                onChange={(e) => {
                  setReason(e.target.value);
                }}
              />
            </FieldControl>
            <FieldDescription>
              {t(
                'export.full-values.hr_sees_it_and_it_is',
                'HR sees it, and it is kept with every step.',
              )}
            </FieldDescription>
            <FieldError>{t('export.full-values.say_why', 'Say why.')}</FieldError>
          </Field>
          {outcome === null ? null : outcome.ok ? (
            <Alert tone="success">
              {t(
                'export.full-values.asked_hr_has_seven_days_to',
                'Asked. HR has seven days to decide.',
              )}
            </Alert>
          ) : (
            <Alert tone="danger" title={t('export.full-values.not_asked', 'Not asked')}>
              {outcome.message}
            </Alert>
          )}
          <div>
            <Button
              type="submit"
              variant="primary"
              loading={busy}
              loadingLabel={t('export.full-values.asking', 'Asking')}
            >
              {t('export.full-values.ask_hr', 'Ask HR')}
            </Button>
          </div>
        </Stack>
      </form>
    </PageSection>
  );
}

function Decide({
  request,
  approve,
  onDecide,
  onClose,
}: {
  readonly request: FullValuesRequest;
  readonly approve: boolean;
  readonly onDecide: FullValuesActions['onDecide'];
  readonly onClose: () => void;
}): JSX.Element {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const verb = approve
    ? t('export.full-values.allow', 'Allow')
    : t('export.full-values.reject', 'Reject');

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {approve
              ? t('export.full-values.allow_the_request', 'Allow the request')
              : t('export.full-values.reject_the_request', 'Reject the request')}
          </DialogTitle>
          <DialogDescription>
            {approve
              ? t(
                  'export.full-values.in_full_one_download_for_the',
                  '{{join}} in full, one download for the requester, within 24 hours.',
                  { join: request.fields.join(', ') },
                )
              : request.requestedBy === null
                ? t(
                    'export.full-values.nothing_is_issued_requester_sees',
                    'Nothing is issued. The requester sees your note.',
                  )
                : t(
                    'export.full-values.nothing_is_issued_sees_your_note',
                    'Nothing is issued. {{value}} sees your note.',
                    { value: request.requestedBy },
                  )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Stack gap={4}>
            <p className="text-sm">{request.reason}</p>
            <Field>
              <FieldLabel>{t('export.full-values.note', 'Note')}</FieldLabel>
              <FieldControl>
                <Textarea
                  value={note}
                  maxLength={500}
                  onChange={(e) => {
                    setNote(e.target.value);
                  }}
                />
              </FieldControl>
              <FieldDescription>
                {t(
                  'export.full-values.optional_kept_with_the_decision',
                  'Optional; kept with the decision.',
                )}
              </FieldDescription>
            </Field>
            {refused === null ? null : (
              <Alert tone="danger" title={t('export.full-values.not_decided', 'Not decided')}>
                {refused}
              </Alert>
            )}
          </Stack>
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>{t('export.full-values.cancel', 'Cancel')}</Button>
          <Button
            variant={approve ? 'primary' : 'destructive'}
            loading={busy}
            loadingLabel={t('export.full-values.saving', 'Saving')}
            onClick={() => {
              setBusy(true);
              setRefused(null);
              void onDecide(request.id, approve, note.trim() === '' ? null : note.trim()).then(
                (outcome) => {
                  setBusy(false);
                  if (outcome.ok) onClose();
                  else setRefused(outcome.message);
                },
              );
            }}
          >
            {verb}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
