import {
  Alert,
  Button,
  Field,
  FieldLabel,
  PageSection,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import type { Outcome } from '../load';
import {
  FORMAT_LABEL,
  Rule,
  firstName,
  spokenDate,
  type AddressPatch,
  type ExportChoice,
} from './words';
import { t } from '../i18n';

/** Whom the export would go to, what they could not read, and who would approve it. */
export interface SendPreview {
  readonly recipient: { readonly accountId: string; readonly name: string | null } | null;
  readonly candidates: readonly { readonly accountId: string; readonly name: string }[];
  readonly people: number;
  readonly sensitive: readonly string[];
  readonly gap: {
    readonly fields: readonly {
      readonly key: string;
      readonly label: string;
      readonly people: number;
    }[];
    readonly unlisted: number;
  } | null;
  readonly approvers: readonly { readonly accountId: string; readonly name: string | null }[];
  readonly tooLarge: boolean;
  readonly emailed: boolean;
  readonly canSchedule: boolean;
  readonly self: string;
}

type Mode = 'download' | 'send' | 'schedule';

/**
 * Send (design AI13): download it, send it to somebody with a link that
 * expires in seven days and opens only for them, or schedule it monthly. Each
 * is the same field permissions as the builder: the recipient's own where
 * the file goes to somebody else.
 */
export function SendPanel({
  className,
  choice,
  preview,
  mode,
  recipient,
  onAddress,
  onExport,
  onShare,
  onSchedule,
  keep,
  onKeep,
}: {
  readonly className?: string;
  readonly choice: ExportChoice;
  readonly preview: SendPreview | null;
  readonly mode: Mode;
  readonly recipient: string | null;
  readonly onAddress: (patch: AddressPatch, mode?: 'push' | 'replace') => void;
  readonly onExport: (choice: ExportChoice) => Promise<Outcome>;
  readonly onShare?: (choice: ExportChoice, recipient: string) => Promise<Outcome>;
  readonly onSchedule?: (choice: ExportChoice, recipient: string) => Promise<Outcome>;
  readonly keep?: { readonly label: string; readonly description: string };
  readonly onKeep?: (choice: ExportChoice) => Promise<Outcome>;
}): JSX.Element {
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const to = preview?.candidates.find((c) => c.accountId === recipient) ?? null;
  const them = to === null ? null : firstName(to.name);
  const reasoned = (choice.reason ?? '').trim() !== '';
  const canShare = onShare !== undefined && preview !== null;
  const canSchedule = onSchedule !== undefined && preview?.canSchedule === true;

  const act = async (what: string, run: () => Promise<Outcome>): Promise<void> => {
    setBusy(what);
    setOutcome(null);
    const result = await run();
    setBusy(null);
    setOutcome(result);
  };

  const gap = preview?.gap ?? null;
  const without = gap?.fields.map((f) => f.key) ?? [];
  const approvers = preview?.approvers ?? [];
  const approver = approvers.length === 1 ? firstName(approvers[0]?.name ?? null) : null;

  return (
    <Stack gap={4} className={className}>
      <PageSection surface title={t('export.send-panel.send', 'Send')}>
        <Stack gap={3}>
          {canShare || canSchedule ? (
            <SegmentedControl
              aria-label={t('export.send-panel.how_it_goes', 'How it goes')}
              fullWidth
              size="sm"
              value={mode}
              onValueChange={(next) => {
                onAddress({ send: next === 'download' ? null : next });
              }}
            >
              <SegmentedControlItem value="download">
                {t('export.send-panel.download', 'Download')}
              </SegmentedControlItem>
              {canShare ? (
                <SegmentedControlItem value="send">
                  {them === null
                    ? t('export.send-panel.send', 'Send')
                    : t('export.send-panel.send_to', 'Send to {{them}}', { them })}
                </SegmentedControlItem>
              ) : null}
              {canSchedule ? (
                <SegmentedControlItem value="schedule">
                  {t('export.send-panel.schedule', 'Schedule')}
                </SegmentedControlItem>
              ) : null}
            </SegmentedControl>
          ) : null}

          {mode !== 'download' && preview !== null ? (
            <Recipient
              candidates={preview.candidates}
              value={recipient}
              label={
                mode === 'schedule'
                  ? t('export.send-panel.every_month_to', 'Every month to')
                  : t('export.send-panel.send_to_2', 'Send to')
              }
              {...(mode === 'schedule' ? { self: preview.self } : {})}
              onChange={(next) => {
                onAddress({ to: next }, 'replace');
              }}
            />
          ) : null}

          {mode === 'download' || !canShare ? (
            <>
              <p className="text-sm text-fg-muted">
                {t(
                  'export.send-panel.only_what_you_can_see_in',
                  'Only what you can see in People. Its link expires in 24 hours.',
                )}
              </p>
              <Button
                variant="primary"
                fullWidth
                startIcon={<icons.download aria-hidden />}
                disabled={choice.fields.length === 0 || !reasoned}
                loading={busy === 'download'}
                loadingLabel={t('export.send-panel.exporting', 'Exporting')}
                onClick={() => {
                  void act('download', () => onExport(choice));
                }}
              >
                {t('export.send-panel.download', 'Download')} {FORMAT_LABEL[choice.format]}
              </Button>
              {keep === undefined || onKeep === undefined ? null : (
                <>
                  <Button
                    variant="secondary"
                    fullWidth
                    startIcon={<icons.folder aria-hidden />}
                    disabled={choice.fields.length === 0 || !reasoned}
                    loading={busy === 'keep'}
                    onClick={() => {
                      void act('keep', () => onKeep(choice));
                    }}
                  >
                    {keep.label}
                  </Button>
                  <p className="text-sm text-fg-muted">{keep.description}</p>
                </>
              )}
            </>
          ) : mode === 'send' ? (
            them === null ? (
              <p className="text-sm text-fg-muted">
                {t(
                  'export.send-panel.pick_who_it_is_for_it',
                  'Pick who it is for. It goes as a link that opens only for them, for 7 days.',
                )}
              </p>
            ) : (
              <>
                <p className="text-sm text-fg-muted">
                  {preview.emailed
                    ? t(
                        'export.send-panel.gets_a_link_that_expires_in',
                        '{{them}} gets a link that expires in 7 days and only opens for {{them2}}.',
                        { them, them2: them },
                      )
                    : t(
                        'export.send-panel.email_isnt_set_up_here_so',
                        'Email isn’t set up here, so {{them}} isn’t told: the link opens only for {{them2}}, for 7 days, from the address of the page it goes to.',
                        { them, them2: them },
                      )}
                </p>
                {preview.tooLarge ? (
                  <Alert tone="info">
                    {t(
                      'export.send-panel.a_file_is_sent_for_up',
                      'A file is sent for up to 2,000 people. Download this one instead.',
                    )}
                  </Alert>
                ) : null}
                <Button
                  variant="primary"
                  fullWidth
                  startIcon={<icons.send aria-hidden />}
                  disabled={
                    !reasoned || preview.tooLarge || (gap !== null && approvers.length === 0)
                  }
                  loading={busy === 'send'}
                  loadingLabel={t('export.send-panel.sending', 'Sending')}
                  onClick={() => {
                    if (recipient !== null) void act('send', () => onShare(choice, recipient));
                  }}
                >
                  {gap === null
                    ? t('export.send-panel.send_to', 'Send to {{them}}', { them })
                    : approver === null
                      ? t('export.send-panel.send_when_approved', 'Send when approved')
                      : t(
                          'export.send-panel.send_when_approves',
                          'Send when {{approver}} approves',
                          { approver },
                        )}
                </Button>
                {gap === null || without.length === 0 ? null : (
                  <Button
                    variant="ghost"
                    fullWidth
                    disabled={!reasoned || without.length === choice.fields.length}
                    loading={busy === 'without'}
                    loadingLabel={t('export.send-panel.exporting', 'Exporting')}
                    onClick={() => {
                      void act('without', () =>
                        onExport({
                          ...choice,
                          fields: choice.fields.filter((k) => !without.includes(k)),
                        }),
                      );
                    }}
                  >
                    {/* Short enough for one line: the alert above names each field. */}
                    {t('export.send-panel.download_now_without', 'Download now (without')}{' '}
                    {gap.fields.length === 1
                      ? (gap.fields[0]?.label.toLowerCase() ?? 'it')
                      : t('export.send-panel.fields', '{{length}} fields', {
                          length: String(gap.fields.length),
                        })}
                    )
                  </Button>
                )}
              </>
            )
          ) : (
            <Schedule
              choice={choice}
              to={to === null && recipient === preview.self ? 'you' : them}
              busy={busy === 'schedule'}
              disabled={!reasoned || recipient === null}
              onSchedule={() => {
                if (recipient !== null && onSchedule !== undefined) {
                  void act('schedule', () => onSchedule(choice, recipient));
                }
              }}
            />
          )}

          {!reasoned ? (
            <p className="text-xs text-fg-subtle">
              {t(
                'export.send-panel.give_a_reason_first_it_is',
                'Give a reason first: it is kept with the export.',
              )}
            </p>
          ) : null}
          {outcome === null ? null : outcome.ok ? (
            busy === null && mode === 'schedule' ? (
              <Alert tone="success" title={t('export.send-panel.scheduled', 'Scheduled')}>
                {t(
                  'export.send-panel.it_goes_on_the_1st_of',
                  'It goes on the 1st of every month at 07:00. Change or stop it under Scheduled reports.',
                )}
              </Alert>
            ) : null
          ) : (
            <Alert
              tone="danger"
              title={t('export.send-panel.nothing_was_sent', 'Nothing was sent')}
            >
              {outcome.message}
            </Alert>
          )}
        </Stack>
      </PageSection>
      <Rule>
        {t(
          'export.send-panel.the_same_field_permissions_as_the',
          'The same field permissions as the builder',
        )}
      </Rule>
    </Stack>
  );
}

