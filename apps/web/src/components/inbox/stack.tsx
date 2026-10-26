'use client';

import { Badge, ListItem, icons } from '@reach/ui';
import type { JSX, ReactNode } from 'react';

import type { Shown } from '../../lib/inbox/model';
import { moduleName } from '../../lib/inbox/plain';
import { iconOf } from './format';
import { t } from '../../lib/t';

/**
 * Three or more of one kind, as one line in the feed: the first of them, how
 * many more there are like it, and the rest under it once opened. A stack is
 * a way to read a long list, never a place work hides: the count is on the line.
 */
export function StackRow({
  items,
  open,
  onToggle,
  children,
}: {
  readonly items: readonly Shown[];
  readonly open: boolean;
  readonly onToggle: () => void;
  /** Every item in the stack, as the list draws it. */
  readonly children: readonly ReactNode[];
}): JSX.Element {
  const first = items[0];
  if (first === undefined) return <></>;
  const Icon = iconOf(first.icon);
  const where =
    first.area === null
      ? moduleName(first.module)
      : t('components.inbox.stack.where', '{{module}} › {{area}}', {
          module: moduleName(first.module),
          area: first.area,
        });
  return (
    <>
      <ListItem
        asChild
        icon={<Icon aria-hidden />}
        description={t(
          'components.inbox.stack.more_like_this',
          { one: 'and {{count}} more like it', other: 'and {{count}} more like it' },
          { count: items.length - 1 },
        )}
        supporting={
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge size="sm" variant="outline">
              {where}
            </Badge>
          </span>
        }
        trailing={
          <span className="flex items-center gap-1.5 text-fg-muted">
            <Badge size="sm" tone="neutral">
              {String(items.length)}
            </Badge>
            {open ? <icons.collapse aria-hidden /> : <icons.expand aria-hidden />}
          </span>
        }
      >
        <button type="button" aria-expanded={open} onClick={onToggle}>
          {first.title}
        </button>
      </ListItem>
      {open ? children : null}
    </>
  );
}
