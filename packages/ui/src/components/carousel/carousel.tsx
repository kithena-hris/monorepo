'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Children,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn';
import { usePrefersReducedMotion } from '../../lib/use-media-query';
import { Button } from '../button/button';

/**
 * A few equal items side by side, scrolled or swiped to see more.
 *
 * The browser does the moving. The track is a CSS scroll-snap container, so a
 * swipe has the platform's own momentum and a trackpad scrolls it sideways
 * without a line of gesture code; the buttons and the arrow keys only ask it
 * to scroll to a slide. The next slide always peeks in from the edge, which is
 * the affordance that says there is more.
 *
 * ### Semantics (WAI-ARIA APG carousel)
 *
 * The whole is a `region` with `aria-roledescription="carousel"` and a name,
 * each slide a `group` with `aria-roledescription="slide"` and "2 of 5". It
 * never auto-plays, so there is no rotation control to provide, and the slide
 * container is `aria-live="polite"` as the pattern asks of a carousel that
 * does not rotate on its own.
 */

/** The slide whose start is closest to the scroll position. Offsets are relative to the first slide. */
export function nearestSlide(offsets: readonly number[], scrollLeft: number): number {
  let best = 0;
  for (let index = 1; index < offsets.length; index += 1) {
    const offset = offsets[index] ?? 0;
    if (Math.abs(offset - scrollLeft) < Math.abs((offsets[best] ?? 0) - scrollLeft)) best = index;
  }
  return best;
}

/**
 * Whether the track can scroll further either way. A pixel of slack, because
 * a fractional device-pixel ratio leaves `scrollLeft` a hair short of the end.
 */
export function scrollEdges(
  scrollLeft: number,
  scrollWidth: number,
  clientWidth: number,
): { atStart: boolean; atEnd: boolean } {
  // ponytail: magnitude only, so an RTL track (negative scrollLeft) reads the same; the buttons are not mirrored.
  const left = Math.abs(scrollLeft);
  return { atStart: left <= 1, atEnd: left + clientWidth >= scrollWidth - 1 };
}

export interface CarouselProps extends Omit<ComponentPropsWithoutRef<'section'>, 'title'> {
  /** Names the region. Required: "carousel" alone tells nobody what is in it. */
  label: string;
  /** A visible heading, with the arrow buttons beside it. */
  title?: ReactNode;
  /**
   * `arrows` for a row of cards, `dots` for one slide at a time (a hero),
   * `none` where swiping and scrolling are enough.
   */
  controls?: 'arrows' | 'dots' | 'none';
  /** Width of each slide. The default leaves the next one peeking. */
  itemClassName?: string;
  /**
   * The slide to show, for a carousel driven from outside: a "Skip" button
   * under one card at a time moves it on. Swiping still works, and reports
   * through `onIndexChange`.
   */
  index?: number;
  /** The slide now nearest the start, after a swipe, a key or a button. */
  onIndexChange?: (index: number) => void;
  children: ReactNode;
}

export function Carousel({
  label,
  title,
  controls = 'arrows',
  itemClassName = 'w-56 touch:w-[78%]',
  index: wanted,
  onIndexChange,
  className,
  children,
  ...props
}: CarouselProps): JSX.Element {
  const slides = Children.toArray(children);
  const trackRef = useRef<HTMLDivElement>(null);
  const trackId = useId();
  const reducedMotion = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [edges, setEdges] = useState({ atStart: true, atEnd: false });

  const offsets = useCallback((): number[] => {
    const items = [...(trackRef.current?.children ?? [])];
    const first = items[0] instanceof HTMLElement ? items[0].offsetLeft : 0;
    return items.map((item) => (item instanceof HTMLElement ? item.offsetLeft - first : 0));
  }, []);

  const measure = useCallback((): void => {
    const track = trackRef.current;
    if (!track) return;
    const nearest = nearestSlide(offsets(), Math.abs(track.scrollLeft));
    setIndex((was) => {
      if (was !== nearest) onIndexChange?.(nearest);
      return nearest;
    });
    setEdges(scrollEdges(track.scrollLeft, track.scrollWidth, track.clientWidth));
  }, [offsets, onIndexChange]);

  useEffect(() => {
    measure();
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => {
      observer.disconnect();
    };
  }, [measure, slides.length]);

  const goTo = (target: number): void => {
    const clamped = Math.min(Math.max(target, 0), slides.length - 1);
    trackRef.current?.scrollTo({
      left: offsets()[clamped] ?? 0,
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
  };

  // Driven from outside: scroll to the slide asked for, once per change.
  useEffect(() => {
    if (wanted === undefined || wanted === index) return;
    const clamped = Math.min(Math.max(wanted, 0), slides.length - 1);
    trackRef.current?.scrollTo({
      left: offsets()[clamped] ?? 0,
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
    // `index` follows from the scroll; asking again for the same slide is a no-op.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      goTo(index + (event.key === 'ArrowRight' ? 1 : -1));
    }
  };

  const arrows =
    controls === 'arrows' ? (
      <div className="ms-auto flex shrink-0 gap-1.5">
        <Button
          size="sm"
          startIcon={<ChevronLeft aria-hidden />}
          aria-label="Previous slide"
          aria-controls={trackId}
          disabled={edges.atStart}
          onClick={() => {
            goTo(index - 1);
          }}
          className="rounded-control"
        />
        <Button
          size="sm"
          startIcon={<ChevronRight aria-hidden />}
          aria-label="Next slide"
          aria-controls={trackId}
          disabled={edges.atEnd}
          onClick={() => {
            goTo(index + 1);
          }}
          className="rounded-control"
        />
      </div>
    ) : null;

  return (
    <section
      aria-roledescription="carousel"
      aria-label={label}
      className={cn('flex min-w-0 flex-col gap-3', className)}
      {...props}
    >
      {title || arrows ? (
        <div className="flex min-h-control-sm items-center gap-3">
          {title ? <h3 className="text-md font-bold text-fg">{title}</h3> : null}
          {arrows}
        </div>
      ) : null}

      <div
        ref={trackRef}
        id={trackId}
        aria-live="polite"
        // Scrollable, so it has to be reachable from the keyboard; the arrow
        // keys then move a slide at a time.
        tabIndex={0}
        onScroll={measure}
        onKeyDown={onKeyDown}
        className={cn(
          'flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain rounded-lg',
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
        )}
      >
        {slides.map((slide, position) => (
          <div
            key={position}
            role="group"
            aria-roledescription="slide"
            aria-label={`${String(position + 1)} of ${String(slides.length)}`}
            className={cn('shrink-0 snap-start', itemClassName)}
          >
            {slide}
          </div>
        ))}
      </div>

      {controls === 'dots' ? (
        <div className="flex justify-center gap-1.5">
          {slides.map((_, position) => (
            <button
              key={position}
              type="button"
              aria-label={`Slide ${String(position + 1)}`}
              aria-controls={trackId}
              aria-current={position === index || undefined}
              onClick={() => {
                goTo(position);
              }}
              className={cn(
                'tap-target relative h-2 w-2 rounded-full bg-surface-active',
                'transition-[width,background-color] duration-(--animate-duration-normal) ease-standard',
                'aria-[current]:w-5 aria-[current]:bg-fg',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
              )}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
