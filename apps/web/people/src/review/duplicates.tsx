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
  MergeCompare,
  PINNED_BAR,
  RadioGroup,
  RadioGroupItem,
  Stack,
  DataTable,
  type DataColumn,
  Textarea,
  usePages,
  icons,
} from '@reach/ui';
import { useCallback, useMemo, useState, type JSX } from 'react';

import type { Outcome } from '../load';

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
  /** What flagged the pair, as nobody asked for it: SCIM provisioning, or the check. Absent from an older People. */
  readonly flaggedBy?: string | null;
  /** Each one's photo, in the order of `personIds`, where the viewer may see it. Absent from an older People. */
  readonly avatarUrls?: readonly (string | null)[];
}

/** One side's photo, by their id, from the queue's row for the pair. */
export const faceOf = (
  pair: DuplicatePair | undefined,
  personId: string | undefined,
): string | undefined => pair?.avatarUrls?.[pair.personIds.indexOf(personId ?? '')] ?? undefined;

/** "Flagged by Kithena’s duplicate check", or null from an older People. */
export const flaggedByOf = (pair: DuplicatePair | undefined): string | null =>
  pair?.flaggedBy == null || pair.flaggedBy === '' ? null : `Flagged by ${pair.flaggedBy}`;

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
  /** The place of the queue's next page; null on the last. Absent from an older People. */
  readonly next?: string | null;
  /** Absent from a state that predates undo: read as none. */
  readonly merges?: readonly MergedPair[];
  /** Merged records' next page; null on the last. Absent from an older People. */
  readonly mergesNext?: string | null;
  readonly comparison: {
    readonly people: readonly ComparedPerson[];
    readonly rows: readonly ComparedRow[];
  } | null;
}

/** What a duplicate's detail pane, and the merged records, may do. */
export interface DuplicateActions {
  readonly onMerge: (
    survivorId: string,
    absorbedId: string,
    take: readonly string[],
  ) => Promise<Outcome>;
  readonly onDismiss: (a: string, b: string) => Promise<Outcome>;
  readonly onUnmerge: (absorbedId: string, reason: string) => Promise<Outcome>;
}

/** A pair's id in Review's address: the two records, in People's order. */
export const pairId = (pair: Pick<DuplicatePair, 'personIds'>): string => pair.personIds.join('~');

/** "Strong", for a pair's row and its pane; absent from an older People. */
export const bandOf = (pair: DuplicatePair): string | null =>
  pair.match == null ? null : BAND[pair.match];

const mergeId = (m: MergedPair): string => m.absorbedId;
const mergeName = (m: MergedPair): string => m.absorbedName;

export function Merges({
  merges: first,
  next = null,
  onUnmerge,
  onLoadMore,
}: {
  readonly merges: readonly MergedPair[];
  /** The next page's place; null on the last. */
  readonly next?: string | null;
  readonly onUnmerge: DuplicateActions['onUnmerge'];
  /** The merges after `after`, as People answers them (a `DuplicatesState`), or null. */
  readonly onLoadMore?: ((after: string) => Promise<unknown>) | undefined;
}): JSX.Element | null {
  const [undoing, setUndoing] = useState<MergedPair | null>(null);
  // Older merges as the list scrolls; only the rows on screen drawn.
  const more = useCallback(
    async (after: string) => {
      const page = (await onLoadMore?.(after)) as DuplicatesState | null | undefined;
      return page == null ? null : { items: page.merges ?? [], next: page.mergesNext ?? null };
    },
    [onLoadMore],
  );
  const pages = usePages(first, next, onLoadMore === undefined ? undefined : more);
  // Held across renders, so a page landing redraws only the rows it brought.
  const columns = useMemo<readonly DataColumn<MergedPair>[]>(
    () => [
      { id: 'merged', header: 'Merged', cell: (m) => m.absorbedName },
      { id: 'into', header: 'Into', shortHeader: 'Into', cell: (m) => m.survivorName },
      { id: 'when', header: 'When', cell: (m) => m.mergedAt.slice(0, 10) },
      {
        id: 'undo',
        header: 'Undo',
        cell: (m) =>
          m.refusal === null ? (
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
          ),
      },
    ],
    [],
  );
  if (first.length === 0) return null;
  return (
    <Stack gap={4}>
      <h2 className="text-lg font-semibold">Merged records</h2>
      <DataTable<MergedPair>
        label="Merged records"
        rows={pages.items}
        rowId={mergeId}
        describeRow={mergeName}
        stickyHeader
        // Its own box under Decided, which fills the page.
        containerClassName="max-h-[70dvh] min-h-48"
        {...(pages.loadMore === undefined ? {} : { onEndReached: pages.loadMore })}
        loadingMore={pages.loading}
        columns={columns}
      />
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
  readonly onUnmerge: DuplicateActions['onUnmerge'];
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

/**
 * A possible duplicate, compared in Review's detail pane (design E3, MA E4):
 * why it looks alike, the two records side by side, the one that stays, the
 * values to take across, and the two answers. Merge asks first.
 */
export function DuplicateDetail({
  pair,
  people,
  rows,
  onMerge,
  onDismiss,
}: {
  /** The queue's row for it: why, and how strong. Absent when only the comparison is known. */
  readonly pair?: DuplicatePair | undefined;
  readonly people: readonly ComparedPerson[];
  readonly rows: readonly ComparedRow[];
  readonly onMerge: DuplicateActions['onMerge'];
  readonly onDismiss: DuplicateActions['onDismiss'];
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
    <Card padded className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <Avatar size="xl" name={people[0]?.name ?? ''} src={faceOf(pair, people[0]?.id)} />
        <div className="min-w-0 flex-1">
          <h2 className="text-md font-bold">
            {people[0]?.name}
            <span className="font-normal text-fg-muted"> · Possible duplicate</span>
          </h2>
          <p className="text-sm text-fg-muted">
            {[
              (pair?.reasons ?? []).join(', '),
              pair === undefined || bandOf(pair) === null ? null : `${bandOf(pair) ?? ''} match`,
              flaggedByOf(pair),
            ]
              .filter((x) => x !== null && x !== '')
              .join(' · ') || `Possible duplicate of ${people[1]?.name ?? ''}`}
          </p>
        </div>
        {pair === undefined || bandOf(pair) === null ? null : (
          <Badge tone="warning" size="sm" className="shrink-0">
            {bandOf(pair)}
          </Badge>
        )}
      </div>
      <p className="text-sm text-fg-muted">
        Side by side, as you may see them. A sealed value shows its last four. Tick the values to
        take from the other record.
      </p>
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
      <div className="overflow-x-auto">
        <MergeCompare
          sources={
            [0, 1].map((i) => (
              <div key={people[i]?.id ?? i} className="flex min-w-0 items-center gap-2.5">
                <Avatar size="lg" name={people[i]?.name ?? ''} src={faceOf(pair, people[i]?.id)} />
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
      </div>
      <div
        {...PINNED_BAR}
        className="flex flex-wrap items-center gap-2 border-t border-border pt-4 touch:sticky touch:bottom-24 touch:z-10 touch:grid touch:grid-cols-2 touch:bg-surface touch:py-2"
      >
        <Button
          variant="ghost"
          shortcut="row.not-same"
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
        <Button
          variant="primary"
          className="ms-auto touch:ms-0"
          shortcut="row.merge"
          startIcon={<icons.merge aria-hidden />}
          disabled={kept === undefined}
          onClick={() => {
            setConfirming(true);
          }}
        >
          Merge
        </Button>
      </div>
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
                You can undo this later, under Decided; a copied value changed since is kept.
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
    </Card>
  );
}
