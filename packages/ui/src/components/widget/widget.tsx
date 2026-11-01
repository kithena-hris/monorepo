import type { ComponentPropsWithoutRef, CSSProperties, JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { toneVar, type ChartTone } from '../chart/tones';

/**
 * A dashboard of widgets: columns of one fixed width, as many as the
 * container holds, and the rest of the row left empty rather than every
 * widget stretched to fill it. A widget is as wide as its content needs
 * (`span`), never as wide as the window happens to be.
 *
 * `size` is the column: `md` (19rem) for widgets with a list or a chart in
 * them, `sm` (13rem) for tiles that hold one figure. A `Widget` spans one to
 * four columns, and a span the container cannot fit falls back to as many
 * columns as there are, so a two-column widget is one column on a phone.
 */
export interface WidgetGridProps extends ComponentPropsWithoutRef<'div'> {
  readonly size?: 'sm' | 'md';
}

const COLUMN = { sm: '13rem', md: '19rem' } as const;

export function WidgetGrid({
  size = 'md',
  className,
  style,
  ...props
}: WidgetGridProps): JSX.Element {
  return (
    <div
      data-widget-grid={size}
      className={cn(
        '@container/widgets grid grid-flow-row-dense items-start justify-start gap-4 touch:gap-3',
        className,
      )}
      style={{
        gridTemplateColumns: `repeat(auto-fill, minmax(min(${COLUMN[size]}, 100%), ${COLUMN[size]}))`,
        ...style,
      }}
      {...props}
    />
  );
}

/*
 * The span a container can hold, by its width: n columns of the grid's
 * size and the gaps between them. Written out whole, since Tailwind only
 * builds class names it can read in the source.
 */
const SPAN = {
  md: {
    1: '',
    2: '@min-[39rem]/widgets:col-span-2',
    3: '@min-[39rem]/widgets:col-span-2 @min-[59rem]/widgets:col-span-3',
    4: '@min-[39rem]/widgets:col-span-2 @min-[59rem]/widgets:col-span-3 @min-[79rem]/widgets:col-span-4',
  },
  sm: {
    1: '',
    2: '@min-[27rem]/widgets:col-span-2',
    3: '@min-[27rem]/widgets:col-span-2 @min-[41rem]/widgets:col-span-3',
    4: '@min-[27rem]/widgets:col-span-2 @min-[41rem]/widgets:col-span-3 @min-[55rem]/widgets:col-span-4',
  },
} as const;

export interface WidgetProps extends Omit<ComponentPropsWithoutRef<'section'>, 'title'> {
  readonly title: ReactNode;
  /** A glyph in a tinted tile before the title: what the widget is about at a glance. */
  readonly icon?: ReactNode;
  /** The icon tile's colour, from the chart tones. Neutral without one. */
  readonly tone?: ChartTone;
  /** A count or a state beside the title: a number, a `Badge`. */
  readonly meta?: ReactNode;
  readonly description?: ReactNode;
  /** One way on, at the header's end: "Open Inbox", "See all". */
  readonly action?: ReactNode;
  readonly footer?: ReactNode;
  /** How many of the grid's columns it takes, where the container has them. */
  readonly span?: 1 | 2 | 3 | 4;
  /** The grid it sits in, for its span's breakpoints. */
  readonly size?: 'sm' | 'md';
  /** The body runs to the edges: a list or a table whose rows draw their own padding. */
  readonly flush?: boolean;
  /** The title's level in the page outline. */
  readonly level?: 2 | 3;
}

/**
 * One widget: a card with a header (icon, title, count, one action), a
 * body and an optional footer. A `List` or a table inside it sits flush,
 * without a card of its own, so a widget never holds a second card.
 */
export function Widget({
  title,
  icon,
  tone,
  meta,
  description,
  action,
  footer,
  span = 1,
  size = 'md',
  flush = false,
  level = 2,
  className,
  children,
  ...props
}: WidgetProps): JSX.Element {
  const Heading = `h${String(level)}` as 'h2' | 'h3';
  const tint: CSSProperties | undefined =
    tone === undefined
      ? undefined
      : {
          color: `color-mix(in oklab, ${toneVar[tone]} 75%, var(--color-fg))`,
          background: `color-mix(in oklch, ${toneVar[tone]} 18%, transparent)`,
        };
  return (
    <section
      data-surface=""
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-lg bg-surface text-fg shadow-sm touch:rounded-[1.375rem]',
        SPAN[size][span],
        className,
      )}
      {...props}
    >
      <header className="flex items-start gap-3 px-5 pt-4.5 pb-3 touch:px-4 touch:pt-4">
        {icon === undefined ? null : (
          <span
            aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-sunken text-fg-muted [&_svg]:size-4"
            style={tint}
          >
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-h-8 items-center gap-2">
            <Heading className="truncate text-md leading-tight font-semibold tracking-tight">
              {title}
            </Heading>
            {meta === undefined ? null : (
              <span className="shrink-0 text-sm text-fg-muted tabular-nums">{meta}</span>
            )}
          </div>
          {description === undefined ? null : (
            <p className="text-sm text-pretty text-fg-muted">{description}</p>
          )}
        </div>
        {action === undefined ? null : (
          <div className="flex min-h-8 shrink-0 items-center gap-1">{action}</div>
        )}
      </header>
      <div
        className={cn(
          'flex min-w-0 flex-1 flex-col',
          flush ? 'pb-1.5' : 'gap-3 px-5 pb-5 touch:px-4 touch:pb-4',
        )}
      >
        {children}
      </div>
      {footer === undefined ? null : (
        <footer className="flex items-center gap-2 border-t border-border px-5 py-3 text-sm touch:px-4">
          {footer}
        </footer>
      )}
    </section>
  );
}
