import {
  Alert,
  Badge,
  Button,
  dateFormat,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  icons,
  numberFormat,
  SearchField,
} from '@reach/ui';
import { useState, useTransition, type JSX, type MouseEvent, type ReactNode } from 'react';

import type { Category, Done, ScreenProps } from './types';
import { t } from './i18n';

/**
 * What every Recruiting screen does the same way: a link that stays in the
 * app, a write with its pending state and refusal, money and dates in words,
 * and the badges a state is drawn with.
 */

export type Tone = 'neutral' | 'accent' | 'info' | 'success' | 'warning' | 'danger';

/** A link the shell's router follows without a page load. */
export function To({
  href,
  onNavigate,
  children,
  className,
  'aria-current': current,
}: {
  readonly href: string;
  readonly onNavigate?: ((to: string) => void) | undefined;
  readonly children: ReactNode;
  readonly className?: string;
  readonly 'aria-current'?: 'page' | 'true' | undefined;
}): JSX.Element {
  return (
    <a
      href={href}
      className={className ?? 'font-medium text-fg hover:underline'}
      aria-current={current}
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

/** One write: run it, show its refusal, refresh the page's data when it lands. */
export function useAct(props: Pick<ScreenProps<unknown>, 'onAct' | 'onRefresh'>): {
  readonly pending: boolean;
  readonly error: string | null;
  readonly clear: () => void;
  readonly run: (
    name: string,
    variables: Readonly<Record<string, unknown>>,
    after?: (data: unknown) => void,
  ) => void;
  readonly call: (name: string, variables: Readonly<Record<string, unknown>>) => Promise<Done>;
} {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const call = async (name: string, variables: Readonly<Record<string, unknown>>): Promise<Done> =>
    props.onAct === undefined
      ? { ok: false, message: t('shared.not_available_here', 'Not available here') }
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

/** One command in a page's overflow menu: hidden when the viewer may not, a separator before `group` changes. */
export interface MoreItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  readonly hidden?: boolean;
  readonly group?: string;
  readonly onSelect: () => void;
}

/**
 * A header's secondary commands, behind one "More" button: a page keeps one
 * primary action in view and everything else one press away, so its header
 * stays a title and a decision.
 */
export function MoreMenu({
  label,
  items,
}: {
  readonly label: string;
  readonly items: readonly MoreItem[];
}): JSX.Element | null {
  const shown = items.filter((i) => i.hidden !== true);
  if (shown.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" aria-label={label} startIcon={<icons.more aria-hidden />} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        {shown.map((item, i) => (
          <MoreRow key={item.id} item={item} before={shown[i - 1]} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MoreRow({
  item,
  before,
}: {
  readonly item: MoreItem;
  readonly before: MoreItem | undefined;
}): JSX.Element {
  return (
    <>
      {before !== undefined && before.group !== item.group ? <DropdownMenuSeparator /> : null}
      <DropdownMenuItem
        destructive={item.destructive ?? false}
        disabled={item.disabled ?? false}
        onSelect={item.onSelect}
      >
        {item.icon}
        {item.label}
      </DropdownMenuItem>
    </>
  );
}

export function Refusal({ error }: { readonly error: string | null }): JSX.Element | null {
  return error === null ? null : (
    <Alert tone="danger" title={t('shared.that_did_not_go_through', 'That did not go through')}>
      {error}
    </Alert>
  );
}

/** Minor units in the currency's own form: 7,200,000 EUR is "€72,000". */
export function money(minor: number, currency: string, compact = false): string {
  return numberFormat({
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
    ...(compact ? { notation: 'compact' } : {}),
  }).format(minor / 100);
}

/** A range, or one figure when it is fixed. */
export const range = (min: number, max: number, currency: string): string =>
  min === max
    ? money(min, currency)
    : t('shared.text', '{{min}} – {{max}}', {
        min: money(min, currency),
        max: money(max, currency),
      });

const DAY = dateFormat({ day: 'numeric', month: 'short', timeZone: 'UTC' });
const DAY_YEAR = dateFormat({
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const WHEN = dateFormat({
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** "14 Oct", or "14 Oct 2025" in another year. */
export function day(iso: string | null): string {
  if (iso === null || iso === '') return '—';
  const at = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return at.getUTCFullYear() === new Date().getUTCFullYear() ? DAY.format(at) : DAY_YEAR.format(at);
}

/** "Thu 15 Oct, 15:00", in the reader's own zone. */
export const when = (iso: string): string => WHEN.format(new Date(iso));

/** "Senior Backend Engineer", "no_show" → "No show". */
export const words = (key: string): string => {
  const spaced = key.replaceAll('_', ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

export const CATEGORY_TONE: Readonly<Record<Category, Tone>> = {
  applied: 'neutral',
  screening: 'info',
  interview: 'accent',
  assessment: 'accent',
  works_council: 'warning',
  offer: 'success',
  contract: 'success',
  hired: 'success',
};

const STATE_TONE: Readonly<Record<string, Tone>> = {
  draft: 'neutral',
  pending_approval: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
  filled: 'accent',
  open: 'success',
  on_hold: 'warning',
  closed: 'neutral',
  sent: 'accent',
  accepted: 'success',
  declined: 'danger',
  expired: 'neutral',
  withdrawn: 'neutral',
  live: 'success',
  pending: 'warning',
  paused: 'warning',
  failed: 'danger',
  active: 'accent',
  hired: 'success',
  scheduled: 'accent',
  completed: 'success',
  no_show: 'danger',
  conditions_open: 'warning',
  conditions_met: 'success',
  started: 'success',
  met: 'success',
  waived: 'neutral',
  open_condition: 'warning',
};

/** A state as a badge: its words and its tone. */
export function StateBadge({
  state,
  label,
}: {
  readonly state: string;
  readonly label?: string;
}): JSX.Element {
  return (
    <Badge size="sm" tone={STATE_TONE[state] ?? 'neutral'}>
      {label ?? words(state)}
    </Badge>
  );
}

/** An idempotency-free id for a new record, made in the browser. */
export const newId = (): string => crypto.randomUUID();

/** A search box whose words go to the address on Enter, so a search is a link. */
export function Search({
  label,
  placeholder,
  initial,
  onSearch,
  className,
}: {
  readonly label: string;
  readonly placeholder: string;
  readonly initial: string;
  readonly onSearch: (q: string) => void;
  readonly className?: string;
}): JSX.Element {
  const [value, setValue] = useState(initial);
  return (
    <SearchField
      label={label}
      placeholder={placeholder}
      value={value}
      onValueChange={setValue}
      onSearch={onSearch}
      {...(className === undefined ? {} : { containerClassName: className })}
    />
  );
}
