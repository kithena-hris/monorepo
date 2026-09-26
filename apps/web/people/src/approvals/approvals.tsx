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
  EmptyState,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  PageHeader,
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

import { Loaded, type Loadable, type Outcome } from '../load';
import { DisplayValue, longDate } from '../record/display';
import type { AttributeValue, PendingValue, RecordField } from '../record/model';
import { ApproveAlone, PendingBadge } from '../record/pending';

/**
 * The approvals inbox (PEO-077; PRD §8.6).
 *
 * A change to a sensitive field — a bank account, a salary, whatever the
 * tenant switched on — is held, not applied, until somebody other than the
 * requester and the person it is about approves it. HR sees every change
 * waiting here, oldest first, with the value asked for beside the value in
 * force; anybody else sees their own, and may withdraw one. Undecided after
 * seven days, a change lapses. An approval applies the value from the date
 * it was asked for.
 *
 * Two exceptions, both People's rules shown here. The tenant's only HR member
 * approves their own change alone, after a dialog that says so. And a
 * national identifier our checks doubt is reviewed before it is approved: it
 * reads *Awaiting identifier review*, with what the checks found, and offers
 * no approval until HR accepts it under Identifiers to review.
 */

export interface ApprovalItem extends PendingValue {
  readonly personId: string;
  readonly name: string;
  /** False where the viewer may not read the field: they decide on who, when and why. */
  readonly readable: boolean;
  /** What is in force now, masked as the field is. */
  readonly current: AttributeValue;
}

export interface ApprovalsState {
  readonly isHr: boolean;
  readonly items: readonly ApprovalItem[];
}

export interface ApprovalsProps {
  readonly load: Loadable<ApprovalsState>;
  readonly onDecide: (changeId: string, approve: boolean, note: string | null) => Promise<Outcome>;
  readonly onWithdraw: (changeId: string) => Promise<Outcome>;
  /** The only HR member approving their own change, once they confirm (PEO-077). */
  readonly onSelfApprove?: (changeId: string) => Promise<Outcome>;
  readonly onOpen?: (personId: string) => void;
}

/** Enough of a field to draw a value: a pending value carries no options or type. */
const asField = (item: ApprovalItem): RecordField => ({
  key: item.key,
  label: item.label,
  description: null,
  dataType: 'text',
  options: [],
  required: false,
  readOnly: true,
  sensitive: true,
});

export function Approvals({
  load,
  onDecide,
  onWithdraw,
  onSelfApprove,
  onOpen,
}: ApprovalsProps): JSX.Element {
  return (
    <Loaded load={load} what="changes waiting for approval">
      {(state) => (
        <Inbox
          state={state}
          onDecide={onDecide}
          onWithdraw={onWithdraw}
          onSelfApprove={onSelfApprove}
          onOpen={onOpen}
        />
      )}
    </Loaded>
  );
}

