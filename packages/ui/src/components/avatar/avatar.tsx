'use client';

import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cva, type VariantProps } from 'class-variance-authority';
import { UserRound } from 'lucide-react';
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { safeImageUrl } from '../../lib/safe-url';

// Not `overflow-hidden`: the status dot sits across the edge. The image and
// the fallback take the radius themselves instead.
const avatar = cva('relative flex shrink-0 select-none', {
  variants: {
    // Initials are 36% of the diameter, the same optical weight at every size.
    size: {
      xs: 'size-5 text-[0.4375rem]',
      sm: 'size-6 text-[0.5625rem]',
      md: 'size-8 text-[0.75rem]',
      lg: 'size-10 text-[0.875rem]',
      xl: 'size-12 text-[1.0625rem]',
      '2xl': 'size-16 text-[1.4375rem]',
      '3xl': 'size-20 text-[1.8125rem]',
    },
    /**
     * The wash behind the initials. `auto` picks one from the name, so the same
     * person is the same colour on every screen and a list of twenty people is
     * not twenty identical grey discs. Only ever decoration — the initials and
     * the name beside them carry who it is.
     */
    tone: {
      auto: '',
      neutral: 'bg-surface-active text-fg-muted',
      accent: 'bg-accent-subtle text-accent-fg',
      info: 'bg-info-subtle text-info-fg',
      success: 'bg-success-subtle text-success-fg',
      warning: 'bg-warning-subtle text-warning-fg',
      danger: 'bg-danger-subtle text-danger-fg',
    },
    /**
     * A face is round; a wordmark is not.
     *
     * `circle` crops to a disc, which is right for a person and destroys a
     * logo — half of one is outside the circle. Added because the alternative
     * was every screen showing a company mark reaching for a bare `<img>`,
     * and three of them had already done it, each with its own idea of the
     * border and the padding.
     */
    shape: {
      circle: 'rounded-full',
      // 28% of the side, so a 32px square and a 64px square look like the
      // same shape at two sizes.
      rounded: 'rounded-[28%]',
    },
  },
  defaultVariants: { size: 'md', tone: 'auto', shape: 'circle' },
});

const statusTone = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  neutral: 'bg-fg-subtle',
} as const;

type AvatarTone = Exclude<NonNullable<VariantProps<typeof avatar>['tone']>, 'auto' | 'neutral'>;
const hashTones: readonly AvatarTone[] = ['accent', 'info', 'success', 'warning', 'danger'];

/**
 * A stable tone for a name: the same string always lands on the same colour,
 * with no table to keep and nothing stored.
 */
export function avatarToneOf(name: string): AvatarTone {
  let hash = 7;
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return hashTones[hash % hashTones.length] ?? 'accent';
}

export interface AvatarProps
  extends ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>, VariantProps<typeof avatar> {
  src?: string | undefined;
  /**
   * How the image sits in the frame.
   *
   * `cover` fills and crops, which is what a photograph of a person wants.
   * `contain` fits the whole image inside with a little breathing room, which
   * is the only correct treatment for a mark somebody designed — cropping a
   * logo is not a rendering choice, it is a different logo.
   */
  fit?: 'cover' | 'contain';
  /**
   * Used for the image alt text and to derive initials. Pass the person's
   * display name, not an id.
   */
  name: string;
  /** Overrides the derived initials: other text, or an icon for a team or a bot. */
  fallback?: ReactNode;
  /** A presence dot on the lower edge. Colour only, so pair it with `statusLabel`. */
  status?: keyof typeof statusTone;
  /** Says what the dot means, "Online", for a screen reader. */
  statusLabel?: string;
}

/** Initials from a display name, capped at two glyphs. Empty for no name. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * A person, or anything else that is represented by one small image.
 *
 * The fallback is initials rather than a generic silhouette: in a directory of
 * 900 people, nine hundred identical silhouettes carry no information. A
 * company works the same way — `name` is its display name, so a customer with
 * no logo yet gets its own initial rather than a grey square.
 */
