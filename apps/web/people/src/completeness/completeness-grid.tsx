import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  ChipGroup,
  ChipGroupItem,
  DataTable,
  EmptyState,
  HorizontalBarChart,
  InlineCell,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Stat,
  type DataColumn,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded, type IdentifierFinding, type Loadable } from '../load';
import { PeopleSearch, PersonPicker, type SearchPeople } from '../record/attribute-input';

/** An HR-owned field somebody is missing. */
export interface GapField {
  readonly key: string;
  readonly label: string;
  /** The choices, for a list; empty for free text and for a person. */
  readonly options: readonly { readonly value: string; readonly label: string }[];
  /** A person reference: picked by searching people, not from `options`. */
  readonly person: boolean;
  /** A change to it waits for HR's approval (PEO-077). */
  readonly sensitive?: boolean;
}

export interface GapRow {
  readonly personId: string;
  readonly name: string;
  readonly department: string | null;
  readonly manager: string | null;
  /** Which of the fields above this person is missing. */
  readonly missing: readonly string[];
}

export interface CompletenessState {
  /** "Since version 4 was published on 22 Sep". */
  readonly since: string;
  /** Employee-owned gaps: reminders, not this grid. */
  readonly waiting: { readonly people: number; readonly lastReminded: string | null };
  readonly completedThisWeek: number;
  /** HR's missing values over everybody, not only this page. */
  readonly toFill: number;
  readonly fields: readonly GapField[];
  readonly rows: readonly GapRow[];
  /** From analytics, where the viewer may read it: complete records, overall. */
  readonly complete?: { readonly percent: number; readonly incomplete: number } | null;
  /** From analytics: how complete each section is, for the by-section view (R2). */
  readonly bySection?: readonly { readonly label: string; readonly value: number }[] | null;
}

/** One person's answers, however many fields they cover: one write, one event. */
export interface GridSave {
  readonly personId: string;
  readonly values: Readonly<Record<string, string>>;
}

/** A cell our checks doubt (PEO-125): which person, and what was found. Never the value. */
export type GridFinding = IdentifierFinding & { readonly personId: string };

/** What saving cells would be warned about, or saved with. */
export type GridOutcome =
  | {
      readonly ok: true;
      readonly findings?: readonly GridFinding[];
      /** Cells sent to HR for approval rather than saved (PEO-077). */
      readonly held?: number;
    }
  | { readonly ok: false; readonly message: string };

export interface CompletenessGridProps {
  readonly load: Loadable<CompletenessState>;
  readonly onSave: (changes: readonly GridSave[]) => Promise<GridOutcome>;
  /**
   * What our checks would warn about a national identifier in these cells,
   * before they are saved (PEO-125). Absent: save straight away.
   */
  readonly onCheck?: (changes: readonly GridSave[]) => Promise<GridOutcome>;
  /** Finds people for a person field, by name, over everybody (PEO-122). */
  readonly searchPeople?: SearchPeople;
  /** Present when there are more people after this page (PEO-122). */
  readonly onNextPage?: () => void;
  /** Present when this is not the first page. */
  readonly onFirstPage?: () => void;
}

/**
 * HR's missing values, as one grid over exactly the missing cells (PRD §8.4,
 * design screen 8).
 *
 * The work is filling one field twenty-seven times, not twenty-seven fields
 * once, so the grid shows one field's column at a time and the keyboard runs
 * down it: each row has one control, so Tab is row after row. Every editable
 * cell is a real `Select` or `Input` inside `DataTable`, never a div that turns
 * into one on click. A save sends one change per person, however many fields
 * were filled for them, so each person raises one `profile_updated`.
 */
export function CompletenessGrid({
  load,
  searchPeople,
  ...props
}: CompletenessGridProps): JSX.Element {
  return (
    <PeopleSearch.Provider value={searchPeople ?? null}>
      <Loaded load={load} what="the missing information">
        {(state) => <Grid state={state} {...props} />}
      </Loaded>
    </PeopleSearch.Provider>
  );
}

