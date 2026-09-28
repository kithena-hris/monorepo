import { Badge, Button, Tooltip } from '@reach/ui';
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
    <Badge tone="attention" size={size}>
      {count === undefined ? 'Missing' : `${String(count)} missing`}
    </Badge>
  );
}

/**
 * How many are missing, as a way to them: hovering or focusing it names them,
 * pressing it goes to the first. The count alone says there is work; this
 * says which, and takes you there.
 */
export function MissingJump({
  labels,
  onJump,
}: {
  readonly labels: readonly string[];
  readonly onJump: () => void;
}): JSX.Element {
  const named = labels.join(', ');
  return (
    <Tooltip content={`Missing: ${named}`}>
      <Button
        size="sm"
        variant="ghost"
        className="h-auto p-0"
        aria-label={`${String(labels.length)} missing: ${named}. Go to the first`}
        onClick={onJump}
      >
        <MissingMark count={labels.length} size="md" />
      </Button>
    </Tooltip>
  );
}
