'use client';

import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { cva, type VariantProps } from 'class-variance-authority';
import {
  createContext,
  use,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type JSX,
} from 'react';

import { cn } from '../../lib/cn';

/**
 * Two to five views of the same content, one of them always on.
 *
 * Built on Radix `ToggleGroup` with `type="single"`, so assistive tech hears a
 * radio group and the arrow keys move between segments. Two things it adds over
 * a plain `ToggleGroup`:
 *
 * - **A value is required.** Pressing the current segment again does not clear
 *   it. "Day, Week, Month" with nothing selected is not a state the content
 *   behind it can render.
 * - **A thumb that slides.** One surface moves between segments rather than
 *   each segment lighting up in place, so the eye follows the change. It is
 *   measured from the selected segment, so labels of any width work, and it
 *   snaps rather than slides under reduced motion.
 *
 * `ToggleGroup` stays the right choice for a multi-select filter or a
 * formatting toolbar, where nothing, or several things, can be on.
 */

const root = cva(
  'relative isolate inline-flex items-center gap-0.5 rounded-full bg-surface-sunken p-[3px]',
  {
    variants: {
      fullWidth: { true: 'flex w-full [&>[role=radio]]:flex-1', false: '' },
    },
    defaultVariants: { fullWidth: false },
  },
);

const item = cva(
  [
    'relative z-10 inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full whitespace-nowrap',
    'font-semibold text-fg-muted tap-target',
    'transition-colors duration-(--animate-duration-fast) ease-standard',
    'hover:text-fg data-[state=on]:text-fg',
    'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-border-focus',
    'disabled:pointer-events-none disabled:opacity-45',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      size: {
        sm: 'h-7 px-3 text-xs touch:h-8 touch:text-sm [&_svg]:size-3.5',
        md: 'h-8.5 px-3.5 text-sm touch:h-9 [&_svg]:size-4',
        lg: 'h-10 px-4 text-base [&_svg]:size-4',
      },
      iconOnly: { true: 'aspect-square px-0', false: '' },
    },
    defaultVariants: { size: 'md', iconOnly: false },
  },
);

type Size = NonNullable<VariantProps<typeof item>['size']>;
const SizeContext = createContext<Size>('md');

export interface SegmentedControlProps
  extends
    Omit<
      ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>,
      'type' | 'value' | 'defaultValue' | 'onValueChange'
    >,
    VariantProps<typeof root> {
  value?: string;
  defaultValue?: string;
  /** Fires with the newly selected segment. Never with an empty string. */
  onValueChange?: (value: string) => void;
  /** Applies to every segment. `lg` is desk-only in the design; under a finger it matches `md`. */
  size?: Size;
}

/** Where the thumb sits, in the root's own coordinates. */
interface Thumb {
  x: number;
  width: number;
}

export function SegmentedControl({
  className,
  fullWidth,
  size = 'md',
  value: valueProp,
  defaultValue,
  onValueChange,
  children,
  ...props
}: SegmentedControlProps): JSX.Element {
  const [uncontrolled, setUncontrolled] = useState(defaultValue ?? '');
  const value = valueProp ?? uncontrolled;
  const ref = useRef<HTMLDivElement | null>(null);
  const [thumb, setThumb] = useState<Thumb | null>(null);
  // The first placement lands without a transition. Sliding in from the left
  // edge on mount is motion that means nothing.
  const [placed, setPlaced] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;
    const measure = (): void => {
      const on = el.querySelector<HTMLElement>('[data-state="on"]');
      const next = on ? { x: on.offsetLeft, width: on.offsetWidth } : null;
      setThumb((prev) => (prev?.x === next?.x && prev?.width === next?.width ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    // Labels change width when the font loads, when density flips under a
    // finger, and when a full-width control is resized, and the thumb has to
    // follow each of them without a value change to prompt it.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    return () => {
      observer.disconnect();
    };
  }, [value, children]);

  useLayoutEffect(() => {
    if (thumb !== null && !placed) {
      const frame = requestAnimationFrame(() => {
        setPlaced(true);
      });
      return () => {
        cancelAnimationFrame(frame);
      };
    }
    return undefined;
  }, [thumb, placed]);

  return (
    <SizeContext value={size}>
      <ToggleGroupPrimitive.Root
        ref={ref}
        type="single"
        value={value}
        onValueChange={(next) => {
          // Radix reports an empty string when the current item is pressed
          // again. A segmented control always has a view, so that press is a
          // no-op rather than a deselection.
          if (next === '') return;
          setUncontrolled(next);
          onValueChange?.(next);
        }}
        className={cn(root({ fullWidth }), className)}
        {...props}
      >
        {children}
        {thumb ? (
          <span
            aria-hidden="true"
            data-slot="segmented-thumb"
            style={{ '--x': `${String(thumb.x)}px`, width: thumb.width } as CSSProperties}
            className={cn(
              'absolute inset-y-[3px] left-0 z-0 translate-x-(--x) rounded-full bg-surface-raised shadow-sm',
              placed &&
                'transition-[translate,width] duration-(--animate-duration-spring-snap) ease-spring-snap',
            )}
          />
        ) : null}
      </ToggleGroupPrimitive.Root>
    </SizeContext>
  );
}

export interface SegmentedControlItemProps extends ComponentPropsWithoutRef<
  typeof ToggleGroupPrimitive.Item
> {
  /** Square segment for a single glyph. Requires an `aria-label`. */
  iconOnly?: boolean;
}

export function SegmentedControlItem({
  className,
  iconOnly,
  ...props
}: SegmentedControlItemProps): JSX.Element {
  const size = use(SizeContext);
  return (
    <ToggleGroupPrimitive.Item className={cn(item({ size, iconOnly }), className)} {...props} />
  );
}
