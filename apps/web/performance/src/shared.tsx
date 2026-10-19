import {
  Alert,
  Avatar,
  Badge,
  Button,
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
  FieldLabel,
  SearchField,
  Checkbox,
  RadioCard,
  RadioGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stepper,
  Switch,
  Tooltip,
  cn,
  icons,
  springEasing,
  springSettleTime,
  springs,
} from '@reach/ui';
import { durations, easings } from '@reach/ui/motion';
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
  type JSX,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';

import type { CycleState, Done, Kind, ScreenProps } from './types';

/**
 * What every Performance screen does the same way (PRF-070): a link that
 * stays in the app, a write with its pending state and refusal, dates in
 * words, the badges states are drawn with (design pf-core), and the stepped
 * dialog setup, feedback, nominations, goals and learning open in.
 */

export type Tone = 'neutral' | 'accent' | 'info' | 'success' | 'warning' | 'danger';

/** A link the shell's router follows without a page load. */
export function To({
  href,
  onNavigate,
  children,
  className,
}: {
  readonly href: string;
  readonly onNavigate?: ((to: string) => void) | undefined;
  readonly children: ReactNode;
  readonly className?: string;
}): JSX.Element {
  return (
    <a
      href={href}
      className={className ?? 'font-medium text-fg hover:underline'}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        if (onNavigate === undefined || e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        onNavigate(href);
      }}
    >
      {children}
    </a>
  );
}

export interface Act {
  readonly pending: boolean;
  readonly error: string | null;
  readonly clear: () => void;
  readonly run: (
    name: string,
    variables: Readonly<Record<string, unknown>>,
    after?: (data: unknown) => void,
  ) => void;
  readonly call: (name: string, variables: Readonly<Record<string, unknown>>) => Promise<Done>;
}

/** One write: run it, show its refusal, refresh the page's data when it lands. */
export function useAct(props: Pick<ScreenProps<unknown>, 'onAct' | 'onRefresh'>): Act {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const call = async (name: string, variables: Readonly<Record<string, unknown>>): Promise<Done> =>
    props.onAct === undefined
      ? { ok: false, message: 'Not available here' }
      : props.onAct(name, variables);
  return {
    pending,
    error,
    clear: () => {
      setError(null);
    },
    call,
    run: (name, variables, after) => {
      setError(null);
      start(async () => {
        const done = await call(name, variables);
        if (!done.ok) {
          setError(done.message);
          return;
        }
        after?.(done.data);
        props.onRefresh?.();
      });
    },
  };
}

export function Refusal({ error }: { readonly error: string | null }): JSX.Element | null {
  return error === null ? null : (
    <Alert tone="danger" title="That did not go through">
      {error}
    </Alert>
  );
}

const DAY = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const DAY_YEAR = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const WHEN = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** "Fri 30 Oct", or "30 Oct 2025" in another year. */
export function day(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return '—';
  const at = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.getUTCFullYear() === new Date().getUTCFullYear() ? DAY.format(at) : DAY_YEAR.format(at);
}

export const time = (iso: string): string => TIME.format(new Date(iso));
export const when = (iso: string): string => WHEN.format(new Date(iso));

