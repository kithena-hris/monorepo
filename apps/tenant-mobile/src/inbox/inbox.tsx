import {
  Alert,
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
  SlidersHorizontal,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Failed, Heading, Loading, Page } from '../frame';
import { read, useSigned } from '../people/api';
import type { PeopleScreen } from '../people/routes';
import { changeInbox, useInbox } from './api';
import { tasksOf, todoBrief, updatesBrief, updatesOf } from './brief';
import { HandOver } from './hand-over';
import { d, str } from './item';
import { TaskCard, useInboxWrite } from './task-card';
import { ago, iconOf, moduleName, type Group, type Item, type LaneName } from './model';
import { t as tr } from '../i18n';

/**
 * The Inbox tab (M:A1, M:C1, M:D1, M:E1, M:Z1): To do, Updates, Requests and
 * Done under one segmented control, the task count on the tab. Rows open the
 * item on its own page; updates swipe to read or tidy, and a long press offers
 * the same.
 */

const LABEL = (): Readonly<Record<LaneName, string>> => ({
  todo: tr('inbox.inbox.to_do', 'To do'),
  updates: tr('inbox.inbox.updates_2', 'Updates'),
  requests: tr('inbox.inbox.requests_2', 'Requests'),
  done: tr('inbox.inbox.done', 'Done'),
});

