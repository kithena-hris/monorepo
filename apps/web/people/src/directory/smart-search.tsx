import {
  AssistantCard,
  AssistantLabel,
  Button,
  Chip,
  ChipRow,
  List,
  ListItem,
  Popover,
  PopoverAnchor,
  PopoverContent,
  SearchField,
  Separator,
  icons,
} from '@reach/ui';
import { useEffect, useRef, useState, type JSX } from 'react';

/**
 * Smart search on the directory (AI1–AI4, MA1–MA3; docs/ai-settings.md):
 * one box for names and for questions, the "Understood as" row the question
 * became, and the cards that ask instead of guessing or say what was left
 * out. Every chip here is one of the directory's own filters, in its address;
 * nothing is hidden inside the assistant.
 */

/** One reading of an ambiguous phrase, as the whole selection it would be. */
export interface AskedReading {
  readonly label: string;
  readonly conditions: readonly {
    readonly key: string;
    readonly op: string;
    readonly values: readonly string[];
  }[];
  readonly match: 'all' | 'any';
  /** How many people it finds, as the viewer may list them; null when unknown. */
  readonly count: number | null;
}

export interface AskedRefusal {
  /** As typed: "who are good at Go". */
  readonly text: string;
  readonly why: string;
  /** A field that records something close, offered and never applied. */
  readonly instead: {
    readonly label: string;
    readonly subject: string;
    readonly condition: {
      readonly key: string;
      readonly op: string;
      readonly values: readonly string[];
    };
    readonly count: number | null;
  } | null;
}

/* ------------------------------------------------- remembered locally -- */

const RECENT = 'people.directory.recent';
const READINGS = 'people.directory.readings';
const ANSWERS = 'people.directory.answers';
const RECENT_MAX = 5;

/**
 * Per-viewer conveniences, in this browser only: recent searches and the
 * readings chosen before ("I'll remember it for next time") in local
 * storage, and what each question was understood as for this tab, so Back
 * shows the same cards without asking again. Any of it may be missing (a
 * private window); the screen works without it.
 */
