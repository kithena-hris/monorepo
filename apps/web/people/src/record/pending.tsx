import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Stack,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import type { Outcome } from '../load';
import { DisplayValue, longDate } from './display';
import type { PendingValue, RecordField } from './model';

/**
 * A value waiting for HR's approval, beside the field it would change
 * (PEO-077). Never in place of the value: the record reads what is in force,
 * and this says what is asked for, from when, by whom, and until when it
 * waits. Its requester may take it back here — and, when they are the only
 * HR member, approve it themselves once they confirm it.
 */
export function PendingNote({
  field,
  pending,
  onWithdraw,
  onSelfApprove,
}: {
  readonly field: RecordField;
  readonly pending: PendingValue;
  readonly onWithdraw?: ((changeId: string) => Promise<Outcome>) | undefined;
  readonly onSelfApprove?: ((changeId: string) => Promise<Outcome>) | undefined;
}): JSX.Element {
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm">
      <PendingBadge pending={pending} />
      <span>
        {pending.kind === 'correction' ? 'Correction to ' : ''}
        <DisplayValue field={field} value={pending.value} />, from {longDate(pending.effectiveFrom)}
        , asked by {pending.requestedBy}; waits until {longDate(pending.expiresAt.slice(0, 10))}.
      </span>
      {pending.awaitingReview === true ? (
        <span className="text-fg-muted">
          HR reviews what our checks doubted before it can be approved.
        </span>
      ) : null}
      {pending.canSelfApprove === true && pending.awaitingReview !== true && onSelfApprove ? (
        <ApproveAlone
          label={field.label}
          onApprove={() => onSelfApprove(pending.id)}
        />
      ) : null}
      {pending.mine && onWithdraw !== undefined ? (
        <Button
          size="sm"
          aria-label={`Withdraw the change to ${field.label}`}
          onClick={() => {
            void onWithdraw(pending.id);
          }}
        >
          Withdraw
        </Button>
      ) : null}
    </span>
  );
}

/** Where a held change stands: waiting on its review first, or on approval (PEO-125). */
export function PendingBadge({ pending }: { readonly pending: PendingValue }): JSX.Element {
  return pending.awaitingReview === true ? (
    <Badge tone="warning" size="sm">
      Awaiting identifier review
    </Badge>
  ) : (
    <Badge tone="warning" size="sm">
      Pending approval
    </Badge>
  );
}

/**
 * A requester approving their own change when no other HR member can
 * (PEO-077): they are the only one, or the only other is its subject. It is
 * allowed — but never by one click: the dialog says there is no
 * other approver and that the audit trail records it as theirs alone, and
 * only the confirmation approves. People checks again when it arrives: if
 * an eligible approver holds HR by then, they decide instead.
 */
export function ApproveAlone({
  label,
  onApprove,
}: {
  readonly label: string;
  readonly onApprove: () => Promise<Outcome>;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  return (
    <>
      <Button
        size="sm"
        variant="primary"
        aria-label={`Approve the change to ${label} yourself`}
        onClick={() => {
          setRefused(null);
          setOpen(true);
        }}
      >
        Approve it myself
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve your own change to {label}?</DialogTitle>
            <DialogDescription>
              There is no other HR member who can approve it: nobody else holds HR, or the
              only other HR member is the person it is about, who never approves their own.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Stack gap={4}>
              <Alert tone="warning" title="Recorded as approved by you alone">
                The audit trail will show that you approved your own change because no other HR
                member could. If somebody who can joins HR first, they approve it instead.
              </Alert>
              {refused === null ? null : (
                <Alert tone="danger" title="Not approved">
                  {refused}
                </Alert>
              )}
            </Stack>
          </DialogBody>
          <DialogFooter>
            <Button
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={busy}
              loadingLabel="Approving"
              onClick={() => {
                setBusy(true);
                setRefused(null);
                void onApprove().then((outcome) => {
                  setBusy(false);
                  if (outcome.ok) setOpen(false);
                  else setRefused(outcome.message);
                });
              }}
            >
              Approve it myself
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The sensitive marker beside a label drawn outside a `Field` (PEO-077). */
export function SensitiveMark({ field }: { readonly field: RecordField }): JSX.Element | null {
  return field.sensitive === true ? (
    <Badge tone="sensitive" size="sm">
      Sensitive
    </Badge>
  ) : null;
}
