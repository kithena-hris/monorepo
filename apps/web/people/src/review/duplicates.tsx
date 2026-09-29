import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  DataTable,
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
  MergeCompare,
  PageHeader,
  RadioGroup,
  RadioGroupItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  icons,
  type DataColumn,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { DATA_HEALTH } from '../data-health';
import { Loaded, type Loadable, type Outcome } from '../load';

/**
 * HR's review of suspected duplicates (PEO-074; PRD §12.4).
 *
 * The queue lists pairs that share a work email, a name with a birth date, or
 * a unique value, and says which — never the value. A pair opens side by side:
 * HR picks the record that survives (People says which may, and why not),
 * ticks the values to take from the other, and merges. **A merge is always
 * HR's decision**, and additive: the other record becomes a tombstone pointing
 * at the survivor, and both histories stay. "Not the same person" takes the
 * pair out of the queue for good.
 *
 * Merges still standing are listed beneath, each with **Undo merge**: HR
 * gives a reason, is told which copied values go back and which are kept
 * because they changed since, and the merged record returns as it was.
 */

export interface DuplicatePair {
  readonly personIds: readonly string[];
  readonly names: readonly string[];
  readonly reasons: readonly string[];
  /**
   * How strong the match is, as People bands it from why the two look alike:
   * a word, never a percentage nobody measured. Absent from an older People.
   */
  readonly match?: MatchBand | null;
}

export type MatchBand = 'strong' | 'likely' | 'possible';

const BAND: Readonly<Record<MatchBand, string>> = {
  strong: 'Strong',
  likely: 'Likely',
  possible: 'Possible',
};

export interface ComparedPerson {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  /** Why this record may not absorb the other; null when it may. */
  readonly refusal: string | null;
}

export interface ComparedRow {
  readonly key: string;
  readonly label: string;
  readonly values: readonly (string | null)[];
  readonly same: boolean;
  /** Whether each side's value could be copied onto the other, were the other to survive. */
  readonly takeable: readonly boolean[];
}

/** A merge HR may undo, and what the undo would reverse and keep, by label. */
export interface MergedPair {
  readonly absorbedId: string;
  readonly survivorId: string;
  readonly absorbedName: string;
  readonly survivorName: string;
  readonly mergedAt: string;
  readonly reversed: readonly string[];
  readonly kept: readonly string[];
  /** The sign-in the merge moved: returned, kept, or null when none moved. */
  readonly account: string | null;
  /** Why it cannot be undone; null when it can. */
  readonly refusal: string | null;
}

export interface DuplicatesState {
  readonly items: readonly DuplicatePair[];
  /** Absent from a state that predates undo: read as none. */
  readonly merges?: readonly MergedPair[];
  readonly comparison: {
    readonly people: readonly ComparedPerson[];
    readonly rows: readonly ComparedRow[];
  } | null;
}

export interface DuplicatesProps {
  readonly load: Loadable<DuplicatesState>;
  readonly onCompare: (a: string, b: string) => void;
  readonly onBack: () => void;
  readonly onMerge: (
    survivorId: string,
    absorbedId: string,
    take: readonly string[],
  ) => Promise<Outcome>;
  readonly onDismiss: (a: string, b: string) => Promise<Outcome>;
  readonly onUnmerge: (absorbedId: string, reason: string) => Promise<Outcome>;
}

export function Duplicates(props: DuplicatesProps): JSX.Element {
  return (
    <Loaded load={props.load} what="possible duplicates">
      {(state) =>
        state.comparison === null ? (
          <Stack gap={8}>
            <Queue items={state.items} onCompare={props.onCompare} onDismiss={props.onDismiss} />
            <Merges merges={state.merges ?? []} onUnmerge={props.onUnmerge} />
          </Stack>
        ) : (
          <Compare
            people={state.comparison.people}
            rows={state.comparison.rows}
            onBack={props.onBack}
            onMerge={props.onMerge}
            onDismiss={props.onDismiss}
          />
        )
      }
    </Loaded>
  );
}

/**
 * The queue (V5): each pair side by side, why it looks alike, how strong the
 * match is (Strong, Likely, Possible), and the two answers. "Not the same" takes
 * the pair out for good; "Compare" opens the side-by-side merge.
 */
