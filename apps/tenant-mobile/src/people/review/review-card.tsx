import {
  Avatar,
  Button,
  Card,
  ChipGroup,
  ChipGroupItem,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldError,
  FieldLabel,
  Icon,
  Input,
  ListItem,
  Text,
} from '@reach/ui-native';
import { dateFormat } from '@reach/ui-native/words';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ArrowRight,
  Check,
  ChartColumn,
  Flag,
  ListChecks,
  MessageSquare,
  X,
} from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { useAct } from '../act';
import { useSigned } from '../api';
import { DisplayValue, longDate } from '../display';
import { PersonAvatar } from '../media';
import type { PeopleRoutes } from '../routes';
import { AskDialog, asField } from './change';
import { readReview } from './load';
import {
  CHIP,
  CHIPS,
  daysLeft,
  firstName,
  isFlagged,
  rowsOf,
  viewerOf,
  type ApprovalItem,
  type ReviewData,
  type ReviewKind,
  type Row,
} from './model';
import { t as tr } from '../../i18n';

type Nav = Pick<NativeStackNavigationProp<PeopleRoutes>, 'navigate' | 'addListener'>;

/** "4 changes · 3 ID checks · 2 duplicates · 2 more": what waits, by kind. */
function kinds(rows: readonly Row[]): string {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
  const words: Record<string, [string, string]> = {
    changes: ['change', 'changes'],
    ids: [
      tr('people.review.review-card.id_check', 'ID check'),
      tr('people.review.review-card.id_checks', 'ID checks'),
    ],
    duplicates: ['duplicate', 'duplicates'],
    access: ['full-values request', 'full-values requests'],
    exports: ['export', 'exports'],
  };
  const parts = [...counts.entries()].map(([k, n]) => {
    const [one, many] = words[k] ?? [k, k];
    return `${String(n)} ${n === 1 ? one : many}`;
  });
  return parts.length <= 3
    ? parts.join(' · ')
    : `${parts.slice(0, 3).join(' · ')} · ${String(parts.slice(3).length)} more`;
}

/**
 * Review, decided in place on the People tab (design v3 P1, P2): what waits
 * for HR as one card, two rows until "Show all" grows it. A plain decision is
 * a tick or a cross on its row; a flagged change opens a centred modal; an ID
 * check and a duplicate open their own pages, which need the room.
 */
