'use client';

import { ChevronRight } from 'lucide-react';
import {
  cloneElement,
  isValidElement,
  useRef,
  type ComponentPropsWithoutRef,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';

import { cn } from '../../lib/cn';

/**
 * The row most lists are built from, and the rounded group that holds them.
 *
 * The middle is always the same, a title and up to two lines under it. What
 * changes is what goes before (an avatar, an icon, a checkbox) and after (a
 * value, a switch, a button, a chevron).
 *
 * Not `ListDetail`, which is the two-pane layout a list and its selection live
 * in, and not a `Table`, whose columns line up across rows. A list row is read
 * one at a time.
 *
 * ### Interactive rows
 *
 * A row that opens something passes its link or button as the child with
 * `asChild`, and the whole row becomes that element: one target, one name, the
 * title. Such a row must not also hold a switch or a button; two targets
 * inside one is how a tap meant for the row flips a setting.
 *
 * ### Swipe actions
 *
 * `swipeActions` puts buttons behind the row's trailing edge. Pull the row
 * towards the start to reveal them; pull past 60% of its width and the first
 * one runs, and the row closes. The row follows the finger 1:1 and settles on
 * a spring, which reduced motion turns into a jump.
 *
 * The gesture is an accelerator, never the only way in. The buttons are real
 * buttons in the tab order after the row: focusing one slides the row open so
 * it can be seen, Escape or moving focus away closes it, and a screen reader
 * finds them in reading order like any other control.
 */

export function List({ className, ...props }: ComponentPropsWithoutRef<'ul'>): JSX.Element {
  return (
    <ul
      className={cn(
        'overflow-hidden rounded-[1.125rem] bg-surface shadow-sm touch:rounded-[1.375rem]',
        // A hairline between rows, drawn as an inset shadow so it takes no
        // height and a selected row's fill reaches the edge.
        '[&>li:not(:last-child)]:shadow-[inset_0_-1px_0_var(--color-border)]',
        className,
      )}
      {...props}
    />
  );
}

export interface ListItemProps extends Omit<ComponentPropsWithoutRef<'li'>, 'title'> {
  /** An `Avatar`, an icon, or a `Checkbox`. */
  leading?: ReactNode;
  /**
   * An icon in a tile, in place of `leading`: a row that is a place rather
   * than a person. With a `description` the row is 72px, room for a line on
   * what the place holds.
   */
  icon?: ReactNode;
  /** One line under the title, truncated. */
  description?: ReactNode;
  /** A longer passage under the description, clamped to two lines. */
  supporting?: ReactNode;
  /** Small text at the end of the title line, such as a timestamp. */
  meta?: ReactNode;
  /** A value, a `Badge`, a `Switch` or a `Button`, after the text. */
  trailing?: ReactNode;
  /** Draws a disclosure chevron: this row opens something. */
  chevron?: boolean;
  /** Tints the row. Pair it with `aria-current` or `aria-selected` on the child, as the pattern needs. */
  selected?: boolean;
  /** Dims the row. Mark the child `aria-disabled` if it is interactive. */
  disabled?: boolean;
  /** The row becomes its child, a link or a button; the child's text is the title. */
  asChild?: boolean;
  /**
   * Buttons behind the trailing edge, revealed by pulling the row. The first
   * one is what a full swipe runs, so it should be the likeliest and the least
   * destructive. Three at most: a fourth does not fit behind a phone row.
   */
  swipeActions?: readonly SwipeAction[];
  /** Lets a full-width pull run the first action. On by default. */
  fullSwipe?: boolean;
}

export interface SwipeAction {
  label: string;
  icon?: ReactNode;
  /** `danger` is a solid red fill: for delete and nothing gentler. */
  tone?: 'neutral' | 'accent' | 'danger';
  /** The accessible name, when the label alone repeats on every row. */
  name?: string;
  onSelect: () => void;
}

/** Where a released row comes to rest. */
export type SwipeRest = 'closed' | 'open' | 'full';

/** Speed, in px/s, past which a release follows the flick rather than the distance. */
const FLICK = 500;
/** Fraction of the row's width past which a pull runs the first action. */
const FULL = 0.6;

/**
 * Decides where a released row settles.
 *
 * `offset` is how far the row has been pulled open, in pixels; `velocity` is
 * how fast it was moving when released, positive towards open. Direction of
 * travel wins over position: a quick flick opens from a few pixels in, and a
 * flick back closes from anywhere, including from past the full-swipe line,
 * because that is somebody changing their mind.
 */
export function swipeOutcome({
  offset,
  velocity,
  tray,
  width,
  full,
}: {
  offset: number;
  velocity: number;
  tray: number;
  width: number;
  full: boolean;
}): SwipeRest {
  if (velocity < -FLICK) return 'closed';
  if (full && width > 0 && offset >= width * FULL) return 'full';
  if (velocity > FLICK) return 'open';
  return offset >= tray / 2 ? 'open' : 'closed';
}

const actionTone: Record<NonNullable<SwipeAction['tone']>, string> = {
  neutral: 'bg-surface-active text-fg',
  accent:
    'bg-accent-solid text-fg-on-accent [--reach-color-border-focus:var(--reach-color-fg-on-accent)]',
  danger:
    'bg-danger-solid text-fg-on-solid [--reach-color-border-focus:var(--reach-color-fg-on-solid)]',
};

/**
 * The pull itself. Transforms are written straight to the row: the pointer
 * moves faster than React should re-render, and nothing in state changes
 * during a gesture.
 */
function useSwipe(
  actions: readonly SwipeAction[],
  fullSwipe: boolean,
): {
  row: RefObject<HTMLDivElement | null>;
  tray: RefObject<HTMLDivElement | null>;
  open: () => void;
  close: () => void;
  handlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerCancel: () => void;
    onClickCapture: (event: { stopPropagation: () => void; preventDefault: () => void }) => void;
  };
} {
  const row = useRef<HTMLDivElement | null>(null);
  const tray = useRef<HTMLDivElement | null>(null);
  const offset = useRef(0);
  const gesture = useRef<{
    x: number;
    y: number;
    from: number;
    sign: 1 | -1;
    pulling: boolean;
    samples: { at: number; offset: number }[];
  } | null>(null);
  const swallowClick = useRef(false);

  const place = (next: number, animate: boolean): void => {
    offset.current = next;
    const element = row.current;
    if (!element) return;
    const sign = getComputedStyle(element).direction === 'rtl' ? 1 : -1;
    element.toggleAttribute('data-dragging', !animate);
    element.parentElement?.toggleAttribute('data-swiped', next > 0);
    element.style.transform = next === 0 ? '' : `translateX(${String(sign * next)}px)`;
  };
  const trayWidth = (): number => tray.current?.offsetWidth ?? 0;
  const open = (): void => {
    place(trayWidth(), true);
  };
  const close = (): void => {
    place(0, true);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    gesture.current = {
      x: event.clientX,
      y: event.clientY,
      from: offset.current,
      sign: getComputedStyle(event.currentTarget).direction === 'rtl' ? -1 : 1,
      pulling: false,
      samples: [],
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const state = gesture.current;
    if (!state) return;
    const dx = (state.x - event.clientX) * state.sign;
    const dy = event.clientY - state.y;
    if (!state.pulling) {
      // Whichever axis clears 8px first owns the gesture. Vertical is the
      // page's scroll (the row is `touch-action: pan-y`), so give it back.
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
        gesture.current = null;
        return;
      }
      if (Math.abs(dx) < 8) return;
      state.pulling = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    // Past the tray only when a full swipe is possible; otherwise the row
    // resists, a third of the way, so it is plain there is nothing further.
    const pulled = Math.max(0, state.from + dx);
    const limit = fullSwipe ? event.currentTarget.offsetWidth : trayWidth();
    const next = pulled <= limit ? pulled : limit + (pulled - limit) / 3;
    place(next, false);
    state.samples = [...state.samples, { at: event.timeStamp, offset: next }].filter(
      (sample) => event.timeStamp - sample.at < 100,
    );
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const state = gesture.current;
    gesture.current = null;
    if (!state?.pulling) return;
    swallowClick.current = true;
    const first = state.samples[0];
    const last = state.samples.at(-1);
    const velocity =
      first && last && last.at > first.at
        ? ((last.offset - first.offset) / (last.at - first.at)) * 1000
        : 0;
    const rest = swipeOutcome({
      offset: offset.current,
      velocity,
      tray: trayWidth(),
      width: event.currentTarget.offsetWidth,
      full: fullSwipe,
    });
    if (rest === 'full') {
      actions[0]?.onSelect();
      close();
    } else if (rest === 'open') open();
    else close();
  };

  return {
    row,
    tray,
    open,
    close,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: () => {
        gesture.current = null;
        close();
      },
      // The click that ends a pull is not a tap on the row.
      onClickCapture: (event) => {
        if (!swallowClick.current) return;
        swallowClick.current = false;
        event.stopPropagation();
        event.preventDefault();
      },
    },
  };
}