function Grid({
  state,
  onSave,
  onCheck,
  onNextPage,
  onFirstPage,
}: Omit<CompletenessGridProps, 'load' | 'searchPeople'> & {
  readonly state: CompletenessState;
}): JSX.Element {
  const [view, setView] = useState<'grid' | 'sections'>('grid');
  // personId → key → value, across every field the admin has worked through.
  const [edits, setEdits] = useState<Readonly<Record<string, Readonly<Record<string, string>>>>>(
    {},
  );
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<GridOutcome | null>(null);
  /** Cells our checks doubt, and the edits they were found in: the next press saves anyway. */
  const [warned, setWarned] = useState<{
    readonly edits: string;
    readonly findings: readonly GridFinding[];
  } | null>(null);
  /** After a save: how many values went to HR's review. */
  const [reviewed, setReviewed] = useState(0);

  const pending = Object.values(edits).reduce((n, v) => n + Object.keys(v).length, 0);
  // Only the fields somebody on this page is missing: a column of nothing is noise.
  const fields = state.fields.filter((f) => state.rows.some((r) => r.missing.includes(f.key)));
  const rows = state.rows;

  const set = (personId: string, key: string, value: string): void => {
    setOutcome(null);
    setReviewed(0);
    setEdits((e) => ({ ...e, [personId]: { ...e[personId], [key]: value } }));
  };
  const stillWarned = warned !== null && warned.edits === JSON.stringify(edits);
  const shown = stillWarned ? warned.findings : [];
  const warningFor = (personId: string, key: string): string | undefined => {
    const messages = shown
      .filter((f) => f.personId === personId && f.key === key)
      .map((f) => f.message);
    return messages.length === 0
      ? undefined
      : `Our checks suggest this may be wrong: ${messages.join(' ')}`;
  };

  const save = async (): Promise<void> => {
    const changes = Object.entries(edits)
      .map(([personId, values]) => ({
        personId,
        values: Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== '')),
      }))
      .filter((c) => Object.keys(c.values).length > 0);
    setSaving(true);
    if (onCheck !== undefined && !stillWarned) {
      const checked = await onCheck(changes);
      if (!checked.ok) {
        setSaving(false);
        setOutcome(checked);
        return;
      }
      // A value HR already accepted is final: nothing to warn about (PEO-125).
      const found = (checked.findings ?? []).filter((f) => f.review !== 'accepted');
      if (found.length > 0) {
        setSaving(false);
        setWarned({ edits: JSON.stringify(edits), findings: found });
        return;
      }
    }
    const result = await onSave(changes);
    setSaving(false);
    setOutcome(result);
    if (result.ok) {
      setEdits({});
      setWarned(null);
      setReviewed((result.findings ?? []).filter((f) => f.review === 'pending').length);
    }
  };

  /** ↵ in a text cell moves to the same field on the next row, as a sheet does. */
  const down = (personId: string, key: string): void => {
    const at = rows.findIndex((r) => r.personId === personId);
    const next = rows.slice(at + 1).find((r) => r.missing.includes(key));
    if (next === undefined) return;
    document.getElementById(`cell-${next.personId}-${key}`)?.focus();
  };
  const control = (r: GapRow, field: GapField): JSX.Element | null => {
    if (!r.missing.includes(field.key)) {
      return (
        <span className="text-fg-subtle" aria-label="Already filled in">
          —
        </span>
      );
    }
    const value = edits[r.personId]?.[field.key] ?? '';
    const name = `${field.label} for ${r.name}`;
    if (field.person) {
      return (
        <PersonPicker
          label={name}
          size="sm"
          value={value}
          known={[]}
          onChange={(next) => {
            set(r.personId, field.key, next);
          }}
        />
      );
    }
    if (field.options.length > 0) {
      return (
        <Select
          value={value}
          onValueChange={(next) => {
            set(r.personId, field.key, next);
          }}
        >
          <SelectTrigger aria-label={name} size="sm" className="min-w-32">
            <SelectValue placeholder="Missing" />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    const warning = warningFor(r.personId, field.key);
    return (
      <InlineCell
        id={`cell-${r.personId}-${field.key}`}
        aria-label={name}
        value={value}
        {...(warning !== undefined
          ? { status: 'invalid' as const }
          : value === ''
            ? { status: 'missing' as const }
            : {})}
        {...(warning === undefined ? {} : { message: warning })}
        onChange={(e) => {
          set(r.personId, field.key, e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            down(r.personId, field.key);
          }
        }}
        containerClassName="min-w-32"
      />
    );
  };

  const columns: DataColumn<GapRow>[] = [
    {
      id: 'person',
      header: 'Person',
      width: '15rem',
      sticky: true,
      cell: (r) => (
        <span className="flex items-center gap-2.5">
          <Avatar size="md" name={r.name} />
          <span className="min-w-0">
            <span className="block truncate font-semibold">{r.name}</span>
            <span className="block truncate text-xs text-fg-muted">
              {[r.department, r.manager].filter((x) => x !== null).join(' · ')}
            </span>
          </span>
        </span>
      ),
    },
    ...fields.map((field): DataColumn<GapRow> => ({
      id: field.key,
      header:
        field.sensitive === true ? (
          <span className="inline-flex items-center gap-2">
            {field.label}
            <Badge tone="sensitive" size="sm">
              Sensitive
            </Badge>
          </span>
        ) : (
          field.label
        ),
      cell: (r) => control(r, field),
    })),
  ];

  return (
    <Stack gap={5}>
      <PageHeader
        title="Data completeness"
        description={state.since}
        actions={
          <Button
            variant="primary"
            disabled={pending === 0}
            loading={saving}
            loadingLabel="Saving"
            onClick={() => {
              void save();
            }}
          >
            {shown.length > 0
              ? 'Save anyway'
              : pending === 0
                ? 'Save'
                : `Save ${String(pending)} ${pending === 1 ? 'change' : 'changes'}`}
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-3.5 @5xl/page:grid-cols-4">
        {state.complete == null ? null : (
          <Stat
            label="Complete"
            value={state.complete.percent}
            unit="%"
            description={`${state.complete.incomplete.toLocaleString('en-GB')} records incomplete`}
          />
        )}
        <Stat label="Yours to fill" value={state.toFill} description="Fill them in below" />
        <Stat
          label="Waiting on employees"
          value={state.waiting.people}
          description={
            state.waiting.lastReminded === null
              ? 'Their gaps are reminders, not work for this grid'
              : `Last reminded ${state.waiting.lastReminded}`
          }
        />
        <Stat label="Completed this week" value={state.completedThisWeek} />
      </div>

      {shown.length === 0 ? null : (
        <Alert tone="warning" title="Our checks suggest some of these may be wrong">
          Check the marked cells. If they’re correct, save anyway and HR will review them.
        </Alert>
      )}
      {outcome === null ? null : outcome.ok ? (
        <Alert tone="success">
          Saved. Each person's record now carries what you filled in.
          {(outcome.held ?? 0) > 0
            ? ` ${String(outcome.held)} ${outcome.held === 1 ? 'value waits' : 'values wait'} for HR's approval and ${outcome.held === 1 ? 'is' : 'are'} not applied until then.`
            : ''}
          {reviewed > 0
            ? ` ${String(reviewed)} ${reviewed === 1 ? 'value our checks doubted went' : 'values our checks doubted went'} to HR's review.`
            : ''}
        </Alert>
      ) : (
        <Alert tone="danger" title="Nothing was saved">
          {outcome.message}
        </Alert>
      )}

      {state.bySection == null || state.bySection.length === 0 ? null : (
        <ChipGroup
          type="single"
          aria-label="View"
          value={view}
          onValueChange={(next) => {
            if (next === 'grid' || next === 'sections') setView(next);
          }}
        >
          <ChipGroupItem value="grid" variant="view">
            HR to fill in <span className="font-medium tabular-nums">{state.toFill}</span>
          </ChipGroupItem>
          <ChipGroupItem value="sections" variant="view">
            By section
          </ChipGroupItem>
        </ChipGroup>
      )}

      {view === 'sections' && state.bySection != null ? (
        // R2: where the gaps are, section by section.
        <Card padded>
          <h2 className="mb-4 text-md font-bold">Complete, by section</h2>
          <HorizontalBarChart
            data={state.bySection}
            label="Percent complete, by section"
            format={(v) => `${String(v)}%`}
          />
        </Card>
      ) : fields.length === 0 ? (
        <EmptyState
          title="Nothing is missing"
          description="Every field HR fills in has a value for everybody it applies to."
        />
      ) : (
        <>
          <DataTable
            label="Missing values"
            rows={rows}
            columns={columns}
            rowId={(r) => r.personId}
            empty={<EmptyState title="Nobody is missing anything" />}
          />
          <p className="text-sm text-fg-muted">
            Tab moves across, ↵ moves down. Nothing is saved until you press Save.
          </p>
        </>
      )}
      {onNextPage === undefined && onFirstPage === undefined ? null : (
        <nav aria-label="Pages of people" className="flex justify-end gap-2">
          {onFirstPage === undefined ? null : <Button onClick={onFirstPage}>First page</Button>}
          {onNextPage === undefined ? null : <Button onClick={onNextPage}>Next page</Button>}
        </nav>
      )}
    </Stack>
  );
}