export function Inbox({ navigation }: PeopleScreen<'Inbox'>): React.JSX.Element {
  const signed = useSigned();
  const { toast } = useToast();
  const { inbox, error, reload } = useInbox();
  const [lane, setLane] = useState<LaneName>('todo');
  const [q, setQ] = useState('');
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [handing, setHanding] = useState(false);
  const [approves, setApproves] = useState(false);
  const { write, busy } = useInboxWrite();
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
        toast({
          title: tr('inbox.inbox.that_did_not_work', 'That did not work'),
          description: refused,
          tone: 'danger',
        });
      else if (said !== undefined) toast({ title: said, tone: 'success' });
    });
  };
  const open = (item: Item): void => {
    if (item.unread) change({ kind: 'read', ids: [item.id], read: true });
    navigation.navigate('InboxItem', { id: item.id });
  };

  // A manager hands over in words (I5); everybody else has the settings glyph (I1).
  const trailing = (
    <View className="flex-row items-center gap-1">
      {approves ? (
        <Button
          variant="ghost"
          size="sm"
          startIcon={<Icon icon={ArrowLeftRight} />}
          onPress={() => {
            setHanding(true);
          }}
        >
          {tr('inbox.inbox.hand_over', 'Hand over')}
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        accessibilityLabel={tr('inbox.inbox.notification_settings', 'Notification settings')}
        startIcon={<Icon icon={SlidersHorizontal} />}
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
          <Loading label={tr('inbox.inbox.loading_your_inbox', 'Loading your Inbox')} />
        ) : (
          <Failed message={error} onRetry={reload} />
        )}
      </Page>
    );
  }
  const { now, zone, counts } = inbox;
  const words = q.trim().toLowerCase();
  const matches = (i: Item): boolean =>
    words === '' ||
    [i.title, i.summary, i.from?.name].some((t) => (t ?? '').toLowerCase().includes(words));
  const groups: readonly Group[] = inbox.lanes[lane]
    .map((g) => ({ label: g.label, items: g.items.filter(matches) }))
    .filter((g) => g.items.length > 0);
  const tasks = tasksOf(inbox);
  const updates = updatesOf(inbox);

  /** An update (I1, I4): unread dot, who it is from, swipe or long-press to tidy. */
  const updateRow = (item: Item): React.JSX.Element => (
    <ContextMenu key={item.id}>
      <ContextMenuTrigger>
        <ListItem
          unread={item.unread}
          {...(item.from?.name != null && item.from.name !== 'You'
            ? { leading: <Avatar name={item.from.name} size={40} /> }
            : { icon: iconOf(item.icon) })}
          {...(item.summary === null ? {} : { description: item.summary })}
          meta={ago(item.at, now)}
          onPress={() => {
            open(item);
          }}
          swipeActions={[
            {
              label: item.unread
                ? tr('inbox.inbox.read', 'Read')
                : tr('inbox.inbox.unread', 'Unread'),
              tone: 'accent' as const,
              onSelect: () => {
                change({ kind: 'read', ids: [item.id], read: item.unread });
              },
            },
            {
              label: tr('inbox.inbox.done', 'Done'),
              onSelect: () => {
                change(
                  { kind: 'done', ids: [item.id] },
                  tr('inbox.inbox.moved_to_done', 'Moved to Done'),
                );
              },
            },
          ]}
        >
          {item.title}
        </ListItem>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={() => {
            change({ kind: 'read', ids: [item.id], read: item.unread });
          }}
        >
          {item.unread
            ? tr('inbox.inbox.mark_as_read', 'Mark as read')
            : tr('inbox.inbox.mark_as_unread', 'Mark as unread')}
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            change(
              { kind: 'mute', mute: { what: item.kind, inbox: false, email: true, phone: true } },
              'Muted',
            );
          }}
        >
          {tr('inbox.inbox.mute_updates_like_this', 'Mute updates like this')}
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            change(
              { kind: 'done', ids: [item.id] },
              tr('inbox.inbox.moved_to_done', 'Moved to Done'),
            );
          }}
        >
          {tr('inbox.inbox.move_to_done', 'Move to Done')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );

  /** One of my requests (I7): who has it and since when, and a nudge once it has waited. */
  const requestRow = (item: Item): React.JSX.Element => {
    const detail = d(item);
    const nudge = (detail['nudge'] ?? null) as { from: string; used: boolean } | null;
    const can = nudge !== null && !nudge.used && now >= nudge.from;
    const changeId = str(detail['changeId']);
    const requestId = str(detail['requestId']);
    return (
      <ListItem
        key={item.id}
        icon={iconOf(item.icon)}
        description={item.status?.label ?? item.summary ?? undefined}
        {...(item.status === null || item.summary === null
          ? {}
          : {
              supporting: (
                <Text variant="footnote" tone="subtle">
                  {item.summary}
                </Text>
              ),
            })}
        onPress={() => {
          open(item);
        }}
        {...(can
          ? {
              trailing: (
                <Button
                  size="sm"
                  loading={busy !== null}
                  onPress={() => {
                    void (changeId !== null
                      ? write('people', 'NudgePendingChange', { id: changeId }, 'Nudged')
                      : write('timeoff', 'NudgeTimeOffRequest', { requestId }, 'Nudged'));
                  }}
                >
                  {tr('inbox.inbox.nudge', 'Nudge')}
                </Button>
              ),
            }
          : { chevron: true })}
      >
        {item.title}
      </ListItem>
    );
  };

  /** Something finished (I8): what it was, how it ended. */
  const doneRow = (item: Item): React.JSX.Element => (
    <ListItem
      key={item.id}
      icon={iconOf(item.icon)}
      {...(item.summary === null ? {} : { description: item.summary })}
      {...(item.outcome === null
        ? { chevron: true }
        : {
            trailing: (
              <Badge size="sm" tone={item.outcome.tone}>
                {item.outcome.label}
              </Badge>
            ),
          })}
      onPress={() => {
        open(item);
      }}
    >
      {item.title}
    </ListItem>
  );

  const brief =
    lane === 'todo' ? todoBrief(inbox) : lane === 'updates' ? updatesBrief(inbox) : null;

  return (
    <Page large="Inbox" trailing={trailing}>
      <SegmentedControl
        value={lane}
        onValueChange={(v) => {
          if (v === 'todo' || v === 'updates' || v === 'requests' || v === 'done') {
            setLane(v);
            setQ('');
          }
        }}
        size="sm"
        fullWidth
        accessibilityLabel={tr('inbox.inbox.show', 'Show')}
      >
        <SegmentedControlItem value="todo">
          {counts.todo === 0
            ? tr('inbox.inbox.to_do', 'To do')
            : tr('inbox.inbox.to_do_2', 'To do {{String}}', { String: String(counts.todo) })}
        </SegmentedControlItem>
        <SegmentedControlItem value="updates">
          {tr('inbox.inbox.updates', 'Updates {{String}}', { String: String(counts.updates) })}
        </SegmentedControlItem>
        <SegmentedControlItem value="requests">
          {tr('inbox.inbox.requests', 'Requests {{String}}', { String: String(counts.requests) })}
        </SegmentedControlItem>
        <SegmentedControlItem value="done">{tr('inbox.inbox.done', 'Done')}</SegmentedControlItem>
      </SegmentedControl>
      {brief === null ? null : (
        <Alert tone="accent" variant="summary">
          {brief}
        </Alert>
      )}
      {lane === 'done' ? (
        <SearchField
          value={q}
          onValueChange={setQ}
          label={tr('inbox.inbox.search_done', 'Search done')}
          placeholder={tr('inbox.inbox.search_done', 'Search done')}
        />
      ) : null}
      {inbox.unanswered.length === 0 ? null : (
        <Text variant="footnote" tone="muted">
          {`${inbox.unanswered.map(moduleName).join(' and ')} did not answer just now; its items will be back.`}
        </Text>
      )}

      {lane === 'todo' ? (
        <>
          {tasks.length === 0 && inbox.snoozed.length === 0 ? (
            <EmptyState
              icon={CircleCheck}
              tone="accent"
              title={tr('inbox.inbox.youre_all_caught_up', 'You’re all caught up')}
              description={tr(
                'inbox.inbox.new_tasks_land_here_and_on',
                'New tasks land here and on your phone.',
              )}
            />
          ) : (
            <>
              {updates.length === 0 ? null : <Heading title={tr('inbox.inbox.to_do', 'To do')} />}
              {tasks.map((item) => (
                <TaskCard key={item.id} item={item} now={now} zone={zone} navigation={navigation} />
              ))}
            </>
          )}
          {inbox.snoozed.length > 0 ? (
            <View className="gap-2">
              <Button
                startIcon={<Icon icon={AlarmClock} />}
                onPress={() => {
                  setShowSnoozed((s) => !s);
                }}
              >
                {tr('inbox.inbox.snoozed', '{{String}} snoozed', {
                  String: String(inbox.snoozed.length),
                })}
              </Button>
              {showSnoozed
                ? inbox.snoozed.map((item) => (
                    <TaskCard
                      key={item.id}
                      item={item}
                      now={now}
                      zone={zone}
                      navigation={navigation}
                    />
                  ))
                : null}
            </View>
          ) : null}
          {updates.length === 0 ? null : (
            <>
              <Heading
                title={tr('inbox.inbox.updates_2', 'Updates')}
                {...(updates.some((u) => u.unread)
                  ? {
                      action: tr('inbox.inbox.mark_all_read', 'Mark all read'),
                      onAction: () => {
                        change({ kind: 'readAll' }, tr('inbox.inbox.all_read', 'All read'));
                      },
                    }
                  : {})}
              />
              <List>{updates.slice(0, 5).map(updateRow)}</List>
            </>
          )}
        </>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={InboxGlyph}
          title={
            words === ''
              ? tr('inbox.inbox.nothing_in', 'Nothing in {{value}}', { value: LABEL()[lane] })
              : tr('inbox.inbox.nothing_matches', 'Nothing matches')
          }
          description={
            lane === 'requests'
              ? tr(
                  'inbox.inbox.when_a_request_is_decided_it',
                  'When a request is decided it moves to Done and you get an update.',
                )
              : lane === 'done'
                ? tr(
                    'inbox.inbox.finished_tasks_decided_requests_and_older',
                    'Finished tasks, decided requests and older updates stay here.',
                  )
                : tr(
                    'inbox.inbox.news_from_every_module_lands_here',
                    'News from every module lands here.',
                  )
          }
        />
      ) : (
        groups.map((g) => (
          <View key={g.label ?? 'all'} className="gap-2">
            {g.label === null ? null : <Heading title={g.label} />}
            <List>
              {g.items.map(
                lane === 'updates' ? updateRow : lane === 'requests' ? requestRow : doneRow,
              )}
            </List>
          </View>
        ))
      )}
      {lane === 'requests' && groups.length > 0 ? (
        <Text variant="footnote" tone="muted" className="px-1">
          {tr(
            'inbox.inbox.when_a_request_is_decided_it',
            'When a request is decided it moves to Done and you get an update.',
          )}
        </Text>
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
