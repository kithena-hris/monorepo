import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  ChipGroup,
  ChipGroupItem,
  EmptyState,
  Field,
  FieldError,
  FieldLabel,
  Icon,
  Inline,
  Input,
  List,
  ListItem,
  SegmentedControl,
  SegmentedControlItem,
  Stack,
  Switch,
  Text,
} from '@reach/ui-native';
import * as WebBrowser from 'expo-web-browser';
import { CircleCheck, Flag } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { Failed, Loading, Page } from '../../frame';
import { useAct } from '../act';
import { useSigned } from '../api';
import { longDate } from '../display';
import type { PeopleScreen } from '../routes';
import { Merges } from './duplicate';
import { readReview } from './load';
import { Missing } from './missing';
import {
  ago,
  CHIP,
  CHIPS,
  rowsOf,
  viewerOf,
  type AccessState,
  type ReviewData,
  type ReviewKind,
  type ReviewTab,
  type Row,
} from './model';

/** Each chip's own empty state, so an empty filter still says what would appear. */
const EMPTY: Readonly<Record<ReviewKind | 'all' | 'mine', { title: string; body: string }>> = {
  all: {
    title: 'Nothing waiting for you',
    body: 'Changes, ID checks, duplicates and requests appear here when they need you.',
  },
  changes: { title: 'Nothing to approve', body: 'All changes have been decided.' },
  ids: {
    title: 'Nothing to review',
    body: 'Every national identifier entered so far passed its checks, or has been reviewed.',
  },
  duplicates: {
    title: 'Nothing looks duplicated',
    body: 'No two records share a work email, a name and birth date, or a unique value.',
  },
  access: { title: 'Nothing to decide', body: 'A request appears here when finance asks.' },
  exports: {
    title: 'Nothing to send',
    body: 'A request appears here when somebody sends an export to a person who can’t see all of it.',
  },
  missing: { title: 'Nothing is missing', body: 'Every required field has a value.' },
  mine: { title: 'Nothing waiting', body: 'None of your changes wait for approval.' },
};

/** One row of the queue (design `qrow`): who, how long ago, what, and why it is flagged. */
function QueueRow({ row, now, onPress }: { row: Row; now: number; onPress: () => void }) {
  return (
    <ListItem
      leading={<Avatar name={row.name} size={40} decorative />}
      description={row.summary}
      {...(row.flag === null && row.by === null
        ? {}
        : {
            supporting: (
              <Stack gap={1}>
                {row.by === null ? null : (
                  <Text variant="footnote" tone="muted">
                    {row.by}
                  </Text>
                )}
                {row.flag === null ? null : (
                  <Inline gap={1}>
                    <Icon icon={Flag} size={13} tone="warning" />
                    <Text variant="footnote" tone="warning" weight="semibold">
                      {row.flag}
                    </Text>
                  </Inline>
                )}
              </Stack>
            ),
          })}
      {...(row.at === null ? {} : { meta: ago(row.at, now) })}
      {...(row.badge === null
        ? { chevron: true }
        : {
            trailing: (
              <Badge size="sm" tone={row.badge.tone}>
                {row.badge.text}
              </Badge>
            ),
          })}
      onPress={onPress}
    >
      {row.name}
    </ListItem>
  );
}

/** Finance's Review (E7): ask HR for full values, and the requests with their one download. */
function FullValuesAsk({ access, onDone }: { access: AccessState; onDone: () => void }) {
  const { act, busy } = useAct();
  const [fields, setFields] = useState<readonly string[]>([]);
  const [reason, setReason] = useState('');
  const [shown, setShown] = useState(false);
  return (
    <Card>
      <Stack gap={3}>
        <Text variant="title3">Ask for full values</Text>
        {access.fields.map((f) => (
          <Checkbox
            key={f.key}
            checked={fields.includes(f.key)}
            onCheckedChange={(on) => {
              setFields((held) => (on ? [...held, f.key] : held.filter((k) => k !== f.key)));
            }}
          >
            {f.label}
          </Checkbox>
        ))}
        <Field required invalid={shown && reason.trim() === ''}>
          <FieldLabel>Reason</FieldLabel>
          <Input value={reason} onChange={setReason} size="sm" maxLength={500} />
          {shown && reason.trim() === '' ? <FieldError>Say why, for HR.</FieldError> : null}
        </Field>
        <Button
          variant="primary"
          fullWidth
          disabled={fields.length === 0}
          loading={busy === 'RequestFullValues'}
          onPress={() => {
            setShown(true);
            if (reason.trim() === '') return;
            void act('RequestFullValues', { fields, reason: reason.trim() }, 'Sent to HR').then(
              (done) => {
                if (done === null) return;
                setFields([]);
                setReason('');
                setShown(false);
                onDone();
              },
            );
          }}
        >
          Ask HR
        </Button>
      </Stack>
    </Card>
  );
}

