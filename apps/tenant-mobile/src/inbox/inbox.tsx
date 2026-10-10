import {
  Avatar,
  Badge,
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  EmptyState,
  Icon,
  List,
  ListItem,
  SearchField,
  SegmentedControl,
  SegmentedControlItem,
  Text,
  useToast,
} from '@reach/ui-native';
import {
  AlarmClock,
  ArrowLeftRight,
  CircleCheck,
  Inbox as InboxGlyph,
  Settings2,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Failed, Loading, Page } from '../frame';
import { read, useSigned } from '../people/api';
import type { PeopleScreen } from '../people/routes';
import { changeInbox, useInbox } from './api';
import { HandOver } from './hand-over';
import { ago, dueOf, iconOf, moduleName, type Group, type Item, type LaneName } from './model';

/**
 * The Inbox tab (M:A1, M:C1, M:D1, M:E1, M:Z1): To do, Updates, Requests and
 * Done under one segmented control, the task count on the tab. Rows open the
 * item on its own page; updates swipe to read or tidy, and a long press offers
 * the same.
 */

const LABEL: Readonly<Record<LaneName, string>> = {
  todo: 'To do',
  updates: 'Updates',
  requests: 'Requests',
  done: 'Done',
};

/** The badges under a row: where it lives, when it is due, where it stands. */
export function RowBadges({
  item,
  now,
  zone,
}: {
  item: Item;
  now: string;
  zone: string;
}): React.JSX.Element {
  const due = item.lane === 'task' || item.lane === 'request' ? dueOf(item, now, zone) : null;
  return (
    <View className="mt-1 flex-row flex-wrap gap-1.5">
      {item.unread ? (
        <Badge size="sm" tone="accent" variant="solid">
          New
        </Badge>
      ) : null}
      <Badge size="sm" variant="outline">
        {item.area === null ? moduleName(item.module) : `${moduleName(item.module)} › ${item.area}`}
      </Badge>
      {due === null ? null : (
        <Badge size="sm" tone={due.tone}>
          {due.label}
        </Badge>
      )}
      {item.status === null ? null : (
        <Badge size="sm" tone={item.status.tone} dot>
          {item.status.label}
        </Badge>
      )}
      {item.team === null ? null : (
        <Badge size="sm" tone={item.team.takenBy === null ? 'warning' : 'info'} dot>
          {item.team.takenBy === null
            ? `For ${item.team.role.toLowerCase()}`
            : item.team.mine
              ? 'You are on it'
              : `${item.team.takenBy.name ?? 'Somebody'} is on it`}
        </Badge>
      )}
      {item.outcome === null ? null : (
        <Badge size="sm" tone={item.outcome.tone}>
          {item.outcome.label}
        </Badge>
      )}
      {item.replies > 0 ? (
        <Badge
          size="sm"
          tone="accent"
        >{`${String(item.replies)} repl${item.replies === 1 ? 'y' : 'ies'}`}</Badge>
      ) : null}
    </View>
  );
}