export function ReviewCard({ navigation }: { navigation: Nav }): React.JSX.Element | null {
  const signed = useSigned();
  const { act, busy } = useAct();
  const [data, setData] = useState<ReviewData | null>(null);
  const [all, setAll] = useState(false);
  const [kind, setKind] = useState<ReviewKind | 'all'>('all');
  const [deciding, setDeciding] = useState<ApprovalItem | null>(null);
  const asked = useRef(0);

  const load = useCallback(async () => {
    const round = ++asked.current;
    const read = await readReview(signed, false);
    if (round === asked.current && typeof read !== 'string') setData(read);
  }, [signed]);
  useEffect(() => {
    void load();
    return navigation.addListener('focus', () => {
      void load();
    });
  }, [load, navigation]);

  if (data === null || viewerOf(data) !== 'hr') return null;
  const rows = rowsOf(data, 'waiting');
  if (rows.length === 0) return null;
  const shown = (kind === 'all' ? rows : rows.filter((r) => r.kind === kind)).slice(
    0,
    all ? undefined : 2,
  );
  const approvals = data.approvals?.items ?? [];
  const approvalOf = (row: Row): ApprovalItem | undefined =>
    approvals.find((a) => `change-${a.id}` === row.id);
  const idOf = (row: Row): [string, string] => {
    const [head = '', tail = ''] = row.id.slice(row.id.indexOf('-') + 1).split('~');
    return [head, tail];
  };
  const decide = (operation: string, id: string, approve: boolean, extra = {}): void => {
    void act(
      operation,
      { id, approve, note: null, ...extra },
      approve ? 'Approved' : 'Rejected',
    ).then((done) => {
      if (done !== null) void load();
    });
  };
  const page = (row: Row): void => {
    const [head, tail] = idOf(row);
    if (row.kind === 'changes') navigation.navigate('ReviewChange', { id: head });
    else if (row.kind === 'ids')
      navigation.navigate('ReviewId', { personId: head, attributeKey: tail });
    else if (row.kind === 'duplicates')
      navigation.navigate('ReviewDuplicate', { a: head, b: tail });
    else if (row.kind === 'access') navigation.navigate('ReviewAccess', { id: head });
    else navigation.navigate('ReviewShare', { id: head });
  };
  const yesNo = (onNo: () => void, onYes: () => void, who: string) => (
    <View className="flex-row gap-1.5">
      <Button
        size="sm"
        accessibilityLabel={tr('people.review.review-card.reject', 'Reject {{who}}', { who })}
        loading={busy !== null}
        startIcon={<Icon icon={X} size={16} />}
        onPress={onNo}
      />
      <Button
        size="sm"
        variant="primary"
        accessibilityLabel={tr('people.review.review-card.approve', 'Approve {{who}}', { who })}
        startIcon={<Icon icon={Check} size={16} tone="on-accent" />}
        onPress={onYes}
      />
    </View>
  );
  const trailing = (row: Row): React.ReactNode => {
    const [head] = idOf(row);
    if (row.kind === 'changes') {
      const item = approvalOf(row);
      if (item === undefined || !item.canDecide || item.awaitingReview === true) return undefined;
      if (isFlagged(item))
        return (
          <Button
            size="sm"
            onPress={() => {
              setDeciding(item);
            }}
          >
            {tr('people.review.review-card.review', 'Review')}
          </Button>
        );
      return yesNo(
        () => {
          decide('DecidePendingChange', item.id, false, { soleApprover: false });
        },
        () => {
          decide('DecidePendingChange', item.id, true, { soleApprover: false });
        },
        `${item.name}’s ${item.label.toLowerCase()}`,
      );
    }
    if (row.kind === 'ids')
      return (
        <Button
          size="sm"
          onPress={() => {
            page(row);
          }}
        >
          {tr('people.review.review-card.check', 'Check')}
        </Button>
      );
    if (row.kind === 'duplicates')
      return (
        <Button
          size="sm"
          onPress={() => {
            page(row);
          }}
        >
          {tr('people.review.review-card.compare', 'Compare')}
        </Button>
      );
    if (row.kind === 'access')
      return yesNo(
        () => {
          decide('DecideFullValues', head, false);
        },
        () => {
          decide('DecideFullValues', head, true);
        },
        `${row.name}’s request`,
      );
    return yesNo(
      () => {
        decide('DecideExportShare', head, false);
      },
      () => {
        decide('DecideExportShare', head, true);
      },
      `${row.name}’s export`,
    );
  };
  const chips = CHIPS.waiting.filter((k) => k === 'missing' || rows.some((r) => r.kind === k));

  return (
    <Card padded={false} className="overflow-hidden">
      <ListItem icon={ListChecks} iconTone={5} description={kinds(rows)} wrap listitem={false}>
        {tr('people.review.review-card.waiting_for_you', '{{String}} waiting for you', {
          String: String(rows.length),
        })}
      </ListItem>
      {all ? (
        <View className="px-4 pb-2">
          <ChipGroup
            type="single"
            value={kind}
            onValueChange={(next) => {
              if (next === 'missing') {
                navigation.navigate('Review', { kind: 'missing' });
                return;
              }
              setKind(next as ReviewKind | 'all');
            }}
            accessibilityLabel={tr('people.review.review-card.kinds', 'Kinds')}
            scroll
          >
            <ChipGroupItem value="all">
              {tr('people.review.review-card.all', 'All {{String}}', {
                String: String(rows.length),
              })}
            </ChipGroupItem>
            {chips.map((k) => {
              const n = rows.filter((r) => r.kind === k).length;
              return (
                <ChipGroupItem key={k} value={k}>
                  {k === 'missing' ? CHIP[k] : `${CHIP[k]} ${String(n)}`}
                </ChipGroupItem>
              );
            })}
          </ChipGroup>
        </View>
      ) : null}
      {shown.map((row) => {
        const t = trailing(row);
        return (
          <ListItem
            key={row.id}
            listitem={false}
            leading={
              row.personId === null ? (
                <Avatar name={row.name} size={40} />
              ) : (
                <PersonAvatar
                  personId={row.personId}
                  name={row.name}
                  avatarUrl={row.avatarUrl}
                  size={40}
                />
              )
            }
            description={row.summary}
            {...(row.flag === null
              ? {}
              : {
                  supporting: (
                    <View className="flex-row items-center gap-1">
                      <Icon icon={Flag} size={12} tone="warning" />
                      <Text variant="footnote" tone="warning" weight="semibold">
                        {row.flag}
                      </Text>
                    </View>
                  ),
                })}
            {...(t === undefined ? { chevron: true } : { trailing: t })}
            onPress={() => {
              page(row);
            }}
          >
            {row.name}
          </ListItem>
        );
      })}
      <View className="flex-row justify-center gap-2 border-t border-border py-2">
        {rows.length > 2 || all ? (
          <Button
            size="sm"
            variant="link"
            onPress={() => {
              setAll((was) => !was);
              setKind('all');
            }}
          >
            {all
              ? tr('people.review.review-card.show_fewer', 'Show fewer')
              : tr('people.review.review-card.show_all', 'Show all {{String}}', {
                  String: String(rows.length),
                })}
          </Button>
        ) : null}
        {all ? (
          <Button
            size="sm"
            variant="link"
            onPress={() => {
              navigation.navigate('Review');
            }}
          >
            {tr(
              'people.review.review-card.flagged_asked_and_decided',
              'Flagged, asked and decided',
            )}
          </Button>
        ) : null}
      </View>
      {deciding === null ? null : (
        <ChangeDialog
          item={deciding}
          onClose={() => {
            setDeciding(null);
          }}
          onDone={() => {
            setDeciding(null);
            void load();
          }}
        />
      )}
    </Card>
  );
}

const day = dateFormat({ day: 'numeric', month: 'short', timeZone: 'UTC' });

