import { Badge, icons } from '@reach/ui';
import type { JSX } from 'react';

/**
 * "Missing": a required detail that is empty, or how many are.
 *
 * The word and the glyph carry it, never the colour alone. One place, so the
 * treatment is the design system's wherever a gap is marked — the profile's
 * fields and sections, its header, the overview and the directory.
 */
export function MissingMark({
  count,
  size = 'sm',
}: {
  /** How many; absent, it marks one field. */
  readonly count?: number;
  readonly size?: 'sm' | 'md';
}): JSX.Element {
  return (
    <Badge tone="warning" size={size}>
      <icons.warning aria-hidden />
      {count === undefined ? 'Missing' : `${String(count)} missing`}
    </Badge>
  );
}