/** "in_progress" → "In progress". */
export const words = (key: string): string => {
  const spaced = key.replaceAll('_', ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

const CYCLE: Readonly<Record<CycleState, readonly [string, Tone]>> = {
  draft: ['Draft', 'neutral'],
  scheduling: ['Scheduling', 'info'],
  scheduled: ['Scheduled', 'accent'],
  launching: ['Launching', 'info'],
  launch_failed: ['Launch failed', 'danger'],
  in_progress: ['In progress', 'success'],
  closing: ['Closing', 'warning'],
  closed: ['Closed', 'neutral'],
  archived: ['Archived', 'neutral'],
};

export function CycleBadge({ state }: { readonly state: string }): JSX.Element {
  const [label, tone] = (CYCLE as Partial<Record<string, readonly [string, Tone]>>)[state] ?? [
    words(state),
    'neutral',
  ];
  return (
    <Badge
      size="sm"
      tone={tone}
      dot={state === 'in_progress' || state === 'launching'}
      variant={state === 'archived' ? 'outline' : 'soft'}
    >
      {label}
    </Badge>
  );
}

const REVIEW: Readonly<Record<string, readonly [string, Tone]>> = {
  not_started: ['Not started', 'neutral'],
  draft: ['In progress', 'warning'],
  submitted: ['Submitted', 'success'],
  unlock: ['Unlock requested', 'warning'],
  unlocked: ['Unlocked', 'info'],
  released: ['Released', 'accent'],
  ack: ['Acknowledged', 'success'],
  detached: ['Detached', 'neutral'],
  overdue: ['Overdue', 'danger'],
  declined: ['Declined', 'neutral'],
  handed: ['Handed over', 'neutral'],
  none: ['—', 'neutral'],
};

export function ReviewBadge({ state }: { readonly state: string }): JSX.Element {
  const [label, tone] = REVIEW[state] ?? [words(state), 'neutral'];
  return (
    <Badge size="sm" tone={tone}>
      {label}
    </Badge>
  );
}

const KIND: Readonly<Record<Kind, string>> = {
  self: 'Self review',
  manager: 'Manager review',
  peer: 'Peer review',
  upward: 'Upward review',
  skip: 'Skip-level review',
  goals: 'Goals review',
};

export const kindLabel = (k: string): string =>
  (KIND as Partial<Record<string, string>>)[k] ?? words(k);

export function KindBadge({ kind }: { readonly kind: string }): JSX.Element {
  return <Badge size="sm">{kindLabel(kind)}</Badge>;
}

export function Person({
  name,
  sub,
  size = 'sm',
}: {
  readonly name: string;
  readonly sub?: string | null | undefined;
  readonly size?: 'xs' | 'sm' | 'md' | 'lg';
}): JSX.Element {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Avatar name={name} size={size} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{name}</span>
        {sub === null || sub === undefined || sub === '' ? null : (
          <span className="truncate text-sm text-fg-muted">{sub}</span>
        )}
      </span>
    </span>
  );
}

/** A switch with its label and what it does (design `swr`). */
export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
  locked,
  info,
  dense = false,
}: {
  readonly label: string;
  readonly hint?: ReactNode;
  readonly checked: boolean;
  readonly onChange?: (on: boolean) => void;
  readonly disabled?: boolean;
  /** Kithena holds it on: "Always". */
  readonly locked?: string;
  /** More about it, behind an info button beside the label. */
  readonly info?: string;
  /** Tighter rows, for a short group of settings inside an editor. */
  readonly dense?: boolean;
}): JSX.Element {
  return (
    <Field
      orientation="horizontal"
      className={cn('justify-between gap-4', dense ? 'py-1' : 'py-2.5')}
    >
      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1">
          <FieldLabel>{label}</FieldLabel>
          {info === undefined ? null : (
            <Tooltip content={info}>
              <Button
                size="xs"
                variant="ghost"
                aria-label={`About ${label}: ${info}`}
                startIcon={<icons.info aria-hidden />}
              />
            </Tooltip>
          )}
        </span>
        {hint === undefined ? null : <FieldDescription>{hint}</FieldDescription>}
      </span>
      <span className="flex items-center gap-2">
        {locked === undefined ? null : (
          <Badge size="sm" variant="outline">
            {locked}
          </Badge>
        )}
        <FieldControl>
          <Switch
            checked={checked}
            disabled={disabled === true || locked !== undefined}
            onCheckedChange={(on) => {
              onChange?.(on);
            }}
          />
        </FieldControl>
      </span>
    </Field>
  );
}

/** The live dot of a screen moved on by the cycle stream (§8.7). */
export function Live(): JSX.Element {
  return (
    <Badge size="sm" tone="success" dot pulse>
      Live
    </Badge>
  );
}

/**
 * A centred dialog with steps (design principle: "steps in a centred dialog"):
 * a step bar, the step's body, and Back or Cancel beside Next or the last
 * step's own button.
 */
