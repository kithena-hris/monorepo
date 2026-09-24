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

/**
 * HR's review of the national identifiers our checks doubted (PEO-125; PRD
 * §8.4).
 *
 * A doubtful value was saved, not refused. Here HR sees what the checks found
 * — "it matches the national format but the control letter does not compute",
 * "valid shape, but the holder is a company" — and decides. **Accept** is
 * final: the value is never flagged again. **Send back** asks the employee to
 * correct it, and their record says so. The value itself is shown only on
 * request, through People's audited reveal; the row shows its last four.
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
}

export interface IdentifierReviewsState {
  readonly items: readonly ReviewItem[];
}

export type Revealed =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly message: string };

export interface IdentifierReviewsProps {
  readonly load: Loadable<IdentifierReviewsState>;
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

const day = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function IdentifierReviews({ load, onDecide, onReveal }: IdentifierReviewsProps): JSX.Element {
  return (
    <Loaded load={load} what="identifiers to review">
      {(state) => <Queue state={state} onDecide={onDecide} onReveal={onReveal} />}
    </Loaded>
  );
}

function Queue({
  state,
  onDecide,
  onReveal,
}: {
  readonly state: IdentifierReviewsState;
  readonly onDecide: IdentifierReviewsProps['onDecide'];
  readonly onReveal: IdentifierReviewsProps['onReveal'];
}): JSX.Element {
  const [deciding, setDeciding] = useState<{ item: ReviewItem; accept: boolean } | null>(null);
  const [shown, setShown] = useState<Readonly<Record<string, string>>>({});
  const [refused, setRefused] = useState<string | null>(null);
  const id = (item: ReviewItem) => `${item.personId}/${item.attributeKey}`;

  return (
    <Stack gap={6}>
      <PageHeader
        title="Identifiers to review"
        description="Saved, but our checks doubt them. Whatever you decide is final."
      />
      {refused === null ? null : (
        <Alert tone="danger" title="Could not show the value">
          {refused}
        </Alert>
      )}
      {state.items.length === 0 ? (
        <EmptyState
          title="Nothing to review"
          description="Every national identifier entered so far passed its country's checks, or has been reviewed."
        />
      ) : (
        <Table aria-label="Identifiers to review">
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>What the checks found</TableHead>
              <TableHead>Decide</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.items.map((item) => (
              <TableRow key={id(item)}>
                <TableCell>
                  {item.name}
                  <span className="block text-fg-muted text-sm">
                    {item.label}, entered {day(item.enteredAt)}
                  </span>
                </TableCell>
                <TableCell>
                  {shown[id(item)] !== undefined ? (
                    <span className="font-mono">{shown[id(item)]}</span>
                  ) : (
                    <Stack gap={2}>
                      <span className="font-mono">
                        {item.last4 === null ? '—' : `•••• ${item.last4}`}
                      </span>
                      <div>
                        <Button
                          size="sm"
                          aria-label={`Show ${item.name}'s ${item.label} in full`}
                          onClick={() => {
                            setRefused(null);
                            void onReveal(item.personId, item.attributeKey).then((r) => {
                              if (r.ok) setShown((s) => ({ ...s, [id(item)]: r.value }));
                              else setRefused(r.message);
                            });
                          }}
                        >
                          Show value
                        </Button>
                      </div>
                    </Stack>
                  )}
                </TableCell>
                <TableCell>
                  <ul className="flex flex-col gap-2">
                    {item.findings.map((f) => {
                      const level = LEVEL[f.level as keyof typeof LEVEL] ?? LEVEL.attention;
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
                </TableCell>
                <TableCell>
                  <span className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      aria-label={`Accept ${item.name}'s ${item.label}`}
                      onClick={() => {
                        setDeciding({ item, accept: true });
                      }}
                    >
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      aria-label={`Send ${item.name}'s ${item.label} back`}
                      onClick={() => {
                        setDeciding({ item, accept: false });
                      }}
                    >
                      Send back
                    </Button>
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {deciding === null ? null : (
        <Decide
          item={deciding.item}
          accept={deciding.accept}
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
  accept,
  onDecide,
  onClose,
}: {
  readonly item: ReviewItem;
  readonly accept: boolean;
  readonly onDecide: IdentifierReviewsProps['onDecide'];
  readonly onClose: () => void;
}): JSX.Element {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const verb = accept ? 'Accept' : 'Send back';

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
            {verb} {item.name}'s {item.label}
          </DialogTitle>
          <DialogDescription>
            {accept
              ? 'Final: this value will not be flagged again, whatever a later check says.'
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
              <FieldDescription>
                {accept
                  ? 'Optional; kept with the decision.'
                  : `Optional; ${item.name} sees it on their record.`}
              </FieldDescription>
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
