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
  MaskedValue,
  PINNED_BAR,
  Stack,
  Textarea,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import type { Outcome } from '../load';

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
  readonly attributeKey: string;
  readonly label: string;
  readonly last4: string | null;
  readonly findings: readonly ReviewFinding[];
  readonly enteredAt: string;
  /** Held for approval, not yet written: reviewed first, then approved. */
  readonly held?: boolean;
}

export interface IdentifierReviewsState {
  readonly items: readonly ReviewItem[];
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
  mismatch: { tone: 'danger', text: 'Does not compute' },
  attention: { tone: 'warning', text: 'Needs attention' },
} as const;

/** An item's id in Review's address: whose identifier, and which. */
export const idCheckId = (item: ReviewItem): string => `${item.personId}~${item.attributeKey}`;

/** Failed, or only unverifiable: the badge on its row. */
export function verdictOf(item: ReviewItem): { readonly tone: 'danger' | 'warning'; readonly text: string } {
  return item.findings.some((f) => f.level === 'mismatch')
    ? { tone: 'danger', text: 'Failed' }
    : { tone: 'warning', text: 'Unverifiable' };
}

const day = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', {
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
        <Avatar size="xl" name={item.name} />
        <div className="min-w-0 flex-1">
          <h2 className="text-md font-bold">
            {item.name}
            <span className="font-normal text-fg-muted"> · {item.label}</span>
          </h2>
          <p className="text-sm text-fg-muted">Entered on {day(item.enteredAt)}</p>
        </div>
        {item.held === true ? (
          <Badge tone="warning" size="sm" className="shrink-0">
            Waiting for approval
          </Badge>
        ) : null}
      </div>
      {refused === null ? null : (
        <Alert tone="danger" title="Could not show the value">
          {refused}
        </Alert>
      )}
      <div className="@container grid gap-3 @md:grid-cols-2">
        <Card variant="fill" padded className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-fg-muted">What they entered</p>
          <MaskedValue
            masked={item.last4 === null ? '—' : `•••• ${item.last4}`}
            value={shown}
            label={`${item.name}'s ${item.label} in full`}
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
          <p className="text-xs font-semibold text-fg-muted">What the checks found</p>
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
        Revealing the value is logged. Whatever you decide is final.
      </p>
      <div
        {...PINNED_BAR}
        className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4 touch:sticky touch:bottom-24 touch:z-10 touch:grid touch:grid-cols-2 touch:bg-surface touch:py-2"
      >
        <Button
          aria-label={`Send ${item.name}'s ${item.label} back`}
          onClick={() => {
            setDeciding(false);
          }}
        >
          Ask {first} to correct it
        </Button>
        <Button
          variant="primary"
          aria-label={`Accept ${item.name}'s ${item.label}`}
          onClick={() => {
            setDeciding(true);
          }}
        >
          Mark as correct anyway
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
  const verb = accept ? 'Accept' : 'Send back';

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent sheetOnTouch={false}>
        <DialogHeader>
          <DialogTitle>
            {accept ? 'Accept' : 'Send back'} {item.name}’s {item.label}
          </DialogTitle>
          <DialogDescription>
            {accept
              ? item.held === true
                ? 'Final: this value will not be flagged again, and the change can now be approved.'
                : 'Final: this value will not be flagged again, whatever a later check says.'
              : item.held === true
                ? `The change is declined, and ${item.name} is asked to correct it. They see your reason on their record and by email.`
                : `${item.name} is asked to correct it, and their record shows it needs attention.`}
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
              <FieldLabel>{accept ? 'Note' : 'What is wrong'}</FieldLabel>
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
                  : `${item.name} sees it on their record, so they know what to correct.`}
              </FieldDescription>
              <FieldError>Say what is wrong, so they know what to correct.</FieldError>
            </Field>
            {refused === null ? null : (
              <Alert tone="danger" title="Not decided">
                {refused}
              </Alert>
            )}
          </Stack>
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            loadingLabel="Saving"
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