const SELF = 'self';

function Recipient({
  candidates,
  value,
  label,
  self,
  onChange,
}: {
  readonly candidates: SendPreview['candidates'];
  readonly value: string | null;
  readonly label: string;
  readonly self?: string;
  readonly onChange: (accountId: string | null) => void;
}): JSX.Element {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Select
        value={value === null ? '' : value === self ? SELF : value}
        onValueChange={(next) => {
          onChange(next === SELF ? (self ?? null) : next);
        }}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue placeholder={t('export.send-panel.choose_somebody', 'Choose somebody')} />
        </SelectTrigger>
        <SelectContent>
          {self === undefined ? null : (
            <SelectItem value={SELF}>{t('export.send-panel.me', 'Me')}</SelectItem>
          )}
          {candidates.map((c) => (
            <SelectItem key={c.accountId} value={c.accountId}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function Schedule({
  choice,
  to,
  busy,
  disabled,
  onSchedule,
}: {
  readonly choice: ExportChoice;
  readonly to: string | null;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onSchedule: () => void;
}): JSX.Element {
  const csv = choice.format === 'csv';
  return (
    <>
      <p className="text-sm text-fg-muted">
        {to === null
          ? t('export.send-panel.pick_who_gets_it', 'Pick who gets it.')
          : to === 'you'
            ? t(
                'export.send-panel.on_the_1st_you_get',
                'On the 1st of every month, you get this export as you can see it that morning: that day’s values, not {{spokenDate}}’s.',
                { spokenDate: spokenDate(choice.asOf) },
              )
            : t(
                'export.send-panel.on_the_1st_of_every_month',
                'On the 1st of every month, {{to}} gets this export as {{to}} can see it that morning: that day’s values, not {{spokenDate}}’s.',
                { to, spokenDate: spokenDate(choice.asOf) },
              )}
      </p>
      {csv ? (
        <Alert tone="info">
          {t(
            'export.send-panel.a_schedule_sends_excel_or_a',
            'A schedule sends Excel or a PDF roster. Choose one of those first.',
          )}
        </Alert>
      ) : null}
      <Button
        variant="primary"
        fullWidth
        startIcon={<icons.scheduled aria-hidden />}
        disabled={disabled || csv}
        loading={busy}
        loadingLabel={t('export.send-panel.scheduling', 'Scheduling')}
        onClick={onSchedule}
      >
        {t('export.send-panel.make_this_a_monthly_schedule', 'Make this a monthly schedule')}
      </Button>
    </>
  );
}
