'use client';

import {
  useEffect,
  useRef,
  type JSX,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn';

/**
 * Boxes laid over a page (`PdfPages`' overlay): placed, moved, resized and
 * removed while a document is prepared; pressed, one after another, while
 * it is filled in.
 *
 * Every position is a fraction of the page (0–1, from its top left), so a box
 * is where it was put whatever size the page is drawn at, and the server
 * stamps it in the same place on the PDF.
 *
 * ### By pointer, finger or keyboard
 *
 * Pointer events, captured on the box, so a drag works under a mouse, a pen
 * and a finger alike (`touch-none` keeps the page from scrolling under it).
 * A focused box moves with the arrow keys and resizes with Shift and the
 * arrows; Delete removes it. Each box is named by its `label`, so a list of
 * them reads as a list of who signs where.
 */

export interface PlacedBox {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Which of the six chart colours: one per person, so whose box it is shows. */
  readonly tone: 1 | 2 | 3 | 4 | 5 | 6;
  /** "Signature, Ada Lovelace". Read out, and shown in an empty box. */
  readonly label: string;
  /** Shown in the box until it is filled: "Sign", "Date". */
  readonly hint?: string;
  /** Filled: drawn without its tint, as what it holds. */
  readonly done?: boolean;
}

export interface PlacementLayerProps {
  readonly boxes: readonly PlacedBox[];
  /** Placing: boxes move, resize and are removed. Otherwise they are pressed. */
  readonly editable?: boolean;
  readonly selected?: string | null;
  readonly onSelect?: (id: string | null) => void;
  readonly onChange?: (id: string, rect: Pick<PlacedBox, 'x' | 'y' | 'w' | 'h'>) => void;
  readonly onRemove?: (id: string) => void;
  /** A press on the page where no box is: placing, put one there (its top left, as fractions). */
  readonly onPlace?: (point: { readonly x: number; readonly y: number }) => void;
  /** A box pressed, when not placing. */
  readonly onActivate?: (id: string) => void;
  /** Brought into view and focused, when it changes: "Next" uses it. */
  readonly focus?: string | null;
  /** What a box holds once filled: a signature, a date. */
  readonly render?: (box: PlacedBox) => ReactNode;
  readonly className?: string;
}

const TONE: Record<PlacedBox['tone'], string> = {
  1: 'border-chart-1 bg-chart-1/15',
  2: 'border-chart-2 bg-chart-2/15',
  3: 'border-chart-3 bg-chart-3/15',
  4: 'border-chart-4 bg-chart-4/15',
  5: 'border-chart-5 bg-chart-5/15',
  6: 'border-chart-6 bg-chart-6/15',
};

/** Arrow keys move a box this far; a pointer is not stepped. */
const NUDGE = 0.005;
const MIN = 0.02;

const clamp = (n: number, low: number, high: number) => Math.min(Math.max(n, low), high);

function fit(rect: Pick<PlacedBox, 'x' | 'y' | 'w' | 'h'>) {
  const w = clamp(rect.w, MIN, 1);
  const h = clamp(rect.h, MIN, 1);
  return { x: clamp(rect.x, 0, 1 - w), y: clamp(rect.y, 0, 1 - h), w, h };
}

export function PlacementLayer({
  boxes,
  editable = false,
  selected = null,
  onSelect,
  onChange,
  onRemove,
  onPlace,
  onActivate,
  focus = null,
  render,
  className,
}: PlacementLayerProps): JSX.Element {
  const layer = useRef<HTMLDivElement>(null);
  const refs = useRef(new Map<string, HTMLElement>());
  const drag = useRef<{
    id: string;
    mode: 'move' | 'resize';
    from: { x: number; y: number };
    start: Pick<PlacedBox, 'x' | 'y' | 'w' | 'h'>;
  } | null>(null);

  useEffect(() => {
    if (focus === null) return;
    const el = refs.current.get(focus);
    if (el === undefined) return;
    // After the frame, and straight there: the button that asked (Start, Next)
    // is usually redrawn by the same press, and a smooth scroll begun under it
    // was cut short a few pixels in, leaving the box off screen.
    const frame = requestAnimationFrame(() => {
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'center' });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [focus]);

  const fraction = (event: PointerEvent): { x: number; y: number } => {
    const r = layer.current?.getBoundingClientRect();
    if (r === undefined || r.width === 0) return { x: 0, y: 0 };
    return { x: (event.clientX - r.left) / r.width, y: (event.clientY - r.top) / r.height };
  };

  const begin = (event: PointerEvent<HTMLElement>, box: PlacedBox, mode: 'move' | 'resize') => {
    if (!editable) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: box.id, mode, from: fraction(event), start: box };
    onSelect?.(box.id);
  };
  const move = (event: PointerEvent) => {
    const d = drag.current;
    if (d === null) return;
    const at = fraction(event);
    const dx = at.x - d.from.x;
    const dy = at.y - d.from.y;
    onChange?.(
      d.id,
      fit(
        d.mode === 'move'
          ? { ...d.start, x: d.start.x + dx, y: d.start.y + dy }
          : { ...d.start, w: d.start.w + dx, h: d.start.h + dy },
      ),
    );
  };
  const end = () => {
    drag.current = null;
  };

  const keys = (event: KeyboardEvent, box: PlacedBox) => {
    if (!editable) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      onRemove?.(box.id);
      return;
    }
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-NUDGE, 0],
      ArrowRight: [NUDGE, 0],
      ArrowUp: [0, -NUDGE],
      ArrowDown: [0, NUDGE],
    };
    const [dx, dy] = step[event.key] ?? [0, 0];
    if (dx === 0 && dy === 0) return;
    event.preventDefault();
    onChange?.(
      box.id,
      fit(
        event.shiftKey
          ? { ...box, w: box.w + dx, h: box.h + dy }
          : { ...box, x: box.x + dx, y: box.y + dy },
      ),
    );
  };

  return (
    <div
      ref={layer}
      className={cn(
        'relative size-full',
        editable && onPlace !== undefined && 'cursor-copy',
        className,
      )}
      onPointerDown={(event) => {
        if (!editable || event.target !== event.currentTarget) return;
        onSelect?.(null);
        onPlace?.(fraction(event));
      }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {boxes.map((box) => {
        const chosen = editable && selected === box.id;
        const content = render?.(box);
        const common = {
          ref: (el: HTMLElement | null) => {
            if (el === null) refs.current.delete(box.id);
            else refs.current.set(box.id, el);
          },
          'aria-label': box.label,
          style: {
            left: `${String(box.x * 100)}%`,
            top: `${String(box.y * 100)}%`,
            width: `${String(box.w * 100)}%`,
            height: `${String(box.h * 100)}%`,
          },
          className: cn(
            'absolute grid place-items-center rounded-sm border-2 text-2xs font-semibold text-[var(--reach-neutral-900)]',
            // The page is paper, white in either theme: the ring and the ink are the
            // light theme's, so both read against it in the dark one too.
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--reach-brand-600)]',
            box.done === true
              ? 'border-transparent bg-transparent'
              : cn('border-dashed', TONE[box.tone]),
            chosen && 'border-solid outline-2 outline-offset-2 outline-[var(--reach-brand-600)]',
            editable ? 'cursor-move touch-none select-none' : 'cursor-pointer',
          ),
        } as const;
        const inside = (
          <>
            {content ?? (
              <span className="truncate px-1" aria-hidden>
                {box.hint ?? box.label}
              </span>
            )}
          </>
        );
        if (!editable) {
          return (
            <button
              key={box.id}
              type="button"
              {...common}
              onClick={() => {
                onActivate?.(box.id);
              }}
            >
              {inside}
            </button>
          );
        }
        return (
          <div
            key={box.id}
            role="button"
            tabIndex={0}
            aria-pressed={chosen}
            aria-roledescription="placed box"
            {...common}
            onPointerDown={(event) => {
              begin(event, box, 'move');
            }}
            onFocus={() => onSelect?.(box.id)}
            onKeyDown={(event) => {
              keys(event, box);
            }}
          >
            {inside}
            {chosen ? (
              <span
                aria-hidden
                className="absolute -right-1.5 -bottom-1.5 size-3 cursor-nwse-resize rounded-full border-2 border-white bg-[var(--reach-brand-600)] touch-none"
                onPointerDown={(event) => {
                  begin(event, box, 'resize');
                }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