export function Avatar({
  className,
  size,
  shape,
  tone,
  fit = 'cover',
  src,
  name,
  fallback,
  status,
  statusLabel,
  ...props
}: AvatarProps): JSX.Element {
  // A profile picture usually arrives from an upload or an HR import, so it is
  // outside data reaching `src`. An unrecognised scheme falls back to initials,
  // which is a perfectly good avatar. See `safeImageUrl` for what that stops.
  const safeSrc = safeImageUrl(src);
  const initials = initialsOf(name);
  // A designed mark sits on a neutral ground: a wash behind a transparent logo
  // recolours somebody else's brand. Nobody-yet gets the neutral silhouette.
  const requested =
    tone ?? (fit === 'contain' || (initials === '' && fallback == null) ? 'neutral' : 'auto');
  const resolvedTone = requested === 'auto' ? avatarToneOf(name) : requested;

  return (
    <AvatarPrimitive.Root
      className={cn(avatar({ size, shape, tone: resolvedTone }), className)}
      {...props}
    >
      {safeSrc === undefined ? null : (
        <AvatarPrimitive.Image
          src={safeSrc}
          alt={name}
          // Radix only mounts the image once it has decoded, so this animates
          // on arrival rather than on a half-painted image.
          className={cn(
            'size-full animate-fade-in rounded-[inherit]',
            // A mark is almost always drawn for a white page, so in the dark
            // theme it keeps one under it: a dark wordmark on a dark ground
            // is not there at all. The light theme's neutral ground reads.
            fit === 'contain' ? 'object-contain p-1 dark:bg-(--reach-neutral-0)' : 'object-cover',
          )}
        />
      )}
      <AvatarPrimitive.Fallback
        // Wait a beat before showing initials, so a cached image does not
        // produce a visible initials-then-photo flash. With no image there is
        // nothing to wait for, and no delay at all — not even 0ms, which is a
        // timer — is what puts the initials in the server's HTML.
        {...(safeSrc === undefined ? {} : { delayMs: 120 })}
        className="flex size-full items-center justify-center overflow-hidden rounded-[inherit] leading-none font-bold [&_svg]:size-1/2"
      >
        {fallback ?? (initials === '' ? <UserRound aria-hidden /> : initials)}
      </AvatarPrimitive.Fallback>
      {status ? (
        <span
          className={cn(
            'absolute -right-px -bottom-px size-[28%] min-h-2 min-w-2 rounded-full ring-2 ring-surface',
            statusTone[status],
          )}
        >
          {statusLabel ? <span className="sr-only">{statusLabel}</span> : null}
        </span>
      ) : null}
    </AvatarPrimitive.Root>
  );
}

export interface AvatarGroupProps extends ComponentPropsWithoutRef<'div'> {
  /** Show at most this many avatars, then a `+N` counter. */
  max?: number;
  /** Total participant count, when more exist than were rendered. */
  total?: number;
  /** The size of the avatars inside, so the `+N` counter matches them. */
  size?: AvatarProps['size'];
}

/**
 * Overlapping stack, for "who is on this approval chain".
 *
 * The group is one list to assistive tech, not N unlabelled images.
 */
export function AvatarGroup({
  className,
  max = 4,
  total,
  size = 'md',
  children,
  ...props
}: AvatarGroupProps): JSX.Element {
  const items = Array.isArray(children) ? children : [children];
  const visible = items.slice(0, max);
  const overflow = (total ?? items.length) - visible.length;

  return (
    <div
      role="group"
      className={cn('flex items-center -space-x-2 [&>*]:ring-2 [&>*]:ring-surface', className)}
      {...props}
    >
      {visible}
      {overflow > 0 ? (
        <span
          className={cn(
            avatar({ size, tone: 'neutral' }),
            'grid place-items-center rounded-full font-semibold text-fg',
          )}
        >
          <span aria-hidden="true">+{overflow}</span>
          <span className="sr-only">and {overflow} more</span>
        </span>
      ) : null}
    </div>
  );
}
