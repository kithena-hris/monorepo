import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
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
} from '@reach/ui';
import { useState, type JSX } from 'react';

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
 */

export interface DuplicatePair {
  readonly personIds: readonly string[];
  readonly names: readonly string[];
  readonly reasons: readonly string[];
}

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

export interface DuplicatesState {
  readonly items: readonly DuplicatePair[];
  readonly comparison: {
    readonly people: readonly ComparedPerson[];
    readonly rows: readonly ComparedRow[];
  } | null;
}

export interface DuplicatesProps {
  readonly load: Loadable<DuplicatesState>;
  readonly onCompare: (a: string, b: string) => void;
  readonly onBack: () => void;
  readonly onMerge: (survivorId: string, absorbedId: string, take: readonly string[]) => Promise<Outcome>;
  readonly onDismiss: (a: string, b: string) => Promise<Outcome>;
}

export function Duplicates(props: DuplicatesProps): JSX.Element {
  return (
    <Loaded load={props.load} what="possible duplicates">
      {(state) =>
        state.comparison === null ? (
          <Queue items={state.items} onCompare={props.onCompare} />
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

function Queue({
  items,
  onCompare,
}: {
  readonly items: readonly DuplicatePair[];
  readonly onCompare: DuplicatesProps['onCompare'];
}): JSX.Element {
  return (
    <Stack gap={6}>
      <PageHeader
        title="Possible duplicates"
        description="Records that look like the same person. Nothing is merged until you decide."
      />
      {items.length === 0 ? (
        <EmptyState
          title="Nothing looks duplicated"
          description="No two records share a work email, a name and birth date, or a unique value."
        />
      ) : (
        <Table aria-label="Possible duplicates">
          <TableHeader>
            <TableRow>
              <TableHead>Records</TableHead>
              <TableHead>Why they look alike</TableHead>
              <TableHead>Review</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((pair) => {
              const [a = '', b = ''] = pair.personIds;
              const names = pair.names.join(' and ');
              return (
                <TableRow key={`${a}/${b}`}>
                  <TableCell>{names}</TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-2">
                      {pair.reasons.map((r) => (
                        <Badge key={r} tone="warning" size="sm">
                          {r}
                        </Badge>
                      ))}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      aria-label={`Compare ${names}`}
                      onClick={() => {
                        onCompare(a, b);
                      }}
                    >
                      Compare
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Stack>
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
  const [survivor, setSurvivor] = useState<number | null>(may.length === 1 ? (may[0] ?? null) : null);
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
              description={p.refusal ?? 'Keeps its history; the other record points here afterwards.'}
            >
              Keep {p.name}'s record
            </RadioGroupItem>
          ))}
        </RadioGroup>
      )}
      <Table aria-label="The two records side by side">
        <TableHeader>
          <TableRow>
            <TableHead>Field</TableHead>
            <TableHead>{people[0]?.name}</TableHead>
            <TableHead>{people[1]?.name}</TableHead>
            <TableHead>Use the other value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const offered = absorbed !== null && row.takeable[absorbed] === true;
            return (
              <TableRow key={row.key}>
                <TableCell>{row.label}</TableCell>
                <TableCell>{row.values[0] ?? '—'}</TableCell>
                <TableCell>{row.values[1] ?? '—'}</TableCell>
                <TableCell>
                  {row.same ? (
                    <Badge tone="success" size="sm">
                      Same
                    </Badge>
                  ) : offered && gone !== undefined ? (
                    <Checkbox
                      aria-label={`Use ${gone.name}'s ${row.label}`}
                      checked={take.has(row.key)}
                      onCheckedChange={(on) => {
                        setTake((was) => {
                          const next = new Set(was);
                          if (on === true) next.add(row.key);
                          else next.delete(row.key);
                          return next;
                        });
                      }}
                    />
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <span className="flex flex-wrap gap-2">
        <Button
          variant="primary"
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
              <DialogTitle>Merge {gone.name}'s record into {kept.name}'s</DialogTitle>
              <DialogDescription>
                {gone.name}'s record is kept, closed, and points at {kept.name}'s. Its sign-in, if it
                has one, moves across. {take.size === 0
                  ? 'No values are copied.'
                  : `${String(take.size)} ${take.size === 1 ? 'value is' : 'values are'} copied, each correctable afterwards.`}
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <p className="text-sm">This cannot be undone from this screen.</p>
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
