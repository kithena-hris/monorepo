import {
  EmptyState,
  Icon,
  Inline,
  List,
  ListItem,
  SegmentedControl,
  SegmentedControlItem,
  Text,
} from '@reach/ui-native';
import {
  ArrowDownToLine,
  CircleCheck,
  CircleDashed,
  Copy,
  Eye,
  Flag,
  KeyRound,
  ScanFace,
  Send,
  type LucideIcon,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';

import { Failed, Loading, Page } from '../frame';
import { ask, useSigned } from './api';
import { PersonAvatar } from './media';
import type { PeopleScreen } from './routes';

interface InboxOverview {
  readonly now: string;
  readonly approvals: {
    readonly isHr: boolean;
    readonly items: readonly {
      id: string;
      personId: string;
      name: string;
      avatarUrl: string | null;
      label: string;
      requestedAt: string;
      requestedBy: string;
      asked: boolean | null;
    }[];
  } | null;
  readonly missing: readonly {
    key: string;
    label: string;
    sectionKey: string;
    section: string;
    ownedBy: string | null;
  }[];
  readonly viewedAs:
    | readonly {
        id: string;
        by: string | null;
        at: string;
        endedAt: string;
        specialCategory: boolean;
      }[]
    | null;
  readonly imports:
    | readonly {
        id: string;
        status: string;
        finishedAt: string;
        people: number;
        fields: number;
        fileName: string | null;
      }[]
    | null;
}

interface Waiting {
  readonly identifiers: number | null;
  readonly duplicates: number | null;
  readonly accessRequests: number | null;
  readonly exports: number | null;
  readonly identifiersBy: readonly string[] | null;
  readonly duplicatesBy: readonly string[] | null;
  readonly accessRequestsBy: readonly string[] | null;
  readonly exportsBy: readonly string[] | null;
}

/** One row: whose, what, when, and where it opens. */
interface Row {
  readonly id: string;
  readonly name: string;
  readonly personId: string | null;
  readonly avatarUrl: string | null;
  readonly icon: LucideIcon;
  readonly summary: string;
  readonly at: string | null;
  readonly flag?: string;
  readonly open: () => void;
}

const plural = (n: number, one: string, many: string): string =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

const whoOf = (names: readonly string[] | null): string | null => {
  const [first, second] = names ?? [];
  if (first === undefined) return null;
  if (second === undefined) return first;
  return names?.length === 2
    ? `${first} and ${second}`
    : `${first} and ${String((names?.length ?? 1) - 1)} others`;
};

const ago = (at: string, now: string): string => {
  const minutes = Math.max(1, Math.floor((Date.parse(now) - Date.parse(at)) / 60_000));
  if (minutes < 60) return `${String(minutes)}m`;
  if (minutes < 24 * 60) return `${String(Math.floor(minutes / 60))}h`;
  return `${String(Math.floor(minutes / (24 * 60)))}d`;
};

/**
 * The Inbox (design B3): the same rows as the web's bell. To do is what waits
 * for this person — decisions, questions, their own missing details, imports
 * that finished, and for HR and finance what else waits in Review. Flagged is
 * HR's; Updates lists every time an administrator viewed Kithena as them.
 */
export function Inbox({ navigation }: PeopleScreen<'Inbox'>): React.JSX.Element {
  const signed = useSigned();
  const [view, setView] = useState<'todo' | 'flagged' | 'updates'>('todo');
  const [data, setData] = useState<{
    overview: InboxOverview;
    waiting: Waiting | null;
    flagged: readonly {
      id: string;
      personId: string;
      name: string;
      avatarUrl: string | null;
      label: string;
      flagSummary: string | null;
      canDecide: boolean;
    }[];
  } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    const [overview, waiting, flagged] = await Promise.all([
      ask<InboxOverview>(signed, 'Overview'),
      ask<Waiting>(signed, 'Waiting'),
      ask<{
        items: {
          id: string;
          personId: string;
          name: string;
          avatarUrl: string | null;
          label: string;
          flagSummary: string | null;
          canDecide: boolean;
        }[];
      }>(signed, 'Approvals', { flagged: true }),
    ]);
    if (!overview.ok) {
      setFailed(overview.message);
      return;
    }
    setFailed(null);
    setData({
      overview: overview.data,
      waiting: waiting.ok ? waiting.data : null,
      flagged: flagged.ok
        ? flagged.data.items.filter((i) => i.canDecide && (i.flagSummary ?? '') !== '')
        : [],
    });
  };
  useEffect(() => {
    void load();
    return navigation.addListener('focus', () => {
      void load();
    });
  }, [navigation, signed]);

  if (failed !== null)
    return (
      <Page large="Inbox">
        <Failed message={failed} onRetry={() => void load()} />
      </Page>
    );
  if (data === null)
    return (
      <Page large="Inbox">
        <Loading label="Loading your inbox" />
      </Page>
    );

  const { overview, waiting } = data;
  const isHr = overview.approvals?.isHr === true;

  const todo: Row[] = [
    ...(overview.imports ?? []).map((i) => ({
      id: `import:${i.id}`,
      name:
        i.status === 'failed'
          ? 'Import failed'
          : `Import finished: ${plural(i.people, 'person', 'people')}${i.fields > 0 ? `, ${plural(i.fields, 'new field', 'new fields')}` : ''}`,
      personId: null,
      avatarUrl: null,
      icon: ArrowDownToLine,
      summary: i.fileName ?? 'An imported file',
      at: i.finishedAt,
      open: () => {
        navigation.navigate('ImportRun', { id: i.id });
      },
    })),
    ...(overview.approvals?.items ?? []).map((a) => ({
      id: `approval:${a.id}`,
      name: a.name,
      personId: a.personId,
      avatarUrl: a.avatarUrl,
      icon: Flag,
      summary:
        a.asked === true
          ? `HR asked about your ${a.label.toLowerCase()} change · answer it to move it on`
          : isHr
            ? `${a.label} change · asked by ${a.requestedBy}`
            : `${a.label} is waiting for approval`,
      at: a.requestedAt,
      open: () => {
        navigation.navigate('ReviewChange', { id: a.id });
      },
    })),
    ...overview.missing
      .filter((m) => m.ownedBy === null)
      .map((m) => ({
        id: `missing:${m.key}`,
        name: `Add your ${m.label.toLowerCase()}`,
        personId: null,
        avatarUrl: null,
        icon: CircleDashed,
        summary: m.section,
        at: null,
        open: () => {
          navigation.navigate('EditSection', { sectionKey: m.sectionKey, back: 'Inbox' });
        },
      })),
    ...queue(
      waiting?.identifiers,
      'ids',
      ScanFace,
      'identifier to check',
      'identifiers to check',
      `Failed a check, or couldn’t be verified${whoOf(waiting?.identifiersBy ?? null) === null ? '' : ` · entered by ${whoOf(waiting?.identifiersBy ?? null) ?? ''}`}`,
    ),
    ...queue(
      waiting?.duplicates,
      'duplicates',
      Copy,
      'possible duplicate',
      'possible duplicates',
      'Same work email, or name and birth date',
    ),
    ...queue(
      waiting?.accessRequests,
      'access',
      KeyRound,
      'request for full values',
      'requests for full values',
      `${whoOf(waiting?.accessRequestsBy ?? null) ?? 'Somebody'} asked to see unmasked values`,
    ),
    ...queue(
      waiting?.exports,
      'exports',
      Send,
      'export to send',
      'exports to send',
      `${whoOf(waiting?.exportsBy ?? null) ?? 'Somebody'} asked to send an export`,
    ),
  ];
  function queue(
    n: number | null | undefined,
    kind: string,
    icon: LucideIcon,
    one: string,
    many: string,
    summary: string,
  ): Row[] {
    return n == null || n === 0
      ? []
      : [
          {
            id: `queue:${kind}`,
            name: plural(n, one, many),
            personId: null,
            avatarUrl: null,
            icon,
            summary,
            at: null,
            open: () => {
              navigation.navigate('Review', { kind });
            },
          },
        ];
  }
  const flagged: Row[] = data.flagged.map((f) => ({
    id: `flagged:${f.id}`,
    name: f.name,
    personId: f.personId,
    avatarUrl: f.avatarUrl,
    icon: Flag,
    summary: f.label,
    at: null,
    flag: f.flagSummary ?? '',
    open: () => {
      navigation.navigate('ReviewChange', { id: f.id });
    },
  }));
  const updates: Row[] = (overview.viewedAs ?? []).map((v) => {
    const minutes = Math.max(1, Math.round((Date.parse(v.endedAt) - Date.parse(v.at)) / 60_000));
    return {
      id: `viewed:${v.id}`,
      name: `${v.by ?? 'A People administrator'} viewed Kithena as you`,
      personId: null,
      avatarUrl: null,
      icon: Eye,
      summary: `For ${String(minutes)} min, read-only: nothing was changed.${v.specialCategory ? ' Your sensitive personal details were visible.' : ''}`,
      at: v.endedAt,
      open: () => undefined,
    };
  });
  const rows = view === 'todo' ? todo : view === 'flagged' ? flagged : updates;

  return (
    <Page large="Inbox">
      <SegmentedControl
        value={view}
        fullWidth
        accessibilityLabel="Show"
        onValueChange={(next) => {
          setView(next as typeof view);
        }}
      >
        <SegmentedControlItem value="todo">{`To do · ${String(todo.length)}`}</SegmentedControlItem>
        {isHr ? (
          <SegmentedControlItem value="flagged">{`Flagged · ${String(flagged.length)}`}</SegmentedControlItem>
        ) : null}
        <SegmentedControlItem value="updates">Updates</SegmentedControlItem>
      </SegmentedControl>
      {rows.length === 0 ? (
        <EmptyState
          icon={CircleCheck}
          title={view === 'updates' ? 'No updates' : 'Nothing waiting for you'}
          description={
            view === 'updates'
              ? 'When an administrator views Kithena as you, it is listed here.'
              : 'Decisions, questions and details to add appear here.'
          }
        />
      ) : (
        <List>
          {rows.map((r) => (
            <ListItem
              key={r.id}
              {...(r.personId === null
                ? { icon: r.icon }
                : {
                    leading: (
                      <PersonAvatar
                        personId={r.personId}
                        name={r.name}
                        avatarUrl={r.avatarUrl}
                        size={40}
                      />
                    ),
                  })}
              description={r.summary}
              {...(r.at === null ? {} : { meta: ago(r.at, overview.now) })}
              {...(r.flag === undefined
                ? {}
                : {
                    supporting: (
                      <Inline gap={1}>
                        <Icon icon={Flag} size={13} tone="warning" />
                        <Text variant="footnote" tone="warning" weight="semibold">
                          {r.flag}
                        </Text>
                      </Inline>
                    ),
                  })}
              {...(view === 'updates' ? {} : { chevron: true, onPress: r.open })}
            >
              {r.name}
            </ListItem>
          ))}
        </List>
      )}
    </Page>
  );
}
