import type { JSX, SVGProps } from 'react';

import { cn } from '../lib/cn';

/**
 * The Reach mark.
 *
 * ### What it is
 *
 * A figure leaning forward, and the thing it is reaching for just beyond its
 * fingertips. Read the other way it is a lowercase `r`, which is the point:
 * one shape doing both jobs.
 *
 * The stroke has no corner in it. It rises, bends over the top and comes back
 * down still leaning outward, so the eye follows a movement rather than
 * reading a letter with a dot next to it. The gap is the whole idea: the reach
 * has not landed, and it is still going.
 *
 * It doubles as the monogram and as a picture of the rule the system turns on.
 * A control has to be reachable from wherever the person actually is, whether
 * that is a mouse at 36px, a thumb at 44px or a remote across a room at 52px,
 * and the mark is the movement rather than the destination.
 *
 * ### Why not concentric rings
 *
 * That was the first drawing and it was wrong. Three nested rounded squares
 * read as a camera aperture, the open corner that carried the meaning vanished
 * below about 32px, and a set of rings says "target" rather than "range". A
 * letterform is also far harder for anyone else to arrive at by accident.
 *
 * ### Built from the system's own geometry
 *
 * The stroke weight is the icon stroke used everywhere else and the caps are
 * round, because every other line in the system is round. The curve is a
 * single cubic rather than an arc joined to a straight run: a join, however
 * smooth, leaves a flat spot that reads as a shoulder.
 *
 * ### Colour
 *
 * `currentColor` throughout. The mark inherits, so it is correct on any
 * surface in either theme without a second file, and a caller who wants it in
 * the accent colour writes `text-accent`.
 */

export interface ReachMarkProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /**
   * Tightens the gap and enlarges the target for small sizes. Below about
   * 20px the space between the arm and the dot closes up optically, and the
   * mark stops reading as two things.
   */
  compact?: boolean;
  /** Names the mark where it is the only thing identifying the product. */
  title?: string;
}

export function ReachMark({
  compact = false,
  title,
  className,
  ...props
}: ReachMarkProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.6}
      strokeLinecap="round"
      // Decorative unless the caller names it. A logo beside a wordmark is
      // decoration; the same logo alone in a header is the product's name.
      {...(title === undefined ? { 'aria-hidden': true } : { role: 'img' })}
      className={cn('size-6 shrink-0', className)}
      {...props}
    >
      {title === undefined ? null : <title>{title}</title>}

      {/* One stroke. It leaves the ground vertically, bends over the top, and
          comes back down leaning forward, which is a figure reaching as much
          as it is the letter. There is no corner in it: an `r` with a sharp
          shoulder is a letter, and this has to be a movement. */}
      <path d={compact ? 'M6 20 V13.2 C6 8.4 9.8 5 13.6 6' : 'M6 20 V13 C6 8 10 4.6 14.2 6.2'} />

      {/* The target, on the line the curve was travelling along when it ran
          out. The gap is the reach. */}
      <circle
        cx={compact ? 17.4 : 18.5}
        cy={compact ? 7.4 : 7.8}
        r={compact ? 2.1 : 1.9}
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

export interface ReachWordmarkProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  title?: string;
}

/**
 * The word, set in the system's own typeface.
 *
 * Lowercase, because the product is a toolkit rather than an institution, and
 * because the round shoulders of the `r`, `e` and `a` echo the mark's corners.
 * Tracking is pulled in slightly so the word reads as one object next to the
 * mark rather than as a caption under it.
 */
export function ReachWordmark({ title, className, ...props }: ReachWordmarkProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 132 32"
      fill="currentColor"
      {...(title === undefined ? { 'aria-hidden': true } : { role: 'img' })}
      className={cn('h-6 w-auto', className)}
      {...props}
    >
      {title === undefined ? null : <title>{title}</title>}
      <text
        x="0"
        y="24"
        fontFamily="InterVariable, Inter, ui-sans-serif, system-ui, sans-serif"
        fontSize="26"
        fontWeight="600"
        letterSpacing="-0.9"
      >
        reach
      </text>
    </svg>
  );
}

export interface ReachLogoProps {
  /** `full` is the mark and the word. `mark` is the mark on its own. */
  variant?: 'full' | 'mark';
  /** Adds the subtitle that says what it is. */
  showSubtitle?: boolean;
  compact?: boolean;
  className?: string;
}

/**
 * The lockup.
 *
 * The gap between mark and word is one quarter of the mark's height, the same
 * relationship a button keeps between its icon and its label. Clear space
 * around the lockup is half the mark's height on every side, and the space to
 * the right of the target must never be crowded: the room in front of the dot
 * is what makes it a reach rather than a full stop.
 */
export function ReachLogo({
  variant = 'full',
  showSubtitle = false,
  compact = false,
  className,
}: ReachLogoProps): JSX.Element {
  if (variant === 'mark') {
    return <ReachMark compact={compact} title="Reach UI" className={cn('size-8', className)} />;
  }

  return (
    <span className={cn('inline-flex items-center gap-2 text-fg', className)}>
      <ReachMark compact={compact} className="size-8" />
      <span className="flex flex-col leading-none">
        <ReachWordmark title="Reach UI" className="h-6" />
        {showSubtitle ? (
          <span className="mt-1 text-2xs font-medium tracking-[0.18em] text-fg-subtle uppercase">
            Design system
          </span>
        ) : null}
      </span>
    </span>
  );
}