export function Inbox({ navigation }: PeopleScreen<'Inbox'>): React.JSX.Element {
  const signed = useSigned();
  const { toast } = useToast();
  const { inbox, error, reload } = useInbox();
  const [lane, setLane] = useState<LaneName>('todo');
  const [q, setQ] = useState('');
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [handing, setHanding] = useState(false);
  const [approves, setApproves] = useState(false);
  useEffect(() => {
    let live = true;
    void read<{ approves: boolean }>(signed, 'TimeOffViewer', {}, 'timeoff').then((a) => {
      if (live && a.ok) setApproves(a.data.approves);
    });
    return () => {
      live = false;
    };
  }, [signed]);

  const change = (c: Parameters<typeof changeInbox>[1], said?: string): void => {
    void changeInbox(signed, c).then((refused) => {
      if (refused !== null)
        toast({ title: 'That did not work', description: refused, tone: 'danger' });
      else if (said !== undefined) toast({ title: said, tone: 'success' });
    });
  };
  const open = (item: Item): void => {
    if (item.unread) change({ kind: 'read', ids: [item.id], read: true });
    navigation.navigate('InboxItem', { id: item.id });
  };

  const trailing = (
    <View className="flex-row gap-1">
      {approves ? (
        <Button
          variant="ghost"
          size="sm"
          accessibilityLabel="Hand over"
          startIcon={<Icon icon={ArrowLeftRight} />}
          onPress={() => {
            setHanding(true);
          }}
        />
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        accessibilityLabel="Notification settings"
        startIcon={<Icon icon={Settings2} />}
        onPress={() => {
          navigation.navigate('Notifications');
        }}
      />
    </View>
  );

  if (inbox === null) {
    return (
      <Page large="Inbox" trailing={trailing}>
        {error === null ? (
          <Loading label="Loading your Inbox" />
        ) : (
          <Failed message={error} onRetry={reload} />
        )}
      </Page>
    );
  }
  const { now, zone, counts } = inbox;
  const words = q.trim().toLowerCase();
  const groups: readonly Group[] = inbox.lanes[lane]
    .map((g) => ({
      label: g.label,
      items: g.items.filter(
        (i) =>
          words === '' ||
          [i.title, i.summary, i.from?.name].some((t) => (t ?? '').toLowerCase().includes(words)),
      ),
    }))
    .filter((g) => g.items.length > 0);

  const row = (item: Item): React.JSX.Element => {
    const face =
      item.lane === 'update' && item.from?.name != null && item.from.name !== 'You'
        ? { leading: <Avatar name={item.from.name} size={40} /> }
        : { icon: iconOf(item.icon) };
    const listed = (
      <ListItem
        key={item.id}
        {...face}
        description={item.summary ?? undefined}
        supporting={<RowBadges item={item} now={now} zone={zone} />}
        meta={item.count === null ? ago(item.at, now) : String(item.count)}
        disabled={item.dim}
        onPress={() => {
          open(item);
        }}
        {...(item.lane === 'update'
          ? {
              swipeActions: [
                {
                  label: item.unread ? 'Read' : 'Unread',
                  tone: 'accent' as const,
                  onSelect: () => {
                    change({ kind: 'read', ids: [item.id], read: item.unread });
                  },
                },
                {
                  label: 'Done',
                  onSelect: () => {
                    change({ kind: 'done', ids: [item.id] }, 'Moved to Done');
                  },
                },
              ],
            }
          : {})}
      >
        {item.title}
      </ListItem>
    );
    if (item.lane !== 'update') return listed;
    return (
      <ContextMenu key={item.id}>
        <ContextMenuTrigger>{listed}</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            onSelect={() => {
              change({ kind: 'read', ids: [item.id], read: item.unread });
            }}
          >
            {item.unread ? 'Mark read' : 'Mark unread'}
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              change(
                { kind: 'mute', mute: { what: item.kind, inbox: false, email: true, phone: true } },
                'Muted',
              );
            }}
          >
            Mute updates like this
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              change({ kind: 'done', ids: [item.id] }, 'Moved to Done');
            }}
          >
            Move to Done
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  return (
    <Page large="Inbox" trailing={trailing}>
      <SegmentedControl
        value={lane}
        onValueChange={(v) => {
          if (v === 'todo' || v === 'updates' || v === 'requests' || v === 'done') setLane(v);
        }}
        size="sm"
        fullWidth
        accessibilityLabel="Show"
      >
        <SegmentedControlItem value="todo">{`To do ${String(counts.todo)}`}</SegmentedControlItem>
        <SegmentedControlItem value="updates">{`Updates ${String(counts.updates)}`}</SegmentedControlItem>
        <SegmentedControlItem value="requests">Requests</SegmentedControlItem>
        <SegmentedControlItem value="done">Done</SegmentedControlItem>
      </SegmentedControl>
      {lane === 'done' || lane === 'updates' ? (
        <SearchField value={q} onValueChange={setQ} label={`Search ${LABEL[lane].toLowerCase()}`} />
      ) : null}
      {lane === 'updates' && counts.updates > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          startIcon={<Icon icon={CircleCheck} />}
          onPress={() => {
            change({ kind: 'readAll' }, 'All read');
          }}
        >
          Mark all read
        </Button>
      ) : null}
      {inbox.unanswered.length === 0 ? null : (
        <Text variant="footnote" tone="muted">
          {`${inbox.unanswered.map(moduleName).join(' and ')} did not answer just now; its items will be back.`}
        </Text>
      )}
      {groups.length === 0 && (lane !== 'todo' || inbox.snoozed.length === 0) ? (
        lane === 'todo' && words === '' ? (
          <EmptyState
            icon={CircleCheck}
            tone="accent"
            title="Nothing needs you"
            description={
              counts.updates > 0
                ? `New tasks appear here and on the tab. You have ${String(counts.updates)} unread update${counts.updates === 1 ? '' : 's'}.`
                : 'New tasks appear here and on the tab.'
            }
            {...(counts.updates > 0
              ? {
                  action: (
                    <Button
                      onPress={() => {
                        setLane('updates');
                      }}
                    >
                      See updates
                    </Button>
                  ),
                }
              : {})}
          />
        ) : (
          <EmptyState
            icon={InboxGlyph}
            title={words === '' ? `Nothing in ${LABEL[lane]}` : 'Nothing matches'}
            description={
              lane === 'requests'
                ? 'Decided requests move to Done, and you get an update.'
                : lane === 'done'
                  ? 'Finished tasks, decided requests and older updates stay here.'
                  : 'News from every module lands here.'
            }
          />
        )
      ) : (
        groups.map((g) => (
          <View key={g.label ?? 'all'} className="gap-2">
            {g.label === null ? null : (
              <Text variant="footnote" weight="semibold" tone="muted">
                {g.label.toUpperCase()}
              </Text>
            )}
            <List>{g.items.map(row)}</List>
          </View>
        ))
      )}
      {lane === 'requests' && groups.length > 0 ? (
        <Text variant="footnote" tone="muted">
          Decided requests move to Done, and you get an update.
        </Text>
      ) : null}
      {lane === 'todo' && inbox.snoozed.length > 0 ? (
        <View className="gap-2">
          <Button
            startIcon={<Icon icon={AlarmClock} />}
            onPress={() => {
              setShowSnoozed((s) => !s);
            }}
          >
            {`${String(inbox.snoozed.length)} snoozed`}
          </Button>
          {showSnoozed ? <List>{inbox.snoozed.map(row)}</List> : null}
        </View>
      ) : null}
      {handing ? (
        <HandOver
          onClose={() => {
            setHanding(false);
          }}
        />
      ) : null}
    </Page>
  );
}
