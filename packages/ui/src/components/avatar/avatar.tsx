'use client';

import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { safeImageUrl } from '../../lib/safe-url';

const avatar = cva(
  'relative flex shrink-0 overflow-hidden rounded-full bg-surface-sunken ring-1 ring-border select-none',
  {
    variants: {
      size: {
        xs: 'size-5 text-2xs',
        sm: 'size-6 text-2xs',
        md: 'size-8 text-xs',
        lg: 'size-10 text-sm',
        xl: 'size-14 text-md',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export interface AvatarProps
  extends ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>, VariantProps<typeof avatar> {
  src?: string | undefined;
  /**
   * Used for the image alt text and to derive initials. Pass the person's
   * display name, not an id.
   */
  name: string;
  /** Overrides the derived initials. */
  fallback?: ReactNode;
}

/** Initials from a display name, capped at two glyphs. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * A person.
 *
 * The fallback is initials rather than a generic silhouette: in a directory of
 * 900 people, nine hundred identical silhouettes carry no information.
 */
export function Avatar({
  className,
  size,
  src,
  name,
  fallback,
  ...props
}: AvatarProps): JSX.Element {
  // A profile picture usually arrives from an upload or an HR import, so it is
  // outside data reaching `src`. An unrecognised scheme falls back to initials,
  // which is a perfectly good avatar. See `safeImageUrl` for what that stops.
  const safeSrc = safeImageUrl(src);

  return (
    <AvatarPrimitive.Root className={cn(avatar({ size }), className)} {...props}>
      {safeSrc === undefined ? null : (
        <AvatarPrimitive.Image
          src={safeSrc}
          alt={name}
          // Radix only mounts the image once it has decoded, so this animates
          // on arrival rather than on a half-painted image.
          className="size-full object-cover animate-fade-in"
        />
      )}
      <AvatarPrimitive.Fallback
        // Wait a beat before showing initials, so a cached image does not
        // produce a visible initials-then-photo flash.
        delayMs={safeSrc === undefined ? 0 : 120}
        className="flex size-full items-center justify-center font-medium text-fg-muted"
      >
        {fallback ?? initialsOf(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

export interface AvatarGroupProps extends ComponentPropsWithoutRef<'div'> {
  /** Show at most this many avatars, then a `+N` counter. */
  max?: number;
  /** Total participant count, when more exist than were rendered. */
  total?: number;
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
        <span className="grid size-8 place-items-center rounded-full bg-surface-sunken text-2xs font-medium text-fg-muted ring-1 ring-border">
          <span aria-hidden="true">+{overflow}</span>
          <span className="sr-only">and {overflow} more</span>
        </span>
      ) : null}
    </div>
  );
}