function Inbox({
  state,
  onDecide,
  onWithdraw,
  onSelfApprove,
  onOpen,
}: {
  readonly state: ApprovalsState;
  readonly onDecide: ApprovalsProps['onDecide'];
  readonly onWithdraw: ApprovalsProps['onWithdraw'];
  readonly onSelfApprove: ApprovalsProps['onSelfApprove'];
  readonly onOpen: ApprovalsProps['onOpen'];
}): JSX.Element {
  const [deciding, setDeciding] = useState<{ item: ApprovalItem; approve: boolean } | null>(null);
  const [refused, setRefused] = useState<string | null>(null);

  return (
    <Stack gap={6}>
      <PageHeader
        title={state.isHr ? 'Changes waiting for approval' : 'Your changes waiting for approval'}
        description={
          state.isHr
            ? 'Nothing here is applied until somebody other than who asked, and other than the person it is about, approves it. Undecided after seven days, a change lapses.'
            : 'HR decides each within seven days. Until then your record keeps what it had.'
        }
      />
      {refused === null ? null : (
        <Alert tone="danger" title="That did not go through">
          {refused}
        </Alert>
      )}
      {state.items.length === 0 ? (
        <EmptyState title="Nothing waiting" description="Every change has been decided." />
      ) : (
        <Table aria-label="Changes waiting for approval">
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead>Field</TableHead>
              <TableHead>Change</TableHead>
              <TableHead>Asked</TableHead>
              <TableHead>Decide</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.items.map((item) => {
              const field = asField(item);
              return (
                <TableRow key={item.id}>
                  <TableCell>
                    {onOpen === undefined ? (
                      item.name
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          onOpen(item.personId);
                        }}
                      >
                        {item.name}
                      </Button>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-2">
                      {item.label}
                      <Badge tone="sensitive" size="sm">
                        Sensitive
                      </Badge>
                      <PendingBadge pending={item} />
                    </span>
                  </TableCell>
                  <TableCell>
                    {item.readable ? (
                      <span className="flex flex-col gap-1 text-sm">
                        <span>
                          Now: <DisplayValue field={field} value={item.current} />
                        </span>
                        <span>
                          {item.kind === 'correction' ? 'Corrected to' : 'Asked'}:{' '}
                          <DisplayValue field={field} value={item.value} />
                        </span>
                      </span>
                    ) : (
                      <span className="text-sm text-fg-muted">
                        You cannot read this field; decide on who asked, when and why.
                      </span>
                    )}
                    <span className="block text-sm text-fg-muted">
                      From {longDate(item.effectiveFrom)}
                    </span>
                    {item.awaitingReview === true && (item.findings ?? []).length > 0 ? (
                      <ul className="flex flex-col gap-1 text-sm">
                        {(item.findings ?? []).map((f) => (
                          <li key={f.code}>{f.message}</li>
                        ))}
                      </ul>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-col gap-1 text-sm">
                      <span>
                        {item.requestedBy}, {longDate(item.requestedAt.slice(0, 10))}
                      </span>
                      {item.reason === null ? null : <span>“{item.reason}”</span>}
                      <span className="text-fg-muted">
                        Lapses {longDate(item.expiresAt.slice(0, 10))}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-2">
                      {item.awaitingReview === true ? (
                        <span className="text-sm text-fg-muted">
                          Reviewed first: accept it or send it back under Identifiers to review,
                          then it can be approved.
                        </span>
                      ) : null}
                      {item.canSelfApprove === true &&
                      item.awaitingReview !== true &&
                      onSelfApprove !== undefined ? (
                        <ApproveAlone
                          label={`${item.name}'s ${item.label}`}
                          onApprove={() => onSelfApprove(item.id)}
                        />
                      ) : null}
                      {item.canDecide ? (
                        <>
                          {item.awaitingReview === true ? null : (
                            <Button
                              size="sm"
                              variant="primary"
                              aria-label={`Approve the change to ${item.name}'s ${item.label}`}
                              onClick={() => {
                                setDeciding({ item, approve: true });
                              }}
                            >
                              Approve
                            </Button>
                          )}
                          <Button
                            size="sm"
                            aria-label={`Reject the change to ${item.name}'s ${item.label}`}
                            onClick={() => {
                              setDeciding({ item, approve: false });
                            }}
                          >
                            Reject
                          </Button>
                        </>
                      ) : null}
                      {item.mine ? (
                        <Button
                          size="sm"
                          aria-label={`Withdraw the change to ${item.name}'s ${item.label}`}
                          onClick={() => {
                            setRefused(null);
                            void onWithdraw(item.id).then((outcome) => {
                              if (!outcome.ok) setRefused(outcome.message);
                            });
                          }}
                        >
                          Withdraw
                        </Button>
                      ) : null}
                      {!item.canDecide && !item.mine ? (
                        <span className="text-sm text-fg-muted">
                          Somebody else decides: it is about you.
                        </span>
                      ) : null}
                      {!item.canDecide && item.mine && state.isHr && item.canSelfApprove !== true ? (
                        <span className="text-sm text-fg-muted">
                          Another HR member decides your own change.
                        </span>
                      ) : null}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {deciding === null ? null : (
        <Decide
          item={deciding.item}
          approve={deciding.approve}
          onDecide={onDecide}
          onClose={() => {
            setDeciding(null);
          }}
        />
      )}
    </Stack>
  );
}

function Decide({
  item,
  approve,
  onDecide,
  onClose,
}: {
  readonly item: ApprovalItem;
  readonly approve: boolean;
  readonly onDecide: ApprovalsProps['onDecide'];
  readonly onClose: () => void;
}): JSX.Element {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const verb = approve ? 'Approve' : 'Reject';

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
            {verb} the change to {item.name}'s {item.label}
          </DialogTitle>
          <DialogDescription>
            {approve
              ? `It takes effect from ${longDate(item.effectiveFrom)}, as asked. This is final.`
              : 'It is not applied, and the record keeps what it has. This is final.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Stack gap={4}>
            <Field>
              <FieldLabel>Note</FieldLabel>
              <FieldControl>
                <Textarea
                  value={note}
                  maxLength={500}
                  onChange={(e) => {
                    setNote(e.target.value);
                  }}
                />
              </FieldControl>
              <FieldDescription>Optional; kept with the decision.</FieldDescription>
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
              setBusy(true);
              setRefused(null);
              void onDecide(item.id, approve, note.trim() === '' ? null : note.trim()).then(
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
