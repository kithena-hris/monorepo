import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Toggle } from '../settings/shared';
import { t } from '../i18n';

/**
 * Nudging people to rest (T28, PRD §14.2): one click from the insight to a
 * personal message each, written for the person with dates that work for
 * them and **never anybody else's data**. What it includes is the address
 * (`balance`, `bridge`, `losing`), so the preview is Time Off's, exactly as
 * it would be sent. Sent through messaging now; each person once a day.
 *
 * Their managers are not written to: a manager's message would carry other
 * people's figures, which a nudge never does. They see who it is on
 * Insights, signed in.
 */

export interface NudgeInclude {
  readonly balance: boolean;
  readonly bridge: boolean;
  readonly losing: boolean;
}

export interface NudgeData {
  readonly include: NudgeInclude;
  readonly since: string | null;
  readonly recipients: readonly {
    readonly personId: string;
    readonly displayName: string;
    readonly reachable: boolean;
  }[];
  readonly preview: {
    readonly personId: string;
    readonly displayName: string;
    readonly heading: string;
    readonly lede: string;
    /** A model wrote the words (TOF-098 on the assistant's writer). */
    readonly ai?: boolean;
  } | null;
}

type Sent =
  | {
      readonly ok: true;
      readonly sent: number;
      readonly unreachable: number;
      readonly failed: number;
    }
  | { readonly ok: false; readonly message: string };

export interface NudgeProps {
  readonly nudge: NudgeData;
  readonly onAsk: ((patch: Readonly<Record<string, string | null>>) => void) | undefined;
  readonly onSend: ((include: NudgeInclude) => Promise<Sent>) | undefined;
  readonly onClose: () => void;
}

const people = (n: number): string =>
  t('insights.nudge.people', { one: '{{count}} person', other: '{{count}} people' }, { count: n });

export function Nudge({ nudge, onAsk, onSend, onClose }: NudgeProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Sent | null>(null);
  const n = nudge.recipients.length;
  const unreachable = nudge.recipients.filter((r) => !r.reachable).length;
  const include = nudge.include;
  const flip = (key: keyof NudgeInclude, on: boolean): void => {
    setResult(null);
    onAsk?.({ [key]: on ? '1' : '0' });
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent sheetOnTouch className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {t('insights.nudge.nudge_to_take_a_break', 'Nudge {{people}} to take a break', {
              people: people(n),
            })}
          </DialogTitle>
          <DialogDescription>
            {t(
              'insights.nudge.each_message_is_written_for_its',
              'Each message is written for its person, with their own numbers and nobody else’s.',
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="@container/nudge">
          <div className="flex flex-col gap-5 @min-[40rem]/nudge:grid @min-[40rem]/nudge:grid-cols-[16rem_minmax(0,1fr)]">
            <fieldset className="flex min-w-0 flex-col gap-3">
              <legend className="mb-1 text-sm font-medium">
                {t('insights.nudge.include', 'Include')}
              </legend>
              <Toggle
                kind="checkbox"
                label={t('insights.nudge.their_own_balance', 'Their own balance')}
                checked={include.balance}
                onChange={(on) => {
                  flip('balance', on);
                }}
              />
              <Toggle
                kind="checkbox"
                label={t('insights.nudge.a_bridge_day_for_them', 'A bridge day for them')}
                description={t(
                  'insights.nudge.a_day_that_joins_a_holiday',
                  'A day that joins a holiday where they work to a weekend',
                )}
                checked={include.bridge}
                onChange={(on) => {
                  flip('bridge', on);
                }}
              />
              <Toggle
                kind="checkbox"
                label={t(
                  'insights.nudge.days_theyll_lose_at_the_year',
                  'Days they’ll lose at the year end',
                )}
                checked={include.losing}
                onChange={(on) => {
                  flip('losing', on);
                }}
              />
              <Alert
                tone="info"
                icon={<icons.sensitive aria-hidden />}
                title={t('insights.nudge.personal_not_public', 'Personal, not public')}
              >
                {t(
                  'insights.nudge.each_person_only_sees_their_own',
                  'Each person only sees their own numbers. Their managers are not written to.',
                )}
              </Alert>
            </fieldset>
            {nudge.preview === null ? (
              <p className="text-sm text-fg-muted">
                {t('insights.nudge.nobody_to_nudge_right_now', 'Nobody to nudge right now.')}
              </p>
            ) : (
              <Card padded>
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-fg-muted">
                      {t('insights.nudge.preview_for', 'Preview for {{displayName}}', {
                        displayName: nudge.preview.displayName,
                      })}
                    </span>
                    {nudge.preview.ai === true ? (
                      <Badge tone="assistant" size="sm">
                        {t('insights.nudge.ai', 'AI')}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="font-semibold">{nudge.preview.heading}</p>
                  <p className="text-sm text-fg-muted">{nudge.preview.lede}</p>
                </div>
              </Card>
            )}
          </div>
        </DialogBody>
        {result === null ? null : result.ok ? (
          <Alert
            tone="success"
            title={t('insights.nudge.sent_to', 'Sent to {{people}}', {
              people: people(result.sent),
            })}
          >
            {[
              result.unreachable === 0
                ? null
                : t(
                    'insights.nudge.no_work_email_time_off_knows',
                    {
                      one: '{{people}} has no work email Time Off knows.',
                      other: '{{people}} have no work email Time Off knows.',
                    },
                    { count: result.unreachable, people: people(result.unreachable) },
                  ),
              result.failed === 0 ? null : `${String(result.failed)} could not be sent; try again.`,
            ]
              .filter(Boolean)
              .join(' ') ||
              t(
                'insights.nudge.each_sees_only_their_own_numbers',
                'Each sees only their own numbers.',
              )}
          </Alert>
        ) : (
          <Alert tone="danger" title={t('insights.nudge.not_sent', 'Not sent')}>
            {result.message}
          </Alert>
        )}
        <DialogFooter>
          <p className="mr-auto text-sm text-fg-muted">
            {unreachable === 0
              ? t(
                  'insights.nudge.written_per_person_from_time_offs',
                  'Written per person from Time Off’s numbers.',
                )
              : t(
                  'insights.nudge.without_a_work_email_wont_get',
                  '{{people}} without a work email won’t get one.',
                  { people: people(unreachable) },
                )}
          </p>
          <Button onClick={onClose}>
            {result?.ok === true
              ? t('insights.nudge.done', 'Done')
              : t('insights.nudge.cancel', 'Cancel')}
          </Button>
          {onSend === undefined || result?.ok === true ? null : (
            <Button
              variant="primary"
              startIcon={<icons.send aria-hidden />}
              disabled={n === unreachable}
              loading={busy}
              loadingLabel={t('insights.nudge.sending', 'Sending')}
              onClick={() => {
                setBusy(true);
                void onSend(include).then((sent) => {
                  setBusy(false);
                  setResult(sent);
                });
              }}
            >
              {t('insights.nudge.send_now', 'Send now')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