function Queue({
  items,
  onCompare,
  onDismiss,
}: {
  readonly items: readonly DuplicatePair[];
  readonly onCompare: DuplicatesProps['onCompare'];
  readonly onDismiss: DuplicatesProps['onDismiss'];
}): JSX.Element {
  const [busy, setBusy] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  // A band is People's to give; from an older People with none, there is no column to show an empty one in.
  const scored = items.some((pair) => pair.match != null);
  const dismiss = (a: string, b: string): void => {
    setBusy(`${a}/${b}`);
    setRefused(null);
    void onDismiss(a, b).then((outcome) => {
      setBusy(null);
      if (!outcome.ok) setRefused(outcome.message);
    });
  };
  const columns: DataColumn<DuplicatePair>[] = [
    {
      id: 'pair',
      header: 'Possible duplicate',
      cell: (pair) => {
        const [first = '', second = ''] = pair.names;
        return (
          <span className="flex items-center gap-2 font-semibold whitespace-nowrap">
            <Avatar size="sm" name={first} />
            {first}
            <icons.transfer aria-label="and" className="size-3.5 text-fg-subtle" />
            <Avatar size="sm" name={second} />
            {second}
          </span>
        );
      },
    },
    { id: 'why', header: 'Why we think so', cell: (pair) => pair.reasons.join(', ') },
    ...(scored
      ? [
          {
            id: 'match',
            header: 'Match',
            width: '6.25rem',
            cell: (pair: DuplicatePair) =>
              pair.match == null ? null : (
                <Badge tone="warning" size="sm">
                  {BAND[pair.match]}
                </Badge>
              ),
          },
        ]
      : []),
    {
      id: 'decide',
      header: <span className="sr-only">Decide</span>,
      width: '12.5rem',
      cell: (pair) => {
        const [a = '', b = ''] = pair.personIds;
        const names = pair.names.join(' and ');
        return (
          <span className="flex justify-end gap-1.5">
            <Button
              size="xs"
              variant="ghost"
              aria-label={`${names} are not the same person`}
              shortcut="row.not-same"
              loading={busy === `${a}/${b}`}
              loadingLabel="Saving"
              onClick={(event) => {
                event.stopPropagation();
                dismiss(a, b);
              }}
            >
              Not the same
            </Button>
            <Button
              size="xs"
              variant="secondary"
              aria-label={`Compare ${names}`}
              shortcut="row.merge"
              onClick={(event) => {
                event.stopPropagation();
                onCompare(a, b);
              }}
            >
              Compare
            </Button>
          </span>
        );
      },
    },
  ];
  return (
    <Stack gap={5}>
      <PageHeader title={DATA_HEALTH.title} description={DATA_HEALTH.description} />
      {refused === null ? null : (
        <Alert tone="danger" title="Not done">
          {refused}
        </Alert>
      )}
      {items.length === 0 ? (
        <EmptyState
          title="Nothing looks duplicated"
          description="No two records share a work email, a name and birth date, or a unique value."
        />
      ) : (
        <DataTable
          label="Possible duplicates"
          rows={items}
          rowId={(pair) => pair.personIds.join('/')}
          describeRow={(pair) => pair.names.join(' and ')}
          // A click or Enter compares; M from the row's menu or its key too.
          onRowClick={(pair) => {
            const [a = '', b = ''] = pair.personIds;
            onCompare(a, b);
          }}
          rowActions={(pair) => {
            const [a = '', b = ''] = pair.personIds;
            return [
              {
                id: 'compare',
                label: 'Compare or merge',
                shortcut: 'row.merge',
                icon: <icons.transfer aria-hidden />,
                onSelect: () => {
                  onCompare(a, b);
                },
              },
              {
                id: 'not-same',
                label: 'Not the same person',
                shortcut: 'row.not-same',
                onSelect: () => {
                  dismiss(a, b);
                },
              },
            ];
          }}
          columns={columns}
        />
      )}
    </Stack>
  );
}

