import {
  Alert,
  Avatar,
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
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  locale,
  MaskedValue,
  PINNED_BAR,
  Stack,
  Textarea,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import type { Outcome } from '../load';
import { t } from '../i18n';

/**
 * HR's review of the national identifiers our checks doubted (PEO-125; PRD
 * §8.4).
 *
 * A doubtful value was saved, not refused. Here HR sees what the checks found
 * — "it matches the national format but the control letter does not compute",
 * "valid shape, but the holder is a company" — and decides. **Accept** is
 * final: the value is never flagged again. **Send back** asks the employee to
 * correct it, always with a reason, and their record shows it. The value
 * itself is shown only on request, through People's audited reveal; the row
 * shows its last four.
 *
 * A value held for approval (PEO-077) is reviewed here before it is written:
 * accepting it lets HR approve it; sending it back declines the change, and
 * the employee sees the reason and corrects it.
 */

export interface ReviewFinding {
  /** attention or mismatch. */
  readonly level: string;
  readonly code: string;
  readonly message: string;
}

export interface ReviewItem {
  readonly personId: string;
  readonly name: string;
  /** Their photo, when they have one and the viewer may read them. Absent from an older People. */
  readonly avatarUrl?: string | null;
  readonly attributeKey: string;
  readonly label: string;
  readonly last4: string | null;
  readonly findings: readonly ReviewFinding[];
  readonly enteredAt: string;
  /** Held for approval, not yet written: reviewed first, then approved. */
  readonly held?: boolean;
  /** Who entered it, as the viewer may name them; null when not recorded. Absent from an older People. */
  readonly enteredBy?: string | null;
}

/** An identifier HR decided (E9). Never the value. */
export interface DecidedReview {
  readonly personId: string;
  readonly name: string;
  readonly label: string;
  readonly outcome: 'accepted' | 'sent_back';
  readonly decidedBy: string;
  readonly decidedAt: string;
  readonly note: string | null;
}

export interface IdentifierReviewsState {
  readonly items: readonly ReviewItem[];
  /** The place of the queue's next page; null on the last. Absent from an older People. */
  readonly next?: string | null;
  /** Decided in the last 90 days, newest first. Absent from an older People. */
  readonly decided?: readonly DecidedReview[];
}

export type Revealed =
  { readonly ok: true; readonly value: string } | { readonly ok: false; readonly message: string };

/** What an ID check's detail pane may do. */
export interface IdCheckActions {
  readonly onDecide: (
    personId: string,
    attributeKey: string,
    decision: 'accept' | 'send_back',
    note: string | null,
  ) => Promise<Outcome>;
  /** The value in full, audited by People. */
  readonly onReveal: (personId: string, attributeKey: string) => Promise<Revealed>;
}

const LEVEL = {
  mismatch: {
    tone: 'danger',
    text: t('review.identifier-reviews.does_not_compute', 'Does not compute'),
  },
  attention: {
    tone: 'warning',
    text: t('review.identifier-reviews.needs_attention', 'Needs attention'),
  },
} as const;

/** An item's id in Review's address: whose identifier, and which. */
export const idCheckId = (item: ReviewItem): string => `${item.personId}~${item.attributeKey}`;

/** Failed, or only unverifiable: the badge on its row. */
export function verdictOf(item: ReviewItem): {
  readonly tone: 'danger' | 'warning';
  readonly text: string;
} {
  return item.findings.some((f) => f.level === 'mismatch')
    ? { tone: 'danger', text: t('review.identifier-reviews.failed', 'Failed') }
    : { tone: 'warning', text: t('review.identifier-reviews.unverifiable', 'Unverifiable') };
}

const day = (iso: string): string =>
  new Date(iso).toLocaleDateString(locale(), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/**
 * One identifier to check (design E2, MA E3): what was entered, masked until
 * revealed, what the checks found, and the two decisions, each confirmed in a
 * short dialog.
 */
export function IdCheckDetail({
  item,
  onDecide,
  onReveal,
}: { readonly item: ReviewItem } & IdCheckActions): JSX.Element {
  const [deciding, setDeciding] = useState<boolean | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const first = item.name.split(' ')[0] ?? item.name;
  return (
    <Card padded className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <Avatar size="xl" name={item.name} src={item.avatarUrl ?? undefined} />
        <div className="min-w-0 flex-1">
          <h2 className="text-md font-bold">
            {item.name}
            <span className="font-normal text-fg-muted"> · {item.label}</span>
          </h2>
          <p className="text-sm text-fg-muted">
            {t('review.identifier-reviews.entered', 'Entered')}{' '}
            {item.enteredBy == null
              ? ''
              : t('review.identifier-reviews.by', 'by {{enteredBy}}', {
                  enteredBy: item.enteredBy,
                }) + ' '}
            {t('review.identifier-reviews.on', 'on')} {day(item.enteredAt)}
          </p>
        </div>
        {item.held === true ? (
          <Badge tone="warning" size="sm" className="shrink-0">
            {t('review.identifier-reviews.waiting_for_approval', 'Waiting for approval')}
          </Badge>
        ) : null}
      </div>
      {refused === null ? null : (
        <Alert
          tone="danger"
          title={t(
            'review.identifier-reviews.could_not_show_the_value',
            'Could not show the value',
          )}
        >
          {refused}
        </Alert>
      )}
      <div className="@container grid gap-3 @md:grid-cols-2">
        <Card variant="fill" padded className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-fg-muted">
            {t('review.identifier-reviews.what_they_entered', 'What they entered')}
          </p>
          <MaskedValue
            masked={item.last4 === null ? '—' : `•••• ${item.last4}`}
            value={shown}
            label={t('review.identifier-reviews.s_in_full', "{{name}}'s {{label}} in full", {
              name: item.name,
              label: item.label,
            })}
            onReveal={() => {
              setRefused(null);
              void onReveal(item.personId, item.attributeKey).then((r) => {
                if (r.ok) setShown(r.value);
                else setRefused(r.message);
              });
            }}
            onHide={() => {
              setShown(null);
            }}
          />
        </Card>
        <Card variant="fill" padded className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-fg-muted">
            {t('review.identifier-reviews.what_the_checks_found', 'What the checks found')}
          </p>
          <ul className="flex flex-col gap-2">
            {item.findings.map((f) => {
              const level = f.level === 'mismatch' ? LEVEL.mismatch : LEVEL.attention;
              return (
                <li key={f.code} className="flex flex-col gap-1">
                  <span>
                    <Badge tone={level.tone} size="sm">
                      {level.text}
                    </Badge>
                  </span>
                  <span className="text-sm">{f.message}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
      <p className="text-sm text-fg-muted">
        {t(
          'review.identifier-reviews.revealing_the_value_is_logged_whatever',
          'Revealing the value is logged. Whatever you decide is final.',
        )}
      </p>
      <div
        {...PINNED_BAR}
        className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4 touch:sticky touch:bottom-24 touch:z-10 touch:grid touch:grid-cols-2 touch:bg-surface touch:py-2"
      >
        <Button
          // Each name starts with what the button says (WCAG 2.5.3, Label in Name).
          aria-label={t(
            'review.identifier-reviews.ask_to_correct_it_s',
            "Ask {{first}} to correct it: {{name}}'s {{label}}",
            { first, name: item.name, label: item.label },
          )}
          onClick={() => {
            setDeciding(false);
          }}
        >
          {t('review.identifier-reviews.ask_to_correct_it', 'Ask {{first}} to correct it', {
            first,
          })}
        </Button>
        <Button
          variant="primary"
          aria-label={t(
            'review.identifier-reviews.mark_as_correct_anyway_s',
            "Mark as correct anyway: {{name}}'s {{label}}",
            { name: item.name, label: item.label },
          )}
          onClick={() => {
            setDeciding(true);
          }}
        >
          {t('review.identifier-reviews.mark_as_correct_anyway', 'Mark as correct anyway')}
        </Button>
      </div>
      {deciding === null ? null : (
        <Decide
          item={item}
          accept={deciding}
          onDecide={onDecide}
          onClose={() => {
            setDeciding(null);
          }}
        />
      )}
    </Card>
  );
}

function Decide({
  item,
  accept,
  onDecide,
  onClose,
}: {
  readonly item: ReviewItem;
  readonly accept: boolean;
  readonly onDecide: IdCheckActions['onDecide'];
  readonly onClose: () => void;
}): JSX.Element {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  // Sent back without a reason, the employee cannot tell what to correct.
  const [unexplained, setUnexplained] = useState(false);
  const verb = accept
    ? t('review.identifier-reviews.accept', 'Accept')
    : t('review.identifier-reviews.send_back', 'Send back');

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
            {accept
              ? t('review.identifier-reviews.accept', 'Accept')
              : t('review.identifier-reviews.send_back', 'Send back')}{' '}
            {item.name}’s {item.label}
          </DialogTitle>
          <DialogDescription>
            {accept
              ? item.held === true
                ? t(
                    'review.identifier-reviews.final_this_value_will_not_be',
                    'Final: this value will not be flagged again, and the change can now be approved.',
                  )
                : t(
                    'review.identifier-reviews.final_this_value_will_not_be_2',
                    'Final: this value will not be flagged again, whatever a later check says.',
                  )
              : item.held === true
                ? t(
                    'review.identifier-reviews.the_change_is_declined_and_is',
                    'The change is declined, and {{name}} is asked to correct it. They see your reason on their record and by email.',
                    { name: item.name },
                  )
                : t(
                    'review.identifier-reviews.is_asked_to_correct_it_and',
                    '{{name}} is asked to correct it, and their record shows it needs attention.',
                    { name: item.name },
                  )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Stack gap={4}>
            <ul className="flex flex-col gap-1 text-sm">
              {item.findings.map((f) => (
                <li key={f.code}>{f.message}</li>
              ))}
            </ul>
            <Field required={!accept} invalid={!accept && unexplained}>
              <FieldLabel>
                {accept
                  ? t('review.identifier-reviews.note', 'Note')
                  : t('review.identifier-reviews.what_is_wrong', 'What is wrong')}
              </FieldLabel>
              <FieldControl>
                <Textarea
                  value={note}
                  maxLength={500}
                  onChange={(e) => {
                    setNote(e.target.value);
                    setUnexplained(false);
                  }}
                />
              </FieldControl>
              <FieldDescription>
                {accept
                  ? 'Optional; kept with the decision.'
                  : t(
                      'review.identifier-reviews.sees_it_on_their_record_so',
                      '{{name}} sees it on their record, so they know what to correct.',
                      { name: item.name },
                    )}
              </FieldDescription>
              <FieldError>
                {t(
                  'review.identifier-reviews.say_what_is_wrong_so_they',
                  'Say what is wrong, so they know what to correct.',
                )}
              </FieldError>
            </Field>
            {refused === null ? null : (
              <Alert
                tone="danger"
                title={t('review.identifier-reviews.not_decided', 'Not decided')}
              >
                {refused}
              </Alert>
            )}
          </Stack>
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>{t('review.identifier-reviews.cancel', 'Cancel')}</Button>
          <Button
            variant="primary"
            loading={busy}
            loadingLabel={t('review.identifier-reviews.saving', 'Saving')}
            onClick={() => {
              if (!accept && note.trim() === '') {
                setUnexplained(true);
                return;
              }
              setBusy(true);
              setRefused(null);
              void onDecide(
                item.personId,
                item.attributeKey,
                accept ? 'accept' : 'send_back',
                note.trim() === '' ? null : note.trim(),
              ).then((outcome) => {
                setBusy(false);
                if (outcome.ok) onClose();
                else setRefused(outcome.message);
              });
            }}
          >
            {verb}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
