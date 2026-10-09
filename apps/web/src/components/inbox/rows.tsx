'use client';

import { Avatar, Badge, Checkbox, ListItem, type SwipeAction } from '@reach/ui';
import type { JSX, ReactNode } from 'react';

import { moduleName, type Shown } from '../../lib/inbox/model';
import { since } from '../since';
import { dueOf, iconOf } from './format';

/**
 * One row of the Inbox (A1's anatomy, M:A1): the tile or the sender's face,
 * the title, what it is, then where it lives, when it is due and where it
 * stands, and how long ago on the right. The same row in the list, the bell
 * and Home's To do card.
 */

/** The badges under a row: module › area, due, status, outcome, replies, unread. */
export function RowBadges({
  item,
  now,
  zone,
}: {
  readonly item: Shown;
  readonly now: string;
  readonly zone: string;
}): JSX.Element {
  const due = item.due === null ? null : dueOf(item.due, item.dueVerb, now, zone);
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {item.unread ? (
        <Badge size="sm" tone="accent" variant="solid">
          New
        </Badge>
      ) : null}
      <Badge size="sm" variant="outline">
        {item.area === null ? moduleName(item.module) : `${moduleName(item.module)} › ${item.area}`}
      </Badge>
      {due === null || item.lane !== 'task' ? null : (
        <Badge size="sm" tone={due.tone}>
          {due.label}
        </Badge>
      )}
      {item.lane === 'request' && due !== null ? <Badge size="sm">{due.label}</Badge> : null}
      {item.status === null ? null : (
        <Badge size="sm" tone={item.status.tone} dot>
          {item.status.label}
        </Badge>
      )}
      {item.team === null ? null : item.team.takenBy === null ? (
        <Badge size="sm" tone="warning" dot>
          {`For ${item.team.role.toLowerCase()}`}
        </Badge>
      ) : (
        <Badge size="sm" tone="info" dot>
          {item.team.mine ? 'You are on it' : `${item.team.takenBy.name ?? 'Somebody'} is on it`}
        </Badge>
      )}
      {item.outcome === null ? null : (
        <Badge size="sm" tone={item.outcome.tone}>
          {item.outcome.label}
        </Badge>
      )}
      {item.replies > 0 ? (
        <Badge size="sm" tone="accent">
          {`${String(item.replies)} repl${item.replies === 1 ? 'y' : 'ies'}`}
        </Badge>
      ) : null}
      {item.snoozedUntil === null ? null : (
        <Badge size="sm" variant="outline">
          Snoozed
        </Badge>
      )}
    </span>
  );
}

/** The sender's face for news from a person; the kind's tile otherwise. */
function face(item: Shown): { readonly leading?: ReactNode; readonly icon?: ReactNode } {
  if (item.lane === 'update' && item.from?.name != null && item.from.name !== 'You') {
    return { leading: <Avatar name={item.from.name} size="md" /> };
  }
  const Icon = iconOf(item.icon);
  return { icon: <Icon aria-hidden /> };
}

export function InboxRow({
  item,
  now,
  zone,
  href,
  selected = false,
  selecting = false,
  checked = false,
  onCheck,
  swipe,
  onOpen,
}: {
  readonly item: Shown;
  readonly now: string;
  readonly zone: string;
  readonly href: string;
  readonly selected?: boolean;
  /** Bulk selection (D5, G3): the row is a checkbox, not a link. */
  readonly selecting?: boolean;
  readonly checked?: boolean;
  readonly onCheck?: (on: boolean) => void;
  readonly swipe?: readonly SwipeAction[];
  readonly onOpen?: () => void;
}): JSX.Element {
  const age = item.count === null ? since(item.at, now) : String(item.count);
  const badges = <RowBadges item={item} now={now} zone={zone} />;
  const title = item.title;
  if (selecting) {
    return (
      <ListItem
        leading={
          <Checkbox
            aria-label={`Select ${item.title}`}
            checked={checked}
            onCheckedChange={(on) => onCheck?.(on === true)}
          />
        }
        description={item.summary}
        supporting={badges}
        meta={age}
        selected={checked}
        disabled={item.dim}
      >
        {title}
      </ListItem>
    );
  }
  return (
    <ListItem
      asChild
      {...face(item)}
      description={item.summary}
      supporting={badges}
      meta={age}
      selected={selected}
      disabled={item.dim}
      {...(swipe === undefined ? {} : { swipeActions: swipe })}
    >
      <a
        href={href}
        aria-current={selected ? 'true' : undefined}
        onClick={(event) => {
          if (onOpen === undefined || event.metaKey || event.ctrlKey || event.shiftKey) return;
          event.preventDefault();
          onOpen();
        }}
      >
        {title}
      </a>
    </ListItem>
  );
}
