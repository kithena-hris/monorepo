import { Badge, Button, Tooltip } from '@reach/ui';
import type { JSX } from 'react';
import { t } from '../i18n';

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
      {count === undefined
        ? t('record.missing.missing', 'Missing')
        : t('record.missing.missing_2', '{{count}} missing', { count: String(count) })}
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
    <Tooltip content={t('record.missing.missing_3', 'Missing: {{named}}', { named })}>
      <Button
        size="sm"
        variant="ghost"
        className="h-auto p-0"
        aria-label={t(
          'record.missing.missing_go_to_the_first',
          '{{length}} missing: {{named}}. Go to the first',
          { length: String(labels.length), named },
        )}
        onClick={onJump}
      >
        <MissingMark count={labels.length} size="md" />
      </Button>
    </Tooltip>
  );
}