/** P3: a flagged change in a centred modal, before and after, and why in plain words. */
export function ChangeDialog({
  item,
  onClose,
  onDone,
}: {
  item: ApprovalItem;
  onClose: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const { act, busy } = useAct();
  const [note, setNote] = useState('');
  const [needsNote, setNeedsNote] = useState(false);
  const [asking, setAsking] = useState(false);
  const field = asField(item);
  const flagged = isFlagged(item);
  const by = firstName(item.requestedBy);
  const decide = (approve: boolean): void => {
    if (approve && flagged && note.trim() === '') {
      setNeedsNote(true);
      return;
    }
    void act(
      'DecidePendingChange',
      {
        id: item.id,
        approve,
        note: note.trim() === '' ? null : note.trim(),
        soleApprover: false,
      },
      approve ? 'Approved' : 'Rejected',
    ).then((done) => {
      if (done !== null) onDone();
    });
  };
  if (asking)
    return (
      <AskDialog
        item={item}
        onClose={() => {
          setAsking(false);
        }}
        onDone={onDone}
      />
    );
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <View className="flex-row items-start gap-3">
            <PersonAvatar
              personId={item.personId}
              name={item.name}
              avatarUrl={item.avatarUrl ?? null}
              size={44}
            />
            <View className="flex-1 gap-1">
              <DialogTitle>{`${item.name}’s ${item.label.toLowerCase()}`}</DialogTitle>
              <DialogDescription>
                {tr(
                  'people.review.review-card.asked_by_from',
                  'Asked by {{requestedBy}} · from {{format}} · {{toLowerCase}}',
                  {
                    requestedBy: item.requestedBy,
                    format: day.format(Date.parse(`${item.effectiveFrom}T00:00:00Z`)),
                    toLowerCase: daysLeft(item.expiresAt, Date.now()).toLowerCase(),
                  },
                )}
              </DialogDescription>
            </View>
          </View>
        </DialogHeader>
        <DialogBody>
          {item.readable ? (
            <Card variant="fill">
              <View className="flex-row items-center gap-3">
                <View className="flex-1 gap-1.5">
                  <Text variant="footnote" tone="subtle">
                    {tr('people.review.review-card.now', 'Now')}
                  </Text>
                  <DisplayValue
                    field={field}
                    value={item.before ?? item.current}
                    className="text-fg-muted line-through"
                  />
                </View>
                <Icon icon={ArrowRight} size={18} tone="subtle" />
                <View className="flex-1 gap-1.5">
                  <Text variant="footnote" tone="subtle">
                    {tr('people.review.review-card.asked_for', 'Asked for')}
                  </Text>
                  <DisplayValue
                    field={field}
                    value={item.value}
                    className="text-[20px] font-bold"
                  />
                </View>
              </View>
            </Card>
          ) : (
            <Text tone="muted">
              {tr(
                'people.review.review-card.you_cant_view_this_field_it',
                'You can’t view this field. It takes effect from {{longDate}}.',
                { longDate: longDate(item.effectiveFrom) },
              )}
            </Text>
          )}
          {(item.flags ?? []).map((f) => (
            <ListItem
              key={f.code}
              listitem={false}
              icon={f.code.includes('band') ? ChartColumn : Flag}
              {...(f.detail === '' ? {} : { description: f.detail })}
              wrap
              className="bg-transparent px-0"
            >
              {f.title}
            </ListItem>
          ))}
          {item.reason === null ? null : (
            <ListItem
              listitem={false}
              icon={MessageSquare}
              description={`“${item.reason}”`}
              wrap
              className="bg-transparent px-0"
            >
              {tr('people.review.review-card.note', '{{value}} note', {
                value: by === 'the requester' ? 'Their' : `${by}’s`,
              })}
            </ListItem>
          )}
          {item.canAsk === true ? (
            <Button
              variant="link"
              onPress={() => {
                setAsking(true);
              }}
            >
              {tr('people.review.review-card.ask_a_question', 'Ask {{by}} a question', { by })}
            </Button>
          ) : null}
          {flagged ? (
            <Field invalid={needsNote}>
              <FieldLabel>{tr('people.review.review-card.note_2', 'Note')}</FieldLabel>
              <Input
                value={note}
                onChange={(t) => {
                  setNote(t);
                  if (t.trim() !== '') setNeedsNote(false);
                }}
                placeholder={tr(
                  'people.review.review-card.required_to_approve_something_flagged',
                  'Required to approve something flagged',
                )}
                size="sm"
              />
              {needsNote ? (
                <FieldError>
                  {tr(
                    'people.review.review-card.add_a_note_to_approve_something',
                    'Add a note to approve something flagged.',
                  )}
                </FieldError>
              ) : null}
            </Field>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button
            className="flex-1"
            loading={busy !== null}
            onPress={() => {
              decide(false);
            }}
          >
            {tr('people.review.review-card.reject_2', 'Reject')}
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            loading={busy !== null}
            onPress={() => {
              decide(true);
            }}
          >
            {tr('people.review.review-card.approve_2', 'Approve')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