function read<T>(where: 'local' | 'session', key: string, fallback: T): T {
  try {
    const raw = (where === 'local' ? window.localStorage : window.sessionStorage).getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(where: 'local' | 'session', key: string, value: unknown): void {
  try {
    (where === 'local' ? window.localStorage : window.sessionStorage).setItem(
      key,
      JSON.stringify(value),
    );
  } catch {
    // Kept for this page only.
  }
}

/** The searches made here, newest first. */
export function useRecent(): readonly [readonly string[], (sentence: string) => void] {
  const [recent, setRecent] = useState<readonly string[]>([]);
  useEffect(() => {
    const saved = read<unknown>('local', RECENT, []);
    if (Array.isArray(saved)) setRecent(saved.filter((s): s is string => typeof s === 'string'));
  }, []);
  const add = (sentence: string): void => {
    const next = [sentence, ...recent.filter((s) => s !== sentence)].slice(0, RECENT_MAX);
    setRecent(next);
    write('local', RECENT, next);
  };
  return [recent, add];
}

/** The reading chosen before for each kind of phrase: topic → label. */
export function rememberedReadings(): Record<string, string> {
  const saved = read<unknown>('local', READINGS, {});
  return typeof saved === 'object' && saved !== null && !Array.isArray(saved)
    ? Object.fromEntries(
        Object.entries(saved).filter((e): e is [string, string] => typeof e[1] === 'string'),
      )
    : {};
}

export function rememberReading(topic: string, label: string): void {
  write('local', READINGS, { ...rememberedReadings(), [topic]: label });
}

/** What a question was understood as, for this tab. */
export function cachedAnswer(sentence: string): unknown {
  const all = read<Record<string, unknown>>('session', ANSWERS, {});
  return all[sentence] ?? null;
}

export function cacheAnswer(sentence: string, answer: unknown): void {
  const all = read<Record<string, unknown>>('session', ANSWERS, {});
  // The last few questions only: this is a convenience, not a history.
  const kept = Object.fromEntries(Object.entries(all).slice(-9));
  write('session', ANSWERS, { ...kept, [sentence]: answer });
}

/* ------------------------------------------------------------- the bar -- */

/**
 * The prompt bar (AI1): Enter asks, Escape clears, `/` comes here. Focused
 * and empty, it offers questions built from the company's own fields and
 * the searches made here before; picking one asks it.
 */
export function AskBar({
  value,
  onValueChange,
  onAsk,
  loading,
  suggestions,
  recent,
}: {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly onAsk: (sentence: string) => void;
  readonly loading: boolean;
  readonly suggestions: readonly string[];
  readonly recent: readonly string[];
}): JSX.Element {
  const [focused, setFocused] = useState(false);
  const panel = useRef<HTMLDivElement | null>(null);
  const field = useRef<HTMLDivElement | null>(null);
  const open = focused && value === '' && suggestions.length + recent.length > 0;
  const example = suggestions[0]?.replace(/\?$/u, '');
  const pick = (sentence: string): void => {
    setFocused(false);
    onValueChange(sentence);
    onAsk(sentence);
  };
  const row = (sentence: string, kind: 'suggestion' | 'recent') => (
    <ListItem
      key={`${kind}:${sentence}`}
      asChild
      leading={
        kind === 'suggestion' ? (
          <icons.assistant aria-hidden className="size-4 text-accent-fg" />
        ) : (
          <icons.history aria-hidden className="size-4 text-fg-muted" />
        )
      }
    >
      <button
        type="button"
        onClick={() => {
          pick(sentence);
        }}
      >
        {sentence}
      </button>
    </ListItem>
  );
  return (
    <Popover
      open={open}
      sheetOnTouch={false}
      onOpenChange={(next) => {
        if (!next) setFocused(false);
      }}
    >
      <PopoverAnchor asChild>
        <div
          ref={field}
          onKeyDown={(event) => {
            // ↓ from the box walks into what it offers.
            if (event.key === 'ArrowDown' && open) {
              event.preventDefault();
              panel.current?.querySelector<HTMLElement>('button')?.focus();
            }
          }}
          onFocus={() => {
            setFocused(true);
          }}
          onBlur={(event) => {
            const to = event.relatedTarget;
            if (!(to instanceof Node && panel.current?.contains(to) === true)) setFocused(false);
          }}
        >
          <SearchField
            variant="prompt"
            label="Search people"
            placeholder={
              example === undefined
                ? 'Ask in plain English, or type a name'
                : `Ask in plain English, like “${example.charAt(0).toLowerCase()}${example.slice(1)}”`
            }
            value={value}
            onValueChange={onValueChange}
            onSearch={onAsk}
            loading={loading}
            shortcut="page.search"
            enterKeyHint="search"
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        aria-label="Suggestions"
        className="w-(--radix-popover-trigger-width) max-w-130 p-2.5"
        onOpenAutoFocus={(event) => {
          // Typing goes on in the box; the list is a ↓ or a click away.
          event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (event.target instanceof Node && field.current?.contains(event.target) === true) {
            event.preventDefault();
          }
        }}
      >
        <div
          ref={panel}
          className="flex flex-col"
          onBlur={(event) => {
            const to = event.relatedTarget;
            const inside =
              to instanceof Node &&
              (panel.current?.contains(to) === true || field.current?.contains(to) === true);
            if (!inside) setFocused(false);
          }}
        >
          {suggestions.length === 0 ? null : (
            <section aria-labelledby="ask-try" className="flex flex-col gap-1">
              <h2 id="ask-try" className="px-2 pt-1 text-xs font-semibold text-fg-subtle">
                Try asking
              </h2>
              <List navigable>{suggestions.map((s) => row(s, 'suggestion'))}</List>
            </section>
          )}
          {suggestions.length === 0 || recent.length === 0 ? null : <Separator className="my-1" />}
          {recent.length === 0 ? null : (
            <section aria-labelledby="ask-recent" className="flex flex-col gap-1">
              <h2 id="ask-recent" className="px-2 pt-1 text-xs font-semibold text-fg-subtle">
                Recent
              </h2>
              <List navigable>{recent.map((s) => row(s, 'recent'))}</List>
            </section>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------ understood as -- */

export interface UnderstoodChip {
  readonly key: string;
  /** The filter's name, muted before its value: "Team". */
  readonly field: string;
  readonly text: string;
  readonly onRemove: () => void;
}

/**
 * "Understood as" (AI2, MA1): the question as the directory's own filters,
 * each removable, the parts not used dashed, and the way into the full
 * filter panel. Scrolls sideways under a finger.
 */
export function Understood({
  chips,
  unused,
  onEdit,
  note,
}: {
  readonly chips: readonly UnderstoodChip[];
  /** Parts not used, as typed, each dismissable. */
  readonly unused: readonly {
    readonly key: string;
    readonly text: string;
    readonly onRemove: () => void;
  }[];
  readonly onEdit?: () => void;
  /** Who read it, when it was not the assistant, and why: said, never hidden. */
  readonly note: string | null;
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <ChipRow
        label={<AssistantLabel>Understood as</AssistantLabel>}
        {...(onEdit === undefined
          ? {}
          : {
              action: (
                <Button variant="link" size="sm" onClick={onEdit}>
                  Edit as filters
                </Button>
              ),
            })}
        className="touch:-mx-4 touch:px-4"
      >
        {chips.map((c) => (
          <Chip
            key={c.key}
            field={c.field}
            selected
            onRemove={c.onRemove}
            removeLabel={`Remove ${c.field} ${c.text}`}
          >
            {c.text}
          </Chip>
        ))}
        {unused.map((u) => (
          <Chip
            key={u.key}
            variant="dashed"
            onRemove={u.onRemove}
            removeLabel={`Remove “${u.text}”, which was not used`}
          >
            “{u.text}”
          </Chip>
        ))}
      </ChipRow>
      {note === null ? null : <p className="text-xs text-fg-muted">{note}</p>}
    </div>
  );
}

/* ---------------------------------------------------------- the cards -- */

const people = (n: number): string => `${String(n)} ${n === 1 ? 'person' : 'people'}`;

/**
 * When the question is unclear (AI4, MA3): each reading the company's fields
 * can run, with how many people it finds. Picking one applies it and is
 * remembered for next time; nothing is applied until somebody picks.
 */
export function Clarify({
  phrase,
  readings,
  coarse,
  onPick,
}: {
  readonly phrase: string;
  readonly readings: readonly AskedReading[];
  readonly coarse: boolean;
  readonly onPick: (reading: AskedReading) => void;
}): JSX.Element {
  const label = (r: AskedReading): string =>
    r.count === null ? r.label : `${r.label} · ${String(r.count)}`;
  return (
    <AssistantCard
      level={2}
      title={`What does “${phrase}” mean${coarse ? '' : ' here'}?`}
      role="group"
      aria-label={`What does “${phrase}” mean?`}
    >
      {coarse ? (
        <div className="flex flex-col gap-2">
          {readings.map((r) => (
            <Button
              key={r.label}
              size="lg"
              fullWidth
              className="justify-start"
              onClick={() => {
                onPick(r);
              }}
            >
              {label(r)}
            </Button>
          ))}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {readings.map((r) => (
              <Chip
                key={r.label}
                onClick={() => {
                  onPick(r);
                }}
              >
                {label(r)}
              </Chip>
            ))}
          </div>
          <p className="text-sm text-fg-muted">
            Pick one and I’ll remember it for next time. Or keep typing to be more specific.
          </p>
        </>
      )}
    </AssistantCard>
  );
}

/**
 * What was left out and why (AI4): a judgement is not a field, so it is
 * never searched for. Where a field records something close, it is offered,
 * never applied.
 */
export function Refused({
  refused,
  onUse,
  onRemove,
}: {
  readonly refused: readonly AskedRefusal[];
  readonly onUse: (refusal: AskedRefusal) => void;
  readonly onRemove: (refusal: AskedRefusal) => void;
}): JSX.Element {
  return (
    <AssistantCard
      level={2}
      title={
        refused.length === 1
          ? 'One part I couldn’t use'
          : `${String(refused.length)} parts I couldn’t use`
      }
    >
      {refused.map((r) => (
        <div key={r.text} className="flex flex-col gap-2.5">
          <p className="text-sm text-fg-muted">
            <span className="font-medium text-fg">“{r.text}”</span>: {r.why}{' '}
            {r.instead === null
              ? 'I left it out.'
              : `I can search the ${r.instead.label} field for “${r.instead.subject}” instead${
                  r.instead.count === null
                    ? '.'
                    : `, which ${people(r.instead.count)} ${r.instead.count === 1 ? 'has' : 'have'} listed.`
                }`}
          </p>
          <div className="flex flex-wrap gap-2">
            {r.instead === null ? null : (
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  onUse(r);
                }}
              >
                Use the {r.instead.label} field
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onRemove(r);
              }}
            >
              Remove it
            </Button>
          </div>
        </div>
      ))}
    </AssistantCard>
  );
}
