'use client';

import { Avatar, Badge, Checkbox, ListItem, type SwipeAction } from '@reach/ui';
import type { JSX, ReactNode } from 'react';

import type { Shown } from '../../lib/inbox/model';
import { moduleName } from '../../lib/inbox/plain';
import { since } from '../since';
import { dueOf, iconOf } from './format';
import { t } from '../../lib/t';

/**
 * One row of the Inbox (A1's anatomy, M:A1): the face of the person it is
 * about, with what kind of thing it is across its edge, or the kind's tile
 * when nobody is; the title, what it is, then where it lives, when it is due
 * and where it stands, and how long ago on the right. The same row in the
 * list, the bell and Home's To do card.
 */

/** The badges under a row: module › area, due, status, outcome, replies, unread. */
export function RowBadges({
  item,
  now,
  zone,
  fresh = false,
}: {
  readonly item: Shown;
  readonly now: string;
  readonly zone: string;
  /** In the feed's New section, which already says so. */
  readonly fresh?: boolean;
}): JSX.Element {
  const due = item.due === null ? null : dueOf(item.due, item.dueVerb, now, zone);
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {item.unread && !fresh ? (
        <Badge size="sm" tone="accent" variant="solid">
          {t('components.inbox.rows.new', 'New')}
        </Badge>
      ) : null}
      {fresh && item.lane === 'task' ? (
        <Badge size="sm" tone="accent">
          {t('components.inbox.rows.needs_you', 'Needs you')}
        </Badge>
      ) : null}
      {/* Where it lives, in words rather than one more box beside the ones that matter. */}
      <span className="text-xs text-fg-muted">
        {item.area === null
          ? moduleName(item.module)
          : t('components.inbox.rows.text', '{{moduleName}} › {{area}}', {
              moduleName: moduleName(item.module),
              area: item.area,
            })}
      </span>
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
          {t('components.inbox.rows.for', 'For {{role}}', { role: item.team.role.toLowerCase() })}
        </Badge>
      ) : (
        <Badge size="sm" tone="info" dot>
          {item.team.mine
            ? t('components.inbox.rows.you_are_on_it', 'You are on it')
            : item.team.takenBy.name == null
              ? t('components.inbox.rows.somebody_is_on_it', 'Somebody is on it')
              : t('components.inbox.rows.is_on_it', '{{value}} is on it', {
                  value: item.team.takenBy.name,
                })}
        </Badge>
      )}
      {item.outcome === null ? null : (
        <Badge size="sm" tone={item.outcome.tone}>
          {item.outcome.label}
        </Badge>
      )}
      {item.replies > 0 ? (
        <Badge size="sm" tone="accent">
          {t(
            'components.inbox.rows.replies',
            { one: '{{count}} reply', other: '{{count}} replies' },
            {
              count: item.replies,
            },
          )}
        </Badge>
      ) : null}
      {item.snoozedUntil === null ? null : (
        <Badge size="sm" variant="outline">
          {t('components.inbox.rows.snoozed', 'Snoozed')}
        </Badge>
      )}
    </span>
  );
}

/**
 * Who it is about, by face, so a list of requests reads as the people asking:
 * their photo where People lets the reader see it, their initials otherwise,
 * and the kind across the edge. Kithena itself, or the reader, is the kind's
 * tile.
 */
function face(item: Shown): { readonly leading?: ReactNode; readonly icon?: ReactNode } {
  const Icon = iconOf(item.icon);
  if (item.from?.name != null && item.from.name !== 'You') {
    return {
      leading: (
        <Avatar
          name={item.from.name}
          src={item.photo ?? undefined}
          size="lg"
          badge={<Icon aria-hidden />}
        />
      ),
    };
  }
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
  fresh = false,
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
  /** In the feed's New section: no New badge, which the section already says. */
  readonly fresh?: boolean;
}): JSX.Element {
  const age = item.count === null ? since(item.at, now) : String(item.count);
  const badges = <RowBadges item={item} now={now} zone={zone} fresh={fresh} />;
  const title = item.title;
  if (selecting) {
    return (
      <ListItem
        leading={
          <Checkbox
            aria-label={t('components.inbox.rows.select', 'Select {{title}}', {
              title: item.title,
            })}
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