const STATE: Partial<
  Record<string, { tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger'; text: string }>
> = {
  pending: { tone: 'warning', text: 'Waiting for HR' },
  approved: { tone: 'info', text: 'Being prepared' },
  issued: { tone: 'success', text: 'Ready' },
  downloaded: { tone: 'neutral', text: 'Downloaded' },
  rejected: { tone: 'danger', text: 'Rejected' },
  expired: { tone: 'neutral', text: 'Expired' },
};

/** The viewer's own requests for full values, and the one download each allows. */
function OwnRequests({ access }: { access: AccessState }) {
  const mine = access.requests.filter((r) => r.mine);
  if (mine.length === 0) return null;
  return (
    <Stack gap={2}>
      <Text variant="footnote" weight="semibold" tone="muted" className="px-1">
        Your requests
      </Text>
      <List>
        {mine.map((r) => {
          const state = STATE[r.state];
          return (
            <ListItem
              key={r.id}
              description={
                r.state === 'pending'
                  ? `Waiting for HR · expires ${longDate(r.expiresAt.slice(0, 10))}`
                  : (r.note ?? state?.text ?? r.state)
              }
              trailing={
                r.link === null ? (
                  state === undefined ? undefined : (
                    <Badge size="sm" tone={state.tone}>
                      {state.text}
                    </Badge>
                  )
                ) : (
                  <Button
                    size="xs"
                    variant="primary"
                    onPress={() => {
                      void WebBrowser.openBrowserAsync(r.link ?? '');
                    }}
                  >
                    Download, once
                  </Button>
                )
              }
            >
              {r.fields.join(', ')}
            </ListItem>
          );
        })}
      </List>
    </Stack>
  );
}

/** What Kithena checks (AI8), switchable by a People administrator: at the foot of Flagged. */
function Checks({ data, onDone }: { data: ReviewData; onDone: () => void }) {
  const { act, busy } = useAct();
  const checks = data.approvals?.checks ?? [];
  if (checks.length === 0) return null;
  const tunable = data.approvals?.canTune === true;
  const last90 = data.approvals?.last90 ?? null;
  return (
    <Stack gap={2}>
      <Text variant="footnote" weight="semibold" tone="muted" className="px-1">
        What Kithena checks
      </Text>
      <List>
        {checks.map((c) => (
          <ListItem
            key={c.code}
            description={c.detail}
            trailing={
              <Switch
                checked={c.on}
                disabled={!tunable}
                loading={busy === 'SetApprovalCheck'}
                accessibilityLabel={c.title}
                onCheckedChange={(on) => {
                  void act('SetApprovalCheck', { code: c.code, on }).then((done) => {
                    if (done !== null) onDone();
                  });
                }}
              />
            }
          >
            {c.title}
          </ListItem>
        ))}
      </List>
      {tunable ? null : (
        <Text variant="footnote" tone="muted" className="px-1">
          A People administrator switches these.
        </Text>
      )}
      {last90 === null ? null : (
        <Text variant="footnote" tone="muted" className="px-1">
          {`Last 90 days: ${String(last90.flagged)} flagged, ${String(last90.rejected)} rejected, ${String(last90.marked)} marked not unusual.`}
        </Text>
      )}
      <Alert tone="info" title="What it never does">
        It never blocks a change, never contacts anyone, and never uses health, diversity or other
        special-category data.
      </Alert>
    </Stack>
  );
}

/**
 * Review (design E1): whose turn on top, what kind as chips, one list. A row
 * opens its item; Missing details is a list of its own. An employee's Review
 * is their own changes (E6); finance's is their requests for full values (E7).
 */
export function Review({ navigation, route }: PeopleScreen<'Review'>): React.JSX.Element {
  const signed = useSigned();
  const [tab, setTab] = useState<ReviewTab>('waiting');
  const [kind, setKind] = useState<ReviewKind | 'all'>(
    (route.params?.kind as ReviewKind | undefined) ?? 'all',
  );
  const [data, setData] = useState<ReviewData | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const asked = useRef(0);

  const load = useCallback(async () => {
    const round = ++asked.current;
    setFailed(null);
    const read = await readReview(signed, tab === 'flagged');
    if (round !== asked.current) return;
    if (typeof read === 'string') setFailed(read);
    else setData(read);
  }, [signed, tab]);

  useEffect(() => {
    void load();
  }, [load]);
  // Back from deciding something: the queue reads again, without the item.
  useEffect(
    () =>
      navigation.addListener('focus', () => {
        if (data !== null) void load();
      }),
    [navigation, load, data],
  );

  const frame = (children: React.ReactNode) => (
    <Page title="Review" back={{ label: 'People', onPress: navigation.goBack }}>
      {children}
    </Page>
  );
  if (failed !== null) return frame(<Failed message={failed} onRetry={() => void load()} />);
  if (data === null) return frame(<Loading label="Loading what waits for you" />);

  const viewer = viewerOf(data);
  const now = Date.now();
  const tabs: readonly ReviewTab[] =
    viewer === 'hr' ? ['waiting', 'flagged', 'asked', 'decided'] : ['waiting', 'decided'];
  const rows = rowsOf(data, tab).filter((r) => kind === 'all' || r.kind === kind);
  const chips = viewer === 'hr' ? CHIPS[tab] : [];
  const counts = data.counts;
  const countOf = (k: ReviewKind): number | null =>
    k === 'changes'
      ? (counts?.changes ?? null)
      : k === 'ids'
        ? (counts?.identifiers ?? null)
        : k === 'duplicates'
          ? (counts?.duplicates ?? null)
          : k === 'access'
            ? (counts?.accessRequests ?? null)
            : k === 'exports'
              ? (counts?.exports ?? null)
              : (data.completeness?.listed ?? data.completeness?.rows.length ?? null);
  const label = (t: ReviewTab): string =>
    t === 'waiting'
      ? viewer === 'hr'
        ? // Four segments leave no room for a count: the All chip under it has it.
          'For me'
        : `Waiting · ${String(rowsOf(data, 'waiting').length)}`
      : t === 'flagged'
        ? 'Flagged'
        : t === 'asked'
          ? 'I asked'
          : 'Decided';

  const open = (row: Row): void => {
    const [head = '', tail = ''] = row.id.slice(row.id.indexOf('-') + 1).split('~');
    if (row.kind === 'changes') navigation.navigate('ReviewChange', { id: head });
    else if (row.kind === 'ids')
      navigation.navigate('ReviewId', { personId: head, attributeKey: tail });
    else if (row.kind === 'duplicates')
      navigation.navigate('ReviewDuplicate', { a: head, b: tail });
    else if (row.kind === 'access') navigation.navigate('ReviewAccess', { id: head });
    else navigation.navigate('ReviewShare', { id: head });
  };

  const empty = EMPTY[viewer === 'hr' ? kind : 'mine'];

  return frame(
    <>
      <SegmentedControl
        value={tab}
        fullWidth
        size="sm"
        accessibilityLabel="Whose turn"
        onValueChange={(next) => {
          setTab(next as ReviewTab);
          setKind('all');
        }}
      >
        {tabs.map((t) => (
          <SegmentedControlItem key={t} value={t}>
            {label(t)}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>

      {chips.length === 0 ? null : (
        <View>
          <ChipGroup
            type="single"
            value={kind}
            onValueChange={(next) => {
              setKind(next as ReviewKind | 'all');
            }}
            accessibilityLabel="Kinds"
            scroll
          >
            <ChipGroupItem value="all" variant="view">
              {`All ${String(rowsOf(data, tab).length)}`}
            </ChipGroupItem>
            {chips.map((k) => {
              const n = countOf(k);
              return (
                <ChipGroupItem key={k} value={k} variant="view">
                  {n === null ? CHIP[k] : `${CHIP[k]} ${String(n)}`}
                </ChipGroupItem>
              );
            })}
          </ChipGroup>
        </View>
      )}

      {viewer === 'finance' && data.access !== null ? (
        <>
          <FullValuesAsk access={data.access} onDone={() => void load()} />
          <OwnRequests access={data.access} />
        </>
      ) : null}

      {viewer === 'employee' && tab === 'waiting' ? (
        <Text tone="muted">
          HR reviews each change within 7 days. Your record stays the same until then.
        </Text>
      ) : null}

      {kind === 'missing' && data.completeness !== null ? (
        <Missing
          completeness={data.completeness}
          complete={data.complete}
          onOpen={(personId, name) => {
            navigation.navigate('Profile', { personId, name, back: 'Review' });
          }}
          onDone={() => void load()}
        />
      ) : rows.length === 0 ? (
        viewer === 'finance' ? null : (
          <EmptyState icon={CircleCheck} title={empty.title} description={empty.body} />
        )
      ) : (
        <List>
          {rows.map((row) => (
            <QueueRow
              key={row.id}
              row={row}
              now={now}
              onPress={() => {
                open(row);
              }}
            />
          ))}
        </List>
      )}

      {tab === 'decided' && viewer === 'hr' ? (
        <DecidedElse data={data} onDone={() => void load()} />
      ) : null}
      {tab === 'flagged' ? <Checks data={data} onDone={() => void load()} /> : null}
    </>,
  );
}

/** HR's Decided beyond the changes: identifiers decided, and merges that may be undone. */
function DecidedElse({ data, onDone }: { data: ReviewData; onDone: () => void }) {
  const ids = data.identifiers?.decided ?? [];
  const merges = data.duplicates?.merges ?? [];
  return (
    <>
      {ids.length === 0 ? null : (
        <Stack gap={2}>
          <Text variant="footnote" weight="semibold" tone="muted" className="px-1">
            ID checks
          </Text>
          <List>
            {ids.map((d) => (
              <ListItem
                key={`${d.personId}-${d.label}-${d.decidedAt}`}
                description={`${d.outcome === 'accepted' ? 'Accepted' : 'Sent back'} by ${d.decidedBy} · ${longDate(d.decidedAt.slice(0, 10))}${d.note === null ? '' : ` · “${d.note}”`}`}
              >
                {`${d.name} · ${d.label}`}
              </ListItem>
            ))}
          </List>
        </Stack>
      )}
      {merges.length === 0 ? null : <Merges merges={merges} onDone={onDone} />}
    </>
  );
}