function Merges({
  merges,
  onUnmerge,
}: {
  readonly merges: readonly MergedPair[];
  readonly onUnmerge: DuplicatesProps['onUnmerge'];
}): JSX.Element | null {
  const [undoing, setUndoing] = useState<MergedPair | null>(null);
  if (merges.length === 0) return null;
  return (
    <Stack gap={4}>
      <h2 className="text-lg font-semibold">Merged records</h2>
      <Table aria-label="Merged records">
        <TableHeader>
          <TableRow>
            <TableHead>Merged</TableHead>
            <TableHead>Into</TableHead>
            <TableHead>When</TableHead>
            <TableHead>Undo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {merges.map((m) => (
            <TableRow key={m.absorbedId}>
              <TableCell>{m.absorbedName}</TableCell>
              <TableCell>{m.survivorName}</TableCell>
              <TableCell>{m.mergedAt.slice(0, 10)}</TableCell>
              <TableCell>
                {m.refusal === null ? (
                  <Button
                    size="sm"
                    aria-label={`Undo merge of ${m.absorbedName} into ${m.survivorName}`}
                    onClick={() => {
                      setUndoing(m);
                    }}
                  >
                    Undo merge
                  </Button>
                ) : (
                  <span className="text-sm">{m.refusal}</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {undoing === null ? null : (
        <UndoDialog
          merge={undoing}
          onClose={() => {
            setUndoing(null);
          }}
          onUnmerge={onUnmerge}
        />
      )}
    </Stack>
  );
}

function UndoDialog({
  merge,
  onClose,
  onUnmerge,
}: {
  readonly merge: MergedPair;
  readonly onClose: () => void;
  readonly onUnmerge: DuplicatesProps['onUnmerge'];
}): JSX.Element {
  const [reason, setReason] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const empty = reason.trim() === '';
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
            Undo merging {merge.absorbedName}'s record into {merge.survivorName}'s
          </DialogTitle>
          <DialogDescription>
            {merge.absorbedName}'s record comes back as it was before the merge
            {merge.account === 'returned' ? ', with its sign-in' : ''}. Both records stay, and the
            pair is offered for review again.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Stack gap={4}>
            <div>
              <p className="text-sm font-medium">Put back on {merge.survivorName}'s record</p>
              {merge.reversed.length === 0 ? (
                <p className="text-sm">Nothing: no copied value is still as the merge left it.</p>
              ) : (
                <ul className="list-disc pl-5 text-sm">
                  {merge.reversed.map((label) => (
                    <li key={label}>{label}</li>
                  ))}
                </ul>
              )}
            </div>
            {merge.kept.length === 0 && merge.account !== 'kept' ? null : (
              <Alert tone="warning" title="Kept as it is now">
                <ul className="list-disc pl-5">
                  {merge.kept.map((label) => (
                    <li key={label}>{label}, changed since the merge</li>
                  ))}
                  {merge.account === 'kept' ? (
                    <li>The sign-in, which {merge.survivorName}'s record no longer holds</li>
                  ) : null}
                </ul>
              </Alert>
            )}
            <Field required invalid={shown && empty}>
              <FieldLabel>Why was the merge wrong?</FieldLabel>
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
                Kept with the record of the undo. Up to 500 characters.
              </FieldDescription>
              <FieldError>Say why.</FieldError>
            </Field>
            {refused === null ? null : (
              <Alert tone="danger" title="Not undone">
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
            loadingLabel="Undoing"
            onClick={() => {
              setShown(true);
              if (empty) return;
              setBusy(true);
              setRefused(null);
              void onUnmerge(merge.absorbedId, reason.trim()).then((outcome) => {
                setBusy(false);
                if (outcome.ok) onClose();
                else setRefused(outcome.message);
              });
            }}
          >
            Undo merge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Compare({
  people,
  rows,
  onBack,
  onMerge,
  onDismiss,
}: {
  readonly people: readonly ComparedPerson[];
  readonly rows: readonly ComparedRow[];
  readonly onBack: () => void;
  readonly onMerge: DuplicatesProps['onMerge'];
  readonly onDismiss: DuplicatesProps['onDismiss'];
}): JSX.Element {
  const may = people.flatMap((p, i) => (p.refusal === null ? [i] : []));
  const [survivor, setSurvivor] = useState<number | null>(
    may.length === 1 ? (may[0] ?? null) : null,
  );
  const [take, setTake] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const absorbed = survivor === null ? null : 1 - survivor;
  const kept = survivor === null ? undefined : people[survivor];
  const gone = absorbed === null ? undefined : people[absorbed];
  const [a = '', b = ''] = people.map((p) => p.id);

  return (
    <Stack gap={6}>
      <PageHeader
        title={`${people[0]?.name ?? ''} and ${people[1]?.name ?? ''}`}
        description="Side by side, as you may see them. A sealed value shows its last four."
      />
      <div>
        <Button onClick={onBack}>Back to the list</Button>
      </div>
      {refused === null ? null : (
        <Alert tone="danger" title="Not done">
          {refused}
        </Alert>
      )}
      {may.length === 0 ? (
        <Alert tone="warning" title="These two cannot be merged here">
          {people.map((p) => p.refusal).find((r) => r !== null) ?? ''}
        </Alert>
      ) : (
        <RadioGroup
          aria-label="Which record stays"
          value={survivor === null ? '' : String(survivor)}
          onValueChange={(v) => {
            setSurvivor(Number(v));
            setTake(new Set());
          }}
        >
          {people.map((p, i) => (
            <RadioGroupItem
              key={p.id}
              value={String(i)}
              disabled={p.refusal !== null}
              description={
                p.refusal ?? 'Keeps its history; the other record points here afterwards.'
              }
            >
              Keep {p.name}'s record
            </RadioGroupItem>
          ))}
        </RadioGroup>
      )}
      <Card padded>
        <MergeCompare
          sources={
            [0, 1].map((i) => (
              <div key={people[i]?.id ?? i} className="flex min-w-0 items-center gap-2.5">
                <Avatar size="lg" name={people[i]?.name ?? ''} />
                <div className="min-w-0">
                  <p className="truncate font-bold">{people[i]?.name}</p>
                  <p className="truncate text-sm text-fg-muted">
                    {people[i]?.status}
                    {survivor === i ? ' · stays' : ''}
                  </p>
                </div>
              </div>
            )) as unknown as readonly [JSX.Element, JSX.Element]
          }
          sourceNames={[people[0]?.name ?? '', people[1]?.name ?? '']}
          rows={rows.map((row) => ({
            id: row.key,
            label: row.label,
            values: [row.values[0] ?? '—', row.values[1] ?? '—'] as const,
            same: row.same,
            // Only the value of the record that goes may be taken, where People allows it.
            disabled: absorbed === null || row.takeable[absorbed] !== true,
          }))}
          picks={Object.fromEntries(
            rows.map((row) => [
              row.key,
              (survivor === null ? 0 : take.has(row.key) ? absorbed : survivor) as 0 | 1,
            ]),
          )}
          onPick={(key, side) => {
            if (survivor === null) return;
            setTake((was) => {
              const next = new Set(was);
              if (side === absorbed) next.add(key);
              else next.delete(key);
              return next;
            });
          }}
        />
      </Card>
      <span className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          startIcon={<icons.merge aria-hidden />}
          disabled={kept === undefined}
          onClick={() => {
            setConfirming(true);
          }}
        >
          Merge
        </Button>
        <Button
          loading={busy && !confirming}
          loadingLabel="Saving"
          onClick={() => {
            setBusy(true);
            setRefused(null);
            void onDismiss(a, b).then((outcome) => {
              setBusy(false);
              if (!outcome.ok) setRefused(outcome.message);
            });
          }}
        >
          Not the same person
        </Button>
      </span>
      {confirming && kept !== undefined && gone !== undefined ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirming(false);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Merge {gone.name}'s record into {kept.name}'s
              </DialogTitle>
              <DialogDescription>
                {gone.name}'s record is kept, closed, and points at {kept.name}'s. Its sign-in, if
                it has one, moves across.{' '}
                {take.size === 0
                  ? 'No values are copied.'
                  : `${String(take.size)} ${take.size === 1 ? 'value is' : 'values are'} copied, each correctable afterwards.`}
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <p className="text-sm">
                It can be undone later from the list of merged records; a copied value changed since
                is kept.
              </p>
            </DialogBody>
            <DialogFooter>
              <Button
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={busy}
                loadingLabel="Merging"
                onClick={() => {
                  setBusy(true);
                  setRefused(null);
                  void onMerge(kept.id, gone.id, [...take]).then((outcome) => {
                    setBusy(false);
                    setConfirming(false);
                    if (!outcome.ok) setRefused(outcome.message);
                  });
                }}
              >
                Merge
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </Stack>
  );
}