type ChildElement = ReactElement<{ children?: ReactNode; className?: string }>;

export function ListItem({
  className,
  leading,
  icon,
  description,
  supporting,
  meta,
  trailing,
  chevron = false,
  selected = false,
  disabled = false,
  asChild = false,
  swipeActions,
  fullSwipe = true,
  children,
  ...props
}: ListItemProps): JSX.Element {
  const interactive = asChild && isValidElement(children);
  const swipe = useSwipe(swipeActions ?? [], fullSwipe);
  const row = cn(
    'group/row flex w-full min-h-14 items-center gap-3 px-4.5 py-2 text-start text-fg touch:min-h-16 touch:px-4',
    supporting && 'items-start py-3.5',
    icon && description && 'min-h-18 touch:min-h-18',
    selected && 'bg-accent-subtle',
    disabled && 'opacity-50',
    interactive && [
      'transition-colors duration-(--animate-duration-fast) ease-standard',
      !selected && 'hover:bg-surface-hover active:bg-surface-active',
      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus',
    ],
  );

  const content = (title: ReactNode): JSX.Element => (
    <>
      {icon ? (
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-[0.75rem] bg-surface-sunken text-fg [&_svg]:size-5"
        >
          {icon}
        </span>
      ) : leading ? (
        <span className="flex shrink-0 items-center">{leading}</span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[0.875rem]/[1.3] font-semibold touch:text-[1rem]">
            {title}
          </span>
          {meta ? <span className="shrink-0 text-xs text-fg-subtle">{meta}</span> : null}
        </span>
        {description ? (
          <span className="truncate text-[0.8125rem]/[1.3] text-fg-muted touch:text-[0.875rem]">
            {description}
          </span>
        ) : null}
        {supporting ? (
          <span className="mt-1 line-clamp-2 text-[0.875rem]/[1.45] text-fg-muted touch:text-[0.9375rem]">
            {supporting}
          </span>
        ) : null}
      </span>
      {trailing ? (
        <span className="flex shrink-0 items-center gap-1 text-fg-muted">{trailing}</span>
      ) : null}
      {chevron ? (
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
      ) : null}
    </>
  );

  const child = interactive ? (children as ChildElement) : null;
  const body = child
    ? cloneElement(
        child,
        { className: cn(row, child.props.className) },
        content(child.props.children),
      )
    : null;

  if (swipeActions && swipeActions.length > 0) {
    return (
      <li
        className={cn('group/swipe relative overflow-hidden', className)}
        {...props}
        onKeyDown={(event) => {
          if (event.key === 'Escape') swipe.close();
          props.onKeyDown?.(event);
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) swipe.close();
          props.onBlur?.(event);
        }}
      >
        {/* Transparent at rest, so a rounded list corner cannot antialias the
            actions' colour through the row; still in the tab order, and shown
            the moment one of them takes focus. */}
        <div
          ref={swipe.tray}
          className="absolute inset-y-0 end-0 flex opacity-0 group-data-swiped/swipe:opacity-100 focus-within:opacity-100"
        >
          {swipeActions.map((action) => (
            <button
              key={action.label}
              type="button"
              {...(action.name === undefined ? {} : { 'aria-label': action.name })}
              onFocus={swipe.open}
              onClick={() => {
                action.onSelect();
                swipe.close();
              }}
              className={cn(
                'flex w-19 flex-col items-center justify-center gap-1 text-xs font-semibold',
                // An inset ring on the action's own fill: the row slides back
                // over anything drawn outside it. Forced colours drop shadows,
                // so there the outline returns.
                'focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--reach-color-border-focus)]',
                'forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-solid',
                '[&_svg]:size-4.5 [&_svg]:shrink-0',
                actionTone[action.tone ?? 'neutral'],
              )}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
        <div
          ref={swipe.row}
          className={cn(
            'relative touch-pan-y bg-surface',
            'motion-safe:transition-transform motion-safe:duration-(--animate-duration-spring-snap) motion-safe:ease-(--ease-spring-snap)',
            'data-dragging:transition-none',
            !interactive && row,
          )}
          {...swipe.handlers}
        >
          {body ?? content(children)}
        </div>
      </li>
    );
  }

  if (body) {
    return (
      <li className={className} {...props}>
        {body}
      </li>
    );
  }

  return (
    <li className={cn(row, className)} {...props}>
      {content(children)}
    </li>
  );
}
