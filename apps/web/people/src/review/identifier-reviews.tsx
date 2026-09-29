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
  EmptyState,
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  List,
  ListDetail,
  ListItem,
  MaskedValue,
  PageHeader,
  Stack,
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

const id = (item: ReviewItem): string => `${item.personId}/${item.attributeKey}`;

const day = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function IdentifierReviews({
  load,
  onDecide,
  onReveal,
}: IdentifierReviewsProps): JSX.Element {
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
  const [picked, setPicked] = useState<string | null>(null);
  const current = state.items.find((i) => id(i) === picked) ?? state.items[0] ?? null;
  const worst = (item: ReviewItem) =>
    item.findings.some((f) => f.level === 'mismatch') ? LEVEL.mismatch : LEVEL.attention;

  return (
    <Stack gap={5}>
      <PageHeader
        title="ID verification"
        description="National identifiers that failed a check, or need a person to look at them. Whatever you decide is final."
      />
      {refused === null ? null : (
        <Alert tone="danger" title="Could not show the value">
          {refused}
        </Alert>
      )}
      {state.items.length === 0 || current === null ? (
        <EmptyState
          title="Nothing to review"
          description="Every national identifier entered so far passed its country's checks, or has been reviewed."
        />
      ) : (
        <ListDetail
          listWidth="27.5rem"
          listLabel="Identifiers to review"
          detailLabel={`${current.name}’s ${current.label}`}
          selected={picked !== null}
          onBack={() => {
            setPicked(null);
          }}
          backLabel="All identifiers"
          list={
            <List aria-label="Identifiers to review">
              {state.items.map((item) => (
                <ListItem
                  key={id(item)}
                  asChild
                  selected={id(item) === id(current)}
                  leading={<Avatar size="lg" name={item.name} />}
                  description={`${item.label} · ${item.findings[0]?.message ?? ''}`}
                  trailing={
                    <Badge tone={worst(item).tone} size="sm">
                      {worst(item) === LEVEL.mismatch ? 'Failed' : 'Unverifiable'}
                    </Badge>
                  }
                >
                  <button
                    type="button"
                    aria-current={id(item) === id(current) ? true : undefined}
                    onClick={() => {
                      setPicked(id(item));
                    }}
                  >
                    {item.name}
                  </button>
                </ListItem>
              ))}
            </List>
          }
          detail={
            <div className="flex flex-col gap-4 rounded-lg bg-surface p-5 shadow-sm touch:rounded-[1.375rem] touch:p-4">
              <div className="flex items-center gap-3">
                <Avatar size="xl" name={current.name} />
                <div className="min-w-0">
                  <h2 className="text-md font-bold">
                    {current.name} · {current.label}
                  </h2>
                  <p className="text-sm text-fg-muted">Entered on {day(current.enteredAt)}</p>
                </div>
                {current.held === true ? (
                  <Badge tone="warning" size="sm" className="ms-auto">
                    Waiting for approval
                  </Badge>
                ) : null}
              </div>
              <div className="grid gap-3 @md:grid-cols-2 @container">
                <Card variant="fill" padded className="flex flex-col gap-2">
                  <p className="text-xs font-semibold text-fg-muted">What they entered</p>
                  <MaskedValue
                    masked={current.last4 === null ? '—' : `•••• ${current.last4}`}
                    value={shown[id(current)] ?? null}
                    label={`${current.name}'s ${current.label} in full`}
                    onReveal={() => {
                      setRefused(null);
                      void onReveal(current.personId, current.attributeKey).then((r) => {
                        if (r.ok) setShown((s) => ({ ...s, [id(current)]: r.value }));
                        else setRefused(r.message);
                      });
                    }}
                    onHide={() => {
                      setShown((s) =>
                        Object.fromEntries(Object.entries(s).filter(([k]) => k !== id(current))),
                      );
                    }}
                  />
                </Card>
                <Card variant="fill" padded className="flex flex-col gap-2">
                  <p className="text-xs font-semibold text-fg-muted">What the checks found</p>
                  <ul className="flex flex-col gap-2">
                    {current.findings.map((f) => {
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
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="ghost"
                  aria-label={`Accept ${current.name}'s ${current.label}`}
                  onClick={() => {
                    setDeciding({ item: current, accept: true });
                  }}
                >
                  Mark as correct anyway
                </Button>
                <Button
                  variant="primary"
                  className="ms-auto"
                  aria-label={`Send ${current.name}'s ${current.label} back`}
                  onClick={() => {
                    setDeciding({ item: current, accept: false });
                  }}
                >
                  Ask {current.name.split(' ')[0]} to correct it
                </Button>
              </div>
            </div>
          }
        />
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {verb} {item.name}'s {item.label}
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