export function StepDialog({
  open,
  onClose,
  title,
  description,
  steps,
  step,
  onStep,
  children,
  finish,
  finishLabel,
  pending,
  canNext = true,
  wide,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description?: string;
  readonly steps: readonly string[];
  readonly step: number;
  readonly onStep: (step: number) => void;
  readonly children: ReactNode;
  readonly finish: () => void;
  readonly finishLabel: string;
  readonly pending?: boolean;
  readonly canNext?: boolean;
  readonly wide?: boolean;
}): JSX.Element {
  const lastStep = step === steps.length - 1;
  const dock = useDock();
  // A new step starts at its top, wherever the last one was scrolled to.
  const shown = useRef(step);
  useLayoutEffect(() => {
    if (shown.current === step) return;
    shown.current = step;
    dock.place.current?.parentElement?.scrollTo({ top: 0 });
  }, [step, dock.place]);
  const bar = (compact: boolean) => (
    <Stepper
      label={`${title} steps`}
      size="sm"
      variant={compact ? 'compact' : 'default'}
      free
      current={step}
      onStepChange={(i) => {
        onStep(i);
      }}
      steps={steps.map((s, i) => ({
        id: String(i),
        label: s,
        status: i < step ? 'complete' : i === step ? 'current' : 'upcoming',
      }))}
    />
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      {/* One height for every step, so the dialog never jumps between them: the
          body scrolls inside it. Under a thumb the dialog is the screen. */}
      <DialogContent
        className={cn(
          wide === true ? 'max-w-4xl' : 'max-w-2xl',
          'h-[min(48rem,calc(100dvh-4rem))] touch:h-auto',
        )}
        // Focus opens on the dialog itself, not its first step, which drew a
        // focus ring round Basics nobody had asked for. Tab reaches it first.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus();
        }}
      >
        <DialogHeader>
          <div className="flex min-w-0 items-center gap-4">
            <DialogTitle className="min-w-0 truncate">{title}</DialogTitle>
            {/* The bar, docked here while its place is scrolled away. */}
            <div
              ref={dock.docked}
              aria-hidden={!dock.isDocked}
              inert={!dock.isDocked}
              className={cn('ms-auto shrink-0', !dock.isDocked && 'opacity-0')}
            >
              {bar(true)}
            </div>
          </div>
          {description === undefined ? null : <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <div ref={dock.attach}>
            <div
              aria-hidden={dock.isDocked}
              inert={dock.isDocked}
              className={cn(
                'transition-[opacity,translate] motion-reduce:transition-none',
                dock.isDocked
                  ? 'pointer-events-none -translate-y-2 opacity-0 duration-(--animate-duration-fast) ease-(--ease-exit)'
                  : // Back once the docked copy has gone: one bar on screen at a time.
                    'delay-(--animate-duration-fast) duration-(--animate-duration-normal) ease-(--ease-entrance)',
              )}
            >
              {bar(false)}
            </div>
          </div>
          {children}
        </DialogBody>
        <DialogFooter>
          <span className="mr-auto self-center px-1 text-sm text-fg-muted">{`Step ${String(step + 1)} of ${String(steps.length)}`}</span>
          <Button
            variant="secondary"
            onClick={() => {
              if (step === 0) onClose();
              else onStep(step - 1);
            }}
          >
            {step === 0 ? 'Cancel' : 'Back'}
          </Button>
          {/* One primary per dialog, and it is the finish; Next is promoted, not primary. */}
          <Button
            variant={lastStep ? 'primary' : 'tinted'}
            loading={pending === true}
            disabled={!canNext}
            onClick={() => {
              if (lastStep) finish();
              else onStep(step + 1);
            }}
          >
            {lastStep ? finishLabel : 'Next'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const curve = (points: readonly number[]): string => `cubic-bezier(${points.join(', ')})`;

/**
 * A step bar that docks beside the dialog's title once it is scrolled out of
 * the body. Docking, the copy in the header glides from where the bar was to
 * the title on the `move` spring; undocking, it slips back toward the bar's
 * place and fades out fast, and only then does the bar fade back in (its CSS
 * waits `fast`), so the two are never on screen together. Reduced motion
 * swaps them without travel. Under a thumb the bar stays where it is: the
 * header has no room beside the title. (`seen` is false on the server, so
 * `matchMedia` is only reached in a browser.)
 */
function useDock(): {
  readonly isDocked: boolean;
  readonly place: RefObject<HTMLDivElement | null>;
  /** The bar's place: observed from when it is in the page, not from mount. */
  readonly attach: (el: HTMLDivElement | null) => void;
  readonly docked: RefObject<HTMLDivElement | null>;
} {
  // A callback ref, not `useInView`'s: the dialog's portal draws its content a
  // render after the dialog mounts, so an observer set up on mount found no
  // element and the bar never docked.
  const place = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);
  const watching = useRef<IntersectionObserver | null>(null);
  const attach = useCallback((el: HTMLDivElement | null) => {
    watching.current?.disconnect();
    watching.current = null;
    place.current = el;
    if (el === null) return;
    const seen = new IntersectionObserver(([entry]) => {
      if (entry !== undefined) setInView(entry.isIntersecting);
    });
    seen.observe(el);
    watching.current = seen;
  }, []);
  const docked = useRef<HTMLDivElement>(null);
  // Docked only once the bar has been seen and then scrolled away, not while
  // the dialog is still opening.
  const seen = useRef(false);
  if (inView) seen.current = true;
  const isDocked = seen.current && !inView && !matchMedia('(pointer: coarse)').matches;
  const was = useRef(isDocked);
  useLayoutEffect(() => {
    if (was.current === isDocked) return;
    was.current = isDocked;
    const to = docked.current;
    const from = place.current;
    if (to === null || from === null || matchMedia('(prefers-reduced-motion: reduce)').matches)
      return;
    for (const running of to.getAnimations()) running.cancel();
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (isDocked) {
      to.animate(
        [
          { opacity: 0, transform: `translate(${String(dx)}px, ${String(dy)}px) scale(0.92)` },
          { opacity: 1, transform: 'none' },
        ],
        {
          duration: springSettleTime(springs.move, 0.004) * 1000,
          easing: springEasing(springs.move),
        },
      );
    } else {
      to.animate(
        [
          { opacity: 1, transform: 'none' },
          {
            opacity: 0,
            transform: `translate(${String(dx / 4)}px, ${String(dy / 4)}px) scale(0.96)`,
          },
        ],
        { duration: durations.fast, easing: curve(easings.exit) },
      );
    }
  }, [isDocked, place]);
  return { isDocked, place, attach, docked };
}

/** A simple confirmation or form dialog. */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly footer: ReactNode;
}): JSX.Element {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description === undefined ? null : <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">{children}</DialogBody>
        <DialogFooter>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A search box whose words go to the address on Enter, so a search is a link. */
export function Search({
  label,
  placeholder,
  initial,
  onSearch,
}: {
  readonly label: string;
  readonly placeholder: string;
  readonly initial: string;
  readonly onSearch: (q: string) => void;
}): JSX.Element {
  const [value, setValue] = useState(initial);
  return (
    <SearchField
      label={label}
      placeholder={placeholder}
      value={value}
      onValueChange={setValue}
      onSearch={onSearch}
      className="max-w-xs"
    />
  );
}

/** A file Performance answered as base64 (a PDF unless it says otherwise), saved by the browser. */
export function download(file: {
  readonly filename: string;
  readonly base64: string;
  readonly mediaType?: string;
}): void {
  const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mediaType ?? 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = file.filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** A fresh idempotent id for a new record, made in the browser. */
export const newId = (): string => crypto.randomUUID();

/** A score in hundredths as the scale reads it: 380 → "3.8". */
export const score = (h: number | null | undefined): string =>
  h === null || h === undefined ? '—' : (h / 100).toFixed(1);

/** "1 review", "3 reviews". */
export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${String(n)} ${n === 1 ? one : many}`;

export interface Found {
  readonly personId: string;
  readonly name: string;
  readonly title: string;
}

/**
 * Search the directory and pick one person, or several with `many`. The
 * directory is Performance's own (§4.3), so it works with People absent.
 */
export function PersonPicker({
  act,
  label = 'Search people',
  value,
  onChange,
  many,
}: {
  readonly act: Act;
  readonly label?: string;
  readonly value: readonly string[];
  readonly onChange: (ids: readonly string[], people: readonly Found[]) => void;
  readonly many?: boolean;
}): JSX.Element {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<readonly Found[]>([]);
  const [known, setKnown] = useState<readonly Found[]>([]);
  const pick = (ids: readonly string[]): void => {
    onChange(
      ids,
      known.filter((p) => ids.includes(p.personId)),
    );
  };
  return (
    <div className="flex flex-col gap-2">
      <SearchField
        label={label}
        placeholder="Type a name and press Enter"
        value={q}
        onValueChange={setQ}
        onSearch={(v) => {
          void act.call('PerformanceDirectory', { q: v }).then((d) => {
            if (!d.ok) return;
            const rows = (d.data as { rows: readonly Found[] }).rows;
            setFound(rows);
            setKnown((k) => [
              ...k.filter((x) => !rows.some((r) => r.personId === x.personId)),
              ...rows,
            ]);
          });
        }}
      />
      {many === true ? (
        <div className="flex flex-col gap-1.5">
          {found.map((p) => (
            <Field key={p.personId} orientation="horizontal">
              <FieldControl>
                <Checkbox
                  checked={value.includes(p.personId)}
                  onCheckedChange={(on) => {
                    pick(
                      on === true ? [...value, p.personId] : value.filter((x) => x !== p.personId),
                    );
                  }}
                />
              </FieldControl>
              <FieldLabel>{`${p.name} · ${p.title}`}</FieldLabel>
            </Field>
          ))}
        </div>
      ) : (
        <RadioGroup
          aria-label="Who"
          value={value[0] ?? ''}
          onValueChange={(v) => {
            pick([v]);
          }}
        >
          {found.map((p) => (
            <RadioCard key={p.personId} value={p.personId} description={p.title}>
              {p.name}
            </RadioCard>
          ))}
        </RadioGroup>
      )}
    </div>
  );
}

/** A labelled select of plain options: `[value, label]` pairs. */
export function Choose({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly (readonly [string, string])[];
  readonly onChange: (value: string) => void;
  readonly hint?: string;
}): JSX.Element {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Select value={value} onValueChange={onChange}>
        <FieldControl>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
        </FieldControl>
        <SelectContent>
          {options.map(([v, l]) => (
            <SelectItem key={v} value={v}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint === undefined ? null : <FieldDescription>{hint}</FieldDescription>}
    </Field>
  );
}
