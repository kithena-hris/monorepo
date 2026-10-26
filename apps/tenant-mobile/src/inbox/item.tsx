import {
  ActionSheet,
  ActionSheetContent,
  ActionSheetItem,
  Alert,
  Avatar,
  Badge,
  Button,
  ChatComposer,
  ChatLog,
  ChatMessage,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  Icon,
  Input,
  KeyValues,
  List,
  ListItem,
  Progress,
  RadioGroup,
  RadioGroupItem,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SignaturePad,
  Stat,
  Stepper,
  Switch,
  Text,
  Textarea,
  Timeline,
  TimelineItem,
  useToast,
} from '@reach/ui-native';
import * as Clipboard from 'expo-clipboard';
import { Linking, View } from 'react-native';
import {
  ArrowUpRight,
  Bell,
  CalendarDays,
  Check,
  Ellipsis,
  Eye,
  FileText,
  Hand,
  MessageCircle,
  PenLine,
  Send,
  X,
} from 'lucide-react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useState, type ReactNode } from 'react';

import { Failed, Loading, Page } from '../frame';
import { ask, formInputs, useSigned, type Signed } from '../people/api';
import { shareBase64 } from '../people/media';
import type { PeopleRoutes, PeopleScreen } from '../people/routes';
import { changeInbox, readInbox, useInbox } from './api';
import { ModuleActions } from './module-actions';
import { RowBadges } from './row-badges';
import {
  days,
  firstName,
  iconOf,
  moduleName,
  shortDay,
  snoozeChoices,
  spanLong,
  when,
  type Item,
} from './model';
import { t } from '../i18n';

/**
 * One item on its own page (M:B1–B7, M:C2–C4, M:D2, M:F2, M:G1, M:S1): the kind
 * and where it lives, the ask in the sender's words, the body its kind draws,
 * and the buttons pinned above the home indicator. Done here is done in the
 * module, because acting runs the module's own operation; the Inbox is read
 * again after, and a task finished goes back to the list with an Undo.
 */

export type Nav = Pick<NativeStackNavigationProp<PeopleRoutes>, 'navigate' | 'goBack'>;

export interface Field_ {
  readonly key: string;
  readonly label: string;
  readonly description: string | null;
  readonly dataType: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly required: boolean;
  readonly value: unknown;
  readonly sensitive: boolean;
}

interface Step {
  readonly label: string;
  readonly state: 'done' | 'current' | 'todo';
  readonly note: string | null;
}

type Detail = Record<string, unknown>;
export const d = (item: Item): Detail => (item.detail ?? {}) as Detail;
export const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown, fallback = 0): string => String(typeof v === 'number' ? v : fallback);
const shown = (v: unknown): string =>
  v === null || v === undefined || v === ''
    ? '—'
    : typeof v === 'boolean'
      ? v
        ? 'Yes'
        : 'No'
      : typeof v === 'string' || typeof v === 'number'
        ? String(v)
        : Array.isArray(v)
          ? v.map((x) => (typeof x === 'string' ? x : '')).join(', ')
          : typeof v === 'object' && 'last4' in v
            ? `•••• ${str(v.last4) ?? ''}`
            : JSON.stringify(v);

const stepsOf = (steps: readonly Step[]) =>
  steps.map((s) => ({
    label: s.label,
    status:
      s.state === 'done'
        ? ('done' as const)
        : s.state === 'current'
          ? ('current' as const)
          : ('todo' as const),
    ...(s.note === null ? {} : { description: s.note }),
  }));

/** Where "Open in …" goes on the phone: the screen that holds it, or the web. */
export function openIn(signed: Signed, navigation: Nav, item: Item): void {
  const link = item.link;
  const person = /^\/people\/([0-9a-f-]{36})$/u.exec(link);
  const decision = /^\/time-off\/approvals\/waiting\/([0-9a-f-]{36})$/u.exec(link);
  const request = /^\/time-off\/requests\/([0-9a-f-]{36})$/u.exec(link);
  if (link === '/people/me') navigation.navigate('Profile', { back: 'Inbox' });
  else if (person?.[1] !== undefined)
    navigation.navigate('Profile', { personId: person[1], back: 'Inbox' });
  else if (decision?.[1] !== undefined)
    navigation.navigate('TimeOffDecision', {
      requestId: decision[1],
      name: item.from?.name ?? 'Request',
    });
  else if (request?.[1] !== undefined)
    navigation.navigate('TimeOffRequestDetail', { requestId: request[1] });
  else if (link.startsWith('/people/review')) navigation.navigate('Review');
  else if (link === '/people/onboarding') navigation.navigate('Onboarding');
  else if (link.startsWith('/time-off')) navigation.navigate('TimeOff');
  else void Linking.openURL(`${signed.company.origin}${link}`);
}

/** One write, from a pinned button: said in a toast, the Inbox read again, and back to the list for a finished task. */
function useWrite(navigation: Nav) {
  const signed = useSigned();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const write = async (
    area: 'people' | 'timeoff',
    operation: string,
    variables: Record<string, unknown>,
    done: { title: string; description?: string; undo?: () => void; back?: boolean },
  ): Promise<unknown> => {
    setBusy(operation);
    const answer = await ask<unknown>(signed, operation, variables, area);
    setBusy(null);
    void readInbox(signed);
    if (!answer.ok) {
      toast({
        title: t('inbox.item.that_did_not_work', 'That did not work'),
        description: answer.message,
        tone: 'danger',
      });
      return null;
    }
    toast({
      title: done.title,
      ...(done.description === undefined ? {} : { description: done.description }),
      tone: 'success',
      ...(done.undo === undefined
        ? {}
        : {
            action: { label: t('inbox.item.undo', 'Undo'), onPress: done.undo },
            duration: 10_000,
          }),
    });
    if (done.back === true) navigation.goBack();
    return answer.data;
  };
  return { write, busy };
}

type Body = { content: ReactNode; foot?: ReactNode };

export function InboxItem({ navigation, route }: PeopleScreen<'InboxItem'>): React.JSX.Element {
  const signed = useSigned();
  const { toast } = useToast();
  const { inbox, error, reload } = useInbox();
  const [menu, setMenu] = useState<'main' | 'snooze' | null>(null);
  const [asking, setAsking] = useState(false);
  const [sendingBack, setSendingBack] = useState(false);
  const back = { label: t('inbox.item.inbox', 'Inbox'), onPress: navigation.goBack };
  const all =
    inbox === null
      ? []
      : [...Object.values(inbox.lanes).flatMap((g) => g.flatMap((x) => x.items)), ...inbox.snoozed];
  const item = all.find((i) => i.id === route.params.id) ?? null;
  const writes = useWrite(navigation);
  if (inbox === null || item === null) {
    return (
      <Page title="" back={back}>
        {error !== null ? (
          <Failed message={error} onRetry={reload} />
        ) : inbox === null ? (
          <Loading label={t('inbox.item.loading', 'Loading')} />
        ) : (
          <Text tone="muted">
            {t('inbox.item.this_is_no_longer_in_your', 'This is no longer in your Inbox.')}
          </Text>
        )}
      </Page>
    );
  }
  const { now, zone } = inbox;
  const body = bodyOf({
    item,
    now,
    zone,
    navigation,
    signed,
    writes,
    asking,
    setAsking,
    setSendingBack,
  });
  const sender = firstName(item.from?.name) || 'them';
  const canAsk = item.kind === 'people.details' && item.lane === 'task' && item.outcome === null;
  return (
    <Page
      title=""
      back={back}
      trailing={
        <View className="flex-row gap-1">
          <Button
            variant="ghost"
            size="sm"
            accessibilityLabel={t('inbox.item.open_in', 'Open in {{openIn}}', {
              openIn: item.openIn,
            })}
            startIcon={<Icon icon={ArrowUpRight} />}
            onPress={() => {
              openIn(signed, navigation, item);
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            accessibilityLabel={t('inbox.item.more', 'More')}
            startIcon={<Icon icon={Ellipsis} />}
            onPress={() => {
              setMenu('main');
            }}
          />
        </View>
      }
      {...(body.foot === undefined ? {} : { foot: body.foot })}
    >
      <View className="flex-row flex-wrap gap-1.5">
        <Badge size="sm" tone={item.lane === 'task' ? 'accent' : 'neutral'}>
          {item.lane === 'task'
            ? t('inbox.item.task', 'Task')
            : item.lane === 'update'
              ? t('inbox.item.update', 'Update')
              : item.lane === 'request'
                ? t('inbox.item.request', 'Request')
                : t('inbox.item.done', 'Done')}
        </Badge>
        <Badge size="sm" variant="outline">
          {item.area === null
            ? moduleName(item.module)
            : `${moduleName(item.module)} › ${item.area}`}
        </Badge>
      </View>
      <Text variant="large" weight="bold">
        {item.title}
      </Text>
      <View className="flex-row items-center gap-2">
        {item.from?.name == null || item.lane === 'request' ? null : (
          <Avatar name={item.from.name} size={24} />
        )}
        <Text variant="footnote" tone="muted">
          {item.lane === 'request'
            ? t('inbox.item.you_asked_on', 'You asked on {{when}}', { when: when(item.at, zone) })
            : `${item.from?.name ?? 'Kithena'} · ${when(item.at, zone)}`}
        </Text>
      </View>
      <RowBadges item={{ ...item, unread: false }} now={now} zone={zone} />
      {item.message === null || item.message === '' ? null : (
        <ChatLog accessibilityLabel={t('inbox.item.their_message', 'Their message')}>
          <ChatMessage
            from="other"
            author={item.from?.name ?? 'Kithena'}
            meta={when(item.at, zone)}
          >
            {item.message}
          </ChatMessage>
        </ChatLog>
      )}
      {body.content}
      <Activity item={item} zone={zone} />
      <ActionSheet
        open={menu === 'main'}
        onOpenChange={(o) => {
          if (!o) setMenu(null);
        }}
      >
        <ActionSheetContent title={item.title}>
          {canAsk ? (
            <ActionSheetItem
              icon={MessageCircle}
              onSelect={() => {
                setAsking(true);
              }}
            >
              {t('inbox.item.ask_a_question', 'Ask {{sender}} a question', { sender })}
            </ActionSheetItem>
          ) : null}
          {item.lane === 'task' && item.outcome === null && item.count === null ? (
            <ActionSheetItem
              icon={Bell}
              onSelect={() =>
                setTimeout(() => {
                  setMenu('snooze');
                }, 300)
              }
            >
              {t('inbox.item.remind_me_later', 'Remind me later')}
            </ActionSheetItem>
          ) : null}
          {canAsk ? (
            <ActionSheetItem
              icon={X}
              onSelect={() => {
                setSendingBack(true);
              }}
            >
              {t('inbox.item.i_cant_do_this', 'I can’t do this')}
            </ActionSheetItem>
          ) : null}
          {item.lane === 'update' ? (
            <ActionSheetItem
              onSelect={() => {
                void changeInbox(signed, { kind: 'done', ids: [item.id] }).then(() => {
                  toast({ title: t('inbox.item.moved_to_done', 'Moved to Done'), tone: 'success' });
                  navigation.goBack();
                });
              }}
            >
              {t('inbox.item.move_to_done', 'Move to Done')}
            </ActionSheetItem>
          ) : null}
          {item.lane === 'update' ? (
            <ActionSheetItem
              onSelect={() => {
                void changeInbox(signed, {
                  kind: 'mute',
                  mute: { what: item.kind, inbox: false, email: true, phone: true },
                }).then(() =>
                  toast({
                    title: t('inbox.item.muted_on_email_and_phone', 'Muted on email and phone'),
                    tone: 'success',
                  }),
                );
              }}
            >
              {t('inbox.item.mute_updates_like_this', 'Mute updates like this')}
            </ActionSheetItem>
          ) : null}
          <ActionSheetItem
            icon={ArrowUpRight}
            onSelect={() => {
              openIn(signed, navigation, item);
            }}
          >
            {t('inbox.item.open_in', 'Open in {{openIn}}', { openIn: item.openIn })}
          </ActionSheetItem>
          <ActionSheetItem
            onSelect={() => {
              void Clipboard.setStringAsync(
                `${signed.company.origin}/inbox?item=${encodeURIComponent(item.id)}`,
              ).then(() =>
                toast({ title: t('inbox.item.link_copied', 'Link copied'), tone: 'success' }),
              );
            }}
          >
            {t('inbox.item.copy_link', 'Copy link')}
          </ActionSheetItem>
        </ActionSheetContent>
      </ActionSheet>
      <ActionSheet
        open={menu === 'snooze'}
        onOpenChange={(o) => {
          if (!o) setMenu(null);
        }}
      >
        <ActionSheetContent
          title={t('inbox.item.remind_me', 'Remind me')}
          description={
            item.due === null
              ? undefined
              : t(
                  'inbox.item.it_comes_back_by_the_day',
                  'It comes back by {{shortDay}}, the day it’s due.',
                  { shortDay: shortDay(item.due) },
                )
          }
        >
          {snoozeChoices(new Date(), item.due).map((c) => (
            <ActionSheetItem
              key={c.label}
              onSelect={() => {
                void changeInbox(signed, { kind: 'snooze', id: item.id, until: c.at }).then(() => {
                  toast({
                    title: t('inbox.item.snoozed_until', 'Snoozed until {{when}}', {
                      when: when(c.at, zone),
                    }),
                    tone: 'success',
                  });
                  navigation.goBack();
                });
              }}
            >
              {c.label}
            </ActionSheetItem>
          ))}
        </ActionSheetContent>
      </ActionSheet>
      {sendingBack ? (
        <SendBack
          sender={sender}
          onClose={() => {
            setSendingBack(false);
          }}
          onSend={(reason, note) => {
            setSendingBack(false);
            void writes.write(
              'people',
              'SendBackAsk',
              { id: str(d(item)['askId']), reason, note },
              {
                title: t('inbox.item.sent_back', 'Sent back'),
                description: t('inbox.item.gets_an_update', '{{sender}} gets an update', {
                  sender,
                }),
                back: true,
              },
            );
          }}
        />
      ) : null}
    </Page>
  );
}

function Activity({ item, zone }: { item: Item; zone: string }): React.JSX.Element | null {
  const events = d(item)['events'];
  if (!Array.isArray(events) || events.length === 0) return null;
  return (
    <Timeline accessibilityLabel={t('inbox.item.what_happened', 'What happened')}>
      {(events as { icon: string; text: string; at: string }[]).map((e, i) => (
        <TimelineItem
          key={`${e.at}${String(i)}`}
          title={e.text}
          timestamp={when(e.at, zone)}
          icon={iconOf(e.icon)}
        />
      ))}
    </Timeline>
  );
}

interface BodyArgs {
  readonly item: Item;
  readonly now: string;
  readonly zone: string;
  readonly navigation: Nav;
  readonly signed: Signed;
  readonly writes: ReturnType<typeof useWrite>;
  readonly asking: boolean;
  readonly setAsking: (on: boolean) => void;
  readonly setSendingBack: (on: boolean) => void;
}

function bodyOf(a: BodyArgs): Body {
  if (a.item.detail === null) return plain(a);
  switch (a.item.kind) {
    case 'people.details':
      return { content: <Details {...a} /> };
    case 'people.correct':
      return { content: <Correct {...a} /> };
    case 'people.change':
      return change(a);
    case 'people.asked':
      return asked(a);
    case 'people.review':
      return review(a);
    case 'people.checklist':
      return { content: <Checklist {...a} /> };
    case 'people.document':
      return { content: <Document {...a} /> };
    case 'people.integration':
      return integration(a);
    case 'timeoff.approval':
      return { content: <Approval {...a} /> };
    case 'timeoff.request':
      return a.item.lane === 'done' ? decided(a) : request(a);
    case 'timeoff.decided':
      return decided(a);
    case 'timeoff.expiring':
      return expiring(a);
    case 'timeoff.holidays':
      return holidays(a);
    default:
      return plain(a);
  }
}

function plain({ item, signed, navigation }: BodyArgs): Body {
  return {
    content: item.summary === null ? null : <Text tone="muted">{item.summary}</Text>,
    foot: (
      <ModuleActions
        item={item}
        navigation={navigation}
        fallback={
          <Button
            className="flex-1"
            startIcon={<Icon icon={ArrowUpRight} />}
            onPress={() => {
              openIn(signed, navigation, item);
            }}
          >
            {t('inbox.item.open_in', 'Open in {{openIn}}', { openIn: item.openIn })}
          </Button>
        }
      />
    ),
  };
}

/** One field as the phone draws it; anything richer opens the profile. */
export function FieldInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: Field_;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
}): React.JSX.Element {
  const text = typeof value === 'string' ? value : '';
  if (field.dataType === 'boolean') {
    return (
      <Switch checked={value === true} onCheckedChange={onChange} disabled={disabled}>
        {field.label}
      </Switch>
    );
  }
  return (
    <Field>
      <FieldLabel>{field.label}</FieldLabel>
      {field.options.length > 0 ? (
        <Select value={text} onValueChange={onChange} disabled={disabled}>
          <FieldControl>
            <SelectTrigger>
              <SelectValue placeholder={t('inbox.item.choose', 'Choose')} />
            </SelectTrigger>
          </FieldControl>
          <SelectContent title={field.label}>
            {field.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <FieldControl>
          <Input
            value={text}
            disabled={disabled}
            type={
              field.dataType === 'email' ? 'email' : field.dataType === 'phone' ? 'tel' : 'text'
            }
            onChange={onChange}
          />
        </FieldControl>
      )}
      {field.description === null ? null : <FieldDescription>{field.description}</FieldDescription>}
      {field.sensitive ? (
        <FieldDescription>
          {t('inbox.item.a_change_to_this_goes_to', 'A change to this goes to HR first.')}
        </FieldDescription>
      ) : null}
    </Field>
  );
}

/** M:B1, B5–B7: fill in, ask a question, send back; done goes back with an Undo. */
function Details({
  item,
  zone,
  writes,
  asking,
  setAsking,
  setSendingBack,
  signed,
}: BodyArgs): React.JSX.Element {
  const detail = d(item);
  const fields = (detail['fields'] ?? []) as Field_[];
  const thread = (detail['thread'] ?? []) as {
    author: string;
    mine: boolean;
    body: string;
    at: string;
  }[];
  const askId = str(detail['askId']) ?? '';
  const state = str(detail['state']);
  const initial = Object.fromEntries(fields.map((f) => [f.key, f.value ?? '']));
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const sender = firstName(item.from?.name) || 'them';
  const open = state === 'open';
  const filled = fields.every((f) => !f.required || (values[f.key] ?? '') !== '');
  const submit = (): void => {
    const previous = Object.fromEntries(fields.map((f) => [f.key, f.value ?? null]));
    void writes.write(
      'people',
      'CompleteAsk',
      { id: askId, values: JSON.stringify(values) },
      {
        title: t('inbox.item.added', '{{join}} added', {
          join: fields.map((f) => f.label).join(', '),
        }),
        description: t('inbox.item.gets_an_update', '{{sender}} gets an update', { sender }),
        back: true,
        undo: () => {
          void ask(signed, 'UndoAsk', { id: askId, values: JSON.stringify(previous) }).then(() =>
            readInbox(signed),
          );
        },
      },
    );
  };
  return (
    <View className="gap-4">
      {state === 'cancelled' ? (
        <Alert
          tone="neutral"
          title={t('inbox.item.cancelled_this', '{{value}} cancelled this', {
            value: str(detail['closedBy']) ?? sender,
          })}
        >
          {str(detail['note']) === null
            ? t('inbox.item.nothing_to_do', 'Nothing to do.')
            : `“${str(detail['note']) ?? ''}”`}
        </Alert>
      ) : null}
      {open || state === 'cancelled' ? (
        fields.map((f) => (
          <FieldInput
            key={f.key}
            field={f}
            value={values[f.key]}
            disabled={!open}
            onChange={(v) => {
              setValues((was) => ({ ...was, [f.key]: v }));
            }}
          />
        ))
      ) : (
        <KeyValues
          items={fields.map((f) => ({ id: f.key, label: f.label, value: shown(f.value) }))}
        />
      )}
      {open ? (
        <Text variant="footnote" tone="muted">
          {fields.some((f) => f.sensitive)
            ? t('inbox.item.some_of_this_goes_to_hr', 'Some of this goes to HR first.')
            : t(
                'inbox.item.only_you_and_hr_see_this',
                'Only you and HR see this. It goes on your record straight away.',
              )}
        </Text>
      ) : null}
      {thread.length === 0 ? null : (
        <ChatLog
          accessibilityLabel={t('inbox.item.questions_on_this_task', 'Questions on this task')}
        >
          {thread.map((m) => (
            <ChatMessage
              key={m.at}
              from={m.mine ? 'self' : 'other'}
              author={m.mine ? 'You' : m.author}
              meta={when(m.at, zone)}
            >
              {m.body}
            </ChatMessage>
          ))}
        </ChatLog>
      )}
      {open && (asking || thread.length > 0) ? (
        <ChatComposer
          accessibilityLabel={t('inbox.item.reply_to', 'Reply to {{sender}}', { sender })}
          placeholder={t('inbox.item.reply_to_2', 'Reply to {{sender}}…', { sender })}
          busy={writes.busy === 'ReplyToAsk'}
          onSend={(text) => {
            void writes.write(
              'people',
              'ReplyToAsk',
              { id: askId, body: text },
              {
                title: t('inbox.item.sent', 'Sent'),
                description: t('inbox.item.gets_an_update', '{{sender}} gets an update', {
                  sender,
                }),
              },
            );
            setAsking(false);
          }}
        />
      ) : null}
      {open ? (
        <View className="flex-row gap-2.5">
          <Button
            startIcon={<Icon icon={MessageCircle} />}
            onPress={() => {
              setAsking(true);
            }}
          >
            {t('inbox.item.ask', 'Ask {{sender}}', { sender })}
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            startIcon={<Icon icon={Check} />}
            disabled={!filled}
            loading={writes.busy === 'CompleteAsk'}
            onPress={submit}
          >
            {t('inbox.item.add_to_my_record', 'Add to my record')}
          </Button>
        </View>
      ) : state === 'cancelled' ? (
        <Button
          onPress={() => {
            void changeInbox(signed, { kind: 'done', ids: [item.id] });
          }}
        >
          {t('inbox.item.move_to_done', 'Move to Done')}
        </Button>
      ) : null}
      {open ? (
        <Button
          variant="ghost"
          onPress={() => {
            setSendingBack(true);
          }}
        >
          {t('inbox.item.i_cant_do_this', 'I can’t do this')}
        </Button>
      ) : null}
    </View>
  );
}

/** M:B2: a value HR refused, checked as it is typed, then sent to HR. */
function Correct({ item, writes, signed }: BodyArgs): React.JSX.Element {
  const field = d(item)['field'] as Field_ | undefined;
  const [value, setValue] = useState('');
  const [check, setCheck] = useState<string | null>(null);
  if (field === undefined) return <Text tone="muted">{item.summary ?? ''}</Text>;
  return (
    <View className="gap-4">
      <Field>
        <FieldLabel>{field.label}</FieldLabel>
        <FieldControl>
          <Input
            value={value}
            onChange={(text) => {
              setValue(text);
              if (text.trim().length < 4) {
                setCheck(null);
                return;
              }
              void ask<{ findings?: { message: string }[] }>(signed, 'IdentifierCheck', {
                personId: null,
                changed: formInputs({ [field.key]: text }),
              }).then((a) => {
                if (!a.ok) return;
                const found = (a.data.findings ?? []).map((f) => f.message);
                setCheck(
                  found.length === 0
                    ? t(
                        'inbox.item.the_check_passes_hr_still_checks',
                        'The check passes. HR still checks it against your document.',
                      )
                    : found.join(' '),
                );
              });
            }}
          />
        </FieldControl>
        {check === null ? null : <FieldDescription>{check}</FieldDescription>}
      </Field>
      <Button
        variant="primary"
        startIcon={<Icon icon={Send} />}
        disabled={value.trim() === ''}
        loading={writes.busy === 'SaveOwnSection'}
        onPress={() => {
          void writes.write(
            'people',
            'SaveOwnSection',
            { changed: formInputs({ [field.key]: value }) },
            {
              title: t('inbox.item.sent_to_hr', '{{label}} sent to HR', { label: field.label }),
              back: true,
            },
          );
        }}
      >
        {t('inbox.item.send_to_hr', 'Send to HR')}
      </Button>
    </View>
  );
}

function change({ item, now, zone, writes }: BodyArgs): Body {
  const detail = d(item);
  const steps = (detail['steps'] ?? []) as Step[];
  const nudge = detail['nudge'] as { from: string; used: boolean } | null;
  const changeId = str(detail['changeId']) ?? '';
  const can = nudge !== null && !nudge.used && now >= nudge.from;
  return {
    content: (
      <View className="gap-4">
        <KeyValues
          items={[
            {
              label: t('inbox.item.on_the_record', 'On the record'),
              value: shown(detail['before']),
            },
            { label: t('inbox.item.asked_for', 'Asked for'), value: shown(detail['after']) },
          ]}
        />
        <Stepper
          steps={stepsOf(steps)}
          orientation="vertical"
          label={t('inbox.item.where_it_is', 'Where it is')}
        />
        {nudge === null ? null : (
          <Text variant="footnote" tone="muted">
            {nudge.used
              ? t('inbox.item.you_nudged_hr', 'You nudged HR')
              : can
                ? t('inbox.item.nudge_once', 'Nudge once')
                : t('inbox.item.you_can_nudge_from', 'You can nudge from {{when}}', {
                    when: when(nudge.from, zone),
                  })}
          </Text>
        )}
      </View>
    ),
    ...(item.lane === 'request'
      ? {
          foot: (
            <>
              <Button
                className="flex-1"
                onPress={() => {
                  void writes.write(
                    'people',
                    'WithdrawPendingChange',
                    { id: changeId },
                    { title: t('inbox.item.withdrawn', 'Withdrawn'), back: true },
                  );
                }}
              >
                {t('inbox.item.withdraw', 'Withdraw')}
              </Button>
              <Button
                className="flex-1"
                variant="primary"
                startIcon={<Icon icon={Bell} />}
                disabled={!can}
                loading={writes.busy === 'NudgePendingChange'}
                onPress={() => {
                  void writes.write(
                    'people',
                    'NudgePendingChange',
                    { id: changeId },
                    { title: t('inbox.item.hr_was_nudged', 'HR was nudged') },
                  );
                }}
              >
                {t('inbox.item.nudge_hr', 'Nudge HR')}
              </Button>
            </>
          ),
        }
      : {}),
  };
}

function asked({ item, writes }: BodyArgs): Body {
  const detail = d(item);
  const people = (detail['people'] ?? []) as {
    askId: string;
    personId: string;
    name: string;
    state: string;
  }[];
  const total = Number(detail['total'] ?? 0);
  const done = Number(detail['done'] ?? 0);
  const left = people.filter((p) => p.state === 'open');
  const batchId = str(detail['batchId']) ?? '';
  return {
    content: (
      <View className="gap-4">
        <Progress
          label={t('inbox.item.of_done', '{{String}} of {{String2}} done', {
            String: String(done),
            String2: String(total),
          })}
          value={total === 0 ? 0 : (done / total) * 100}
          showValue
          valueLabel={
            left.length === 0
              ? t('inbox.item.all_done', 'All done')
              : t('inbox.item.to_go', '{{String}} to go', { String: String(left.length) })
          }
        />
        {left.length === 0 ? null : (
          <List>
            {left.map((p) => (
              <ListItem
                key={p.askId}
                leading={<Avatar name={p.name} size={32} />}
                trailing={
                  <View className="flex-row gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onPress={() => {
                        void writes.write(
                          'people',
                          'ChangeAskBatch',
                          {
                            batchId,
                            action: 'remind',
                            personIds: [p.personId],
                          },
                          {
                            title: t('inbox.item.reminded', '{{name}} reminded', { name: p.name }),
                          },
                        );
                      }}
                    >
                      {t('inbox.item.remind', 'Remind')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onPress={() => {
                        void writes.write(
                          'people',
                          'CancelAsk',
                          { id: p.askId, note: null },
                          {
                            title: t('inbox.item.cancelled_for', 'Cancelled for {{name}}', {
                              name: p.name,
                            }),
                          },
                        );
                      }}
                    >
                      {t('inbox.item.cancel', 'Cancel')}
                    </Button>
                  </View>
                }
              >
                {p.name}
              </ListItem>
            ))}
          </List>
        )}
      </View>
    ),
    ...(left.length === 0
      ? {}
      : {
          foot: (
            <>
              <Button
                className="flex-1"
                onPress={() => {
                  void writes.write(
                    'people',
                    'ChangeAskBatch',
                    { batchId, action: 'cancel' },
                    {
                      title: t('inbox.item.cancelled_for_everyone', 'Cancelled for everyone'),
                      back: true,
                    },
                  );
                }}
              >
                {t('inbox.item.cancel_all', 'Cancel all')}
              </Button>
              <Button
                className="flex-1"
                variant="primary"
                startIcon={<Icon icon={Bell} />}
                onPress={() => {
                  void writes.write(
                    'people',
                    'ChangeAskBatch',
                    { batchId, action: 'remind' },
                    {
                      title: t('inbox.item.reminded_2', 'Reminded {{String}}', {
                        String: String(left.length),
                      }),
                    },
                  );
                }}
              >
                {left.length === 1
                  ? t('inbox.item.remind', 'Remind')
                  : t('inbox.item.remind_the', 'Remind the {{String}}', {
                      String: String(left.length),
                    })}
              </Button>
            </>
          ),
        }),
  };
}

function review({ item, navigation }: BodyArgs): Body {
  const queues = (d(item)['queues'] ?? []) as {
    key: string;
    label: string;
    count: number;
    by: string[];
  }[];
  return {
    content: (
      <View className="gap-3">
        <List>
          {queues.map((q) => (
            <ListItem
              key={q.key}
              description={
                q.by.length === 0
                  ? undefined
                  : t('inbox.item.from', 'From {{join}}', { join: q.by.join(', ') })
              }
              trailing={<Badge tone="warning">{String(q.count)}</Badge>}
              chevron
              onPress={() => {
                navigation.navigate('Review');
              }}
            >
              {q.label}
            </ListItem>
          ))}
        </List>
        <Text variant="footnote" tone="muted">
          {t(
            'inbox.item.review_items_keep_their_own_tools',
            'Review items keep their own tools. They aren’t copied here, so the two can’t disagree.',
          )}
        </Text>
      </View>
    ),
    foot: (
      <Button
        className="flex-1"
        variant="primary"
        startIcon={<Icon icon={ArrowUpRight} />}
        onPress={() => {
          navigation.navigate('Review');
        }}
      >
        {t('inbox.item.open_review', 'Open Review')}
      </Button>
    ),
  };
}

/** M:S1, G5: a checklist, each step done in place or where it lives. */
function Checklist({ item, navigation, signed }: BodyArgs): React.JSX.Element {
  const steps = (d(item)['steps'] ?? []) as {
    key: string;
    label: string;
    note: string | null;
    done: boolean;
    section: string | null;
    link: string | null;
  }[];
  const [ticks, setTicks] = useState(item.ticks);
  const done = (s: (typeof steps)[number]) => s.done || ticks.includes(s.key);
  const count = steps.filter(done).length;
  return (
    <View className="gap-4">
      <Progress
        label={t('inbox.item.your_checklist', 'Your checklist')}
        value={(count / Math.max(1, steps.length)) * 100}
        showValue
        valueLabel={t('inbox.item.of', '{{String}} of {{String2}}', {
          String: String(count),
          String2: String(steps.length),
        })}
      />
      <List>
        {steps.map((s) => (
          <ListItem
            key={s.key}
            leading={
              <Checkbox
                checked={done(s)}
                accessibilityLabel={s.label}
                disabled={s.section !== null || s.link !== null}
                onCheckedChange={(on) => {
                  setTicks((was) => (on ? [...was, s.key] : was.filter((x) => x !== s.key)));
                  void changeInbox(signed, { kind: 'tick', id: item.id, step: s.key, on });
                }}
              />
            }
            description={s.note ?? undefined}
            trailing={
              s.section !== null && !done(s) ? (
                <Button
                  size="sm"
                  onPress={() => {
                    navigation.navigate('EditSection', {
                      sectionKey: s.section ?? '',
                      back: 'Inbox',
                    });
                  }}
                >
                  {t('inbox.item.fill_in', 'Fill in')}
                </Button>
              ) : undefined
            }
          >
            {s.label}
          </ListItem>
        ))}
      </List>
    </View>
  );
}

/** M:B3, M:B4, M:C3: a document to keep, acknowledge, sign or countersign. */
function Document({ item, zone, writes, signed }: BodyArgs): React.JSX.Element {
  const detail = d(item);
  const documentId = str(detail['documentId']) ?? '';
  const action = str(detail['action']);
  const signature = detail['signature'] as {
    name: string;
    at: string;
    place: string | null;
  } | null;
  const [seen, setSeen] = useState(false);
  const [signing, setSigning] = useState(false);
  const { toast } = useToast();
  const open = (): void => {
    void ask<string>(signed, 'PeopleDocumentFile', { id: documentId }).then(async (a) => {
      if (!a.ok) {
        toast({
          title: t('inbox.item.that_did_not_open', 'That did not open'),
          description: a.message,
          tone: 'danger',
        });
        return;
      }
      const file = JSON.parse(a.data) as { name: string; mediaType: string; data: string };
      await shareBase64(file.data, file.name, file.mediaType);
      setSeen(true);
    });
  };
  const counter = action === 'countersign';
  return (
    <View className="gap-4">
      <List>
        <ListItem
          icon={FileText}
          description={t('inbox.item.kb', '{{String}} KB', {
            String: String(Math.max(1, Math.round(Number(detail['size'] ?? 0) / 1024))),
          })}
          trailing={
            <Button
              size="sm"
              variant="ghost"
              accessibilityLabel={t('inbox.item.open', 'Open')}
              startIcon={<Icon icon={Eye} />}
              onPress={open}
            />
          }
        >
          {str(detail['name']) ?? t('inbox.item.document', 'Document')}
        </ListItem>
      </List>
      <KeyValues
        items={[
          { label: t('inbox.item.sent_by', 'Sent by'), value: str(detail['sentBy']) ?? '—' },
          ...(signature === null
            ? []
            : [
                {
                  label: t('inbox.item.signed', 'Signed'),
                  value: `${when(signature.at, zone)}${signature.place === null ? '' : ` · ${signature.place}`} · ${signature.name}`,
                },
              ]),
          {
            label: t('inbox.item.kept_in', 'Kept in'),
            value: t('inbox.item.your_profile_documents', 'Your profile › Documents'),
          },
        ]}
      />
      {action === 'sign' || action === 'acknowledge' || counter ? (
        <Button
          variant="primary"
          startIcon={<Icon icon={PenLine} />}
          disabled={!seen && !counter}
          loading={writes.busy === 'ActOnDocument'}
          onPress={() => {
            if (action === 'acknowledge') {
              void writes.write(
                'people',
                'ActOnDocument',
                { id: documentId, action: 'acknowledge' },
                { title: t('inbox.item.acknowledged', 'Acknowledged'), back: true },
              );
            } else setSigning(true);
          }}
        >
          {action === 'acknowledge'
            ? t('inbox.item.ive_read_it', 'I’ve read it')
            : counter
              ? t('inbox.item.countersign', 'Countersign')
              : seen
                ? t('inbox.item.sign', 'Sign')
                : t('inbox.item.open_it_first', 'Open it first')}
        </Button>
      ) : null}
      {signing ? (
        <SignDialog
          name={str(detail['name']) ?? 'the document'}
          counter={counter}
          onClose={() => {
            setSigning(false);
          }}
          onSign={(s) => {
            setSigning(false);
            void writes.write(
              'people',
              'ActOnDocument',
              counter
                ? {
                    id: documentId,
                    action: 'countersign',
                    name: s.name,
                  }
                : { id: documentId, action: 'sign', ...s },
              {
                title: counter
                  ? t('inbox.item.countersigned', 'Countersigned')
                  : t('inbox.item.signed', 'Signed'),
                description: t(
                  'inbox.item.kept_in_the_profile_under_documents',
                  'Kept in the profile under Documents',
                ),
                back: true,
              },
            );
          }}
        />
      ) : null}
    </View>
  );
}

function SignDialog({
  name,
  counter,
  onSign,
  onClose,
}: {
  name: string;
  counter: boolean;
  onSign: (s: { name: string; how: 'typed' | 'drawn'; mark: string }) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [how, setHow] = useState<'typed' | 'drawn'>('typed');
  const [full, setFull] = useState('');
  const [mark, setMark] = useState('');
  const [agreed, setAgreed] = useState(false);
  const ready = full.trim() !== '' && agreed && (how === 'typed' || mark !== '');
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`${counter ? 'Countersign' : 'Sign'} ${name}`}</DialogTitle>
          <DialogDescription>
            {t(
              'inbox.item.a_signed_copy_is_kept_in',
              'A signed copy is kept in the profile under Documents.',
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {counter ? null : (
            <SegmentedControl
              value={how}
              onValueChange={(v) => {
                if (v === 'typed' || v === 'drawn') setHow(v);
              }}
              size="sm"
              accessibilityLabel={t('inbox.item.how_to_sign', 'How to sign')}
            >
              <SegmentedControlItem value="typed">
                {t('inbox.item.type', 'Type')}
              </SegmentedControlItem>
              <SegmentedControlItem value="drawn">
                {t('inbox.item.draw', 'Draw')}
              </SegmentedControlItem>
            </SegmentedControl>
          )}
          <Field>
            <FieldLabel>{t('inbox.item.your_full_name', 'Your full name')}</FieldLabel>
            <FieldControl>
              <Input value={full} onChange={setFull} autoComplete="name" />
            </FieldControl>
          </Field>
          {how === 'drawn' ? (
            <SignaturePad
              value={mark}
              onValueChange={setMark}
              label={t('inbox.item.draw_your_signature', 'Draw your signature')}
            />
          ) : null}
          <Checkbox checked={agreed} onCheckedChange={setAgreed}>
            {t('inbox.item.i_agree_this_is_my_signature', 'I agree this is my signature')}
          </Checkbox>
        </DialogBody>
        <DialogFooter>
          <Button onPress={onClose}>{t('inbox.item.cancel', 'Cancel')}</Button>
          <Button
            variant="primary"
            disabled={!ready}
            onPress={() => {
              onSign({ name: full.trim(), how, mark: how === 'typed' ? full.trim() : mark });
            }}
          >
            {counter ? t('inbox.item.countersign', 'Countersign') : t('inbox.item.sign', 'Sign')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SendBack({
  sender,
  onSend,
  onClose,
}: {
  sender: string;
  onSend: (reason: 'no_information' | 'not_applicable' | 'other', note: string | null) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [reason, setReason] = useState<'no_information' | 'not_applicable' | 'other'>(
    'no_information',
  );
  const [note, setNote] = useState('');
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('inbox.item.send_this_back_to', 'Send this back to {{sender}}?', { sender })}
          </DialogTitle>
          <DialogDescription>
            {t(
              'inbox.item.it_leaves_your_to_do_gets',
              'It leaves your To do. {{sender}} gets an update with your reason.',
              { sender },
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <RadioGroup
            value={reason}
            onValueChange={(v) => {
              if (v === 'no_information' || v === 'not_applicable' || v === 'other') setReason(v);
            }}
          >
            <RadioGroupItem value="no_information">
              {t('inbox.item.i_dont_have_this_information', 'I don’t have this information')}
            </RadioGroupItem>
            <RadioGroupItem value="not_applicable">
              {t('inbox.item.this_doesnt_apply_to_me', 'This doesn’t apply to me')}
            </RadioGroupItem>
            <RadioGroupItem value="other">
              {t('inbox.item.something_else', 'Something else')}
            </RadioGroupItem>
          </RadioGroup>
          <Textarea
            value={note}
            onChange={setNote}
            placeholder={t('inbox.item.note_for', 'Note for {{sender}}', { sender })}
            accessibilityLabel={t('inbox.item.note_for', 'Note for {{sender}}', { sender })}
          />
        </DialogBody>
        <DialogFooter>
          <Button onPress={onClose}>{t('inbox.item.cancel', 'Cancel')}</Button>
          <Button
            variant="primary"
            disabled={reason === 'other' && note.trim() === ''}
            onPress={() => {
              onSend(reason, note.trim() === '' ? null : note.trim());
            }}
          >
            {t('inbox.item.send_back', 'Send back')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function integration({ item, zone, writes, signed, navigation }: BodyArgs): Body {
  const detail = d(item);
  const team = item.team;
  const taken = team?.takenBy != null;
  return {
    content: (
      <View className="gap-4">
        <Alert
          tone="danger"
          title={
            detail['disabled'] === true
              ? t('inbox.item.sending_is_switched_off', 'Sending is switched off')
              : t('inbox.item.failed_times_in_a_row', 'Failed {{num}} times in a row', {
                  num: num(detail['attempts'], 3),
                })
          }
        >
          {str(detail['problem']) ??
            t(
              'inbox.item.nothing_new_reaches_it_until_it',
              'Nothing new reaches it until it is fixed.',
            )}
        </Alert>
        <KeyValues
          items={[
            {
              label: t('inbox.item.failing_since', 'Failing since'),
              value: when(str(detail['since']) ?? item.at, zone),
            },
            {
              label: t('inbox.item.waiting_to_send', 'Waiting to send'),
              value: num(detail['waiting']),
            },
            {
              label: t('inbox.item.who_sees_this', 'Who sees this'),
              value: team?.role ?? t('inbox.item.all_admins', 'All admins'),
            },
          ]}
        />
      </View>
    ),
    foot: (
      <>
        <Button
          className="flex-1"
          startIcon={<Icon icon={ArrowUpRight} />}
          onPress={() => {
            openIn(signed, navigation, item);
          }}
        >
          {t('inbox.item.open', 'Open')}
        </Button>
        {team?.mine === true ? null : (
          <Button
            className="flex-1"
            variant="primary"
            startIcon={<Icon icon={Hand} />}
            loading={writes.busy === 'TakeInboxTask'}
            onPress={() => {
              void writes.write(
                'people',
                'TakeInboxTask',
                { itemId: item.id, note: null },
                {
                  title: t('inbox.item.its_yours', 'It’s yours'),
                  description: t(
                    'inbox.item.it_stops_counting_for_the_other',
                    'It stops counting for the other admins',
                  ),
                },
              );
            }}
          >
            {taken
              ? t('inbox.item.take_it_over', 'Take it over')
              : t('inbox.item.take_it', 'Take it')}
          </Button>
        )}
      </>
    ),
  };
}

function Dates({ detail, extra }: { detail: Detail; extra?: string }): React.JSX.Element {
  const from = str(detail['from']) ?? '';
  const to = str(detail['to']) ?? '';
  return (
    <Stat
      label={t('inbox.item.dates', 'Dates')}
      icon={<Icon icon={CalendarDays} />}
      value={spanLong(from, to)}
      description={[days(str(detail['workingDays']) ?? '0'), str(detail['leaveTypeName']), extra]
        .filter(Boolean)
        .join(' · ')}
    />
  );
}

/** M:F2: approve or decline in place, with who else is out that week. */
function Approval({ item, writes }: BodyArgs): React.JSX.Element {
  const detail = d(item);
  const [note, setNote] = useState('');
  const who = firstName(str(detail['personName']));
  const week = (detail['week'] ?? []) as { date: string; out: string[] }[];
  const decide = (decision: 'approve' | 'decline'): void => {
    void writes.write(
      'timeoff',
      'DecideTimeOffRequest',
      {
        requestId: str(detail['requestId']),
        input: { decision, reason: note.trim() === '' ? null : note.trim() },
      },
      {
        title:
          decision === 'approve'
            ? t('inbox.item.approved_s_time_off', 'Approved {{who}}’s time off', { who })
            : t('inbox.item.declined_s_time_off', 'Declined {{who}}’s time off', { who }),
        back: true,
      },
    );
  };
  const out = detail['alreadyOut'] as { out: number; of: number } | null;
  return (
    <View className="gap-4">
      <Dates detail={detail} />
      {week.length === 0 ? null : (
        <View className="gap-2">
          <Text variant="footnote" weight="semibold" tone="muted">
            {t('inbox.item.that_week', '{{value}} that week{{value2}}', {
              value: str(detail['teamName']) ?? 'The team',
              value2: out === null ? '' : ` · ${String(out.out)} of ${String(out.of)} already out`,
            })}
          </Text>
          <List>
            {week.map((day) => (
              <ListItem
                key={day.date}
                description={
                  day.out.length === 0
                    ? t('inbox.item.nobody_else_out', 'Nobody else out')
                    : day.out.join(', ')
                }
              >
                {shortDay(day.date)}
              </ListItem>
            ))}
          </List>
        </View>
      )}
      <KeyValues
        items={[
          ...(str(detail['balanceAfter']) === null
            ? []
            : [
                {
                  label: t('inbox.item.has_left_after_this', '{{who}} has left after this', {
                    who,
                  }),
                  value: days(str(detail['balanceAfter']) ?? '0'),
                },
              ]),
          ...(str(detail['firstAsk']) === null
            ? []
            : [
                {
                  label: t('inbox.item.asked_first_for', 'Asked first for'),
                  value: str(detail['firstAsk']) ?? '',
                },
              ]),
        ]}
      />
      {item.lane === 'task' ? (
        <>
          <Field>
            <FieldLabel>{t('inbox.item.note_to', 'Note to {{who}}', { who })}</FieldLabel>
            <FieldControl>
              <Input
                value={note}
                onChange={setNote}
                placeholder={t('inbox.item.optional', 'Optional')}
              />
            </FieldControl>
          </Field>
          <View className="flex-row gap-2.5">
            <Button
              className="flex-1"
              startIcon={<Icon icon={X} />}
              onPress={() => {
                decide('decline');
              }}
            >
              {t('inbox.item.decline', 'Decline')}
            </Button>
            <Button
              className="flex-1"
              variant="primary"
              startIcon={<Icon icon={Check} />}
              loading={writes.busy === 'DecideTimeOffRequest'}
              onPress={() => {
                decide('approve');
              }}
            >
              {t('inbox.item.approve', 'Approve')}
            </Button>
          </View>
        </>
      ) : null}
    </View>
  );
}

function request({ item, now, zone, writes }: BodyArgs): Body {
  const detail = d(item);
  const steps = (detail['steps'] ?? []) as Step[];
  const nudge = detail['nudge'] as { from: string; used: boolean } | null;
  const holder = detail['holder'] as { name: string; covering: string | null } | null;
  const can = nudge !== null && !nudge.used && now >= nudge.from;
  const requestId = str(detail['requestId']) ?? '';
  const who = firstName(holder?.name) || 'them';
  return {
    content: (
      <View className="gap-4">
        <Dates detail={detail} />
        <Stepper
          steps={stepsOf(steps)}
          orientation="vertical"
          label={t('inbox.item.where_it_is', 'Where it is')}
        />
        <KeyValues
          items={[
            ...(holder === null
              ? []
              : [
                  {
                    label: t('inbox.item.with', 'With'),
                    value:
                      holder.covering === null
                        ? holder.name
                        : `${holder.name}, covering for ${holder.covering}`,
                  },
                ]),
            ...(str(detail['balanceAfter']) === null
              ? []
              : [
                  {
                    label: t('inbox.item.left_after_this', 'Left after this'),
                    value: days(str(detail['balanceAfter']) ?? '0'),
                  },
                ]),
          ]}
        />
        {nudge === null ? null : (
          <Text variant="footnote" tone="muted">
            {nudge.used
              ? t('inbox.item.you_nudged', 'You nudged {{who}}', { who })
              : can
                ? t('inbox.item.nudge_once', 'Nudge once')
                : t(
                    'inbox.item.you_can_nudge_after_48_hours',
                    'You can nudge after 48 hours, from {{when}}',
                    { when: when(nudge.from, zone) },
                  )}
          </Text>
        )}
      </View>
    ),
    ...(item.lane === 'request'
      ? {
          foot: (
            <>
              <Button
                className="flex-1"
                onPress={() => {
                  void writes.write(
                    'timeoff',
                    'CancelTimeOffRequest',
                    { requestId },
                    { title: t('inbox.item.withdrawn', 'Withdrawn'), back: true },
                  );
                }}
              >
                {t('inbox.item.withdraw', 'Withdraw')}
              </Button>
              <Button
                className="flex-1"
                variant="primary"
                startIcon={<Icon icon={Bell} />}
                disabled={!can}
                loading={writes.busy === 'NudgeTimeOffRequest'}
                onPress={() => {
                  void writes.write(
                    'timeoff',
                    'NudgeTimeOffRequest',
                    { requestId },
                    { title: t('inbox.item.was_nudged', '{{who}} was nudged', { who }) },
                  );
                }}
              >
                {t('inbox.item.nudge', 'Nudge {{who}}', { who })}
              </Button>
            </>
          ),
        }
      : {}),
  };
}

function decided({ item, navigation, signed }: BodyArgs): Body {
  const detail = d(item);
  const approved = detail['approved'] === true;
  const by = firstName(str(detail['by'])) || t('inbox.item.your_approver', 'Your approver');
  return {
    content: (
      <View className="gap-4">
        <Dates detail={detail} {...(approved ? {} : { extra: 'Declined' })} />
        <KeyValues
          items={[
            ...(str(detail['leftThisYear']) === null
              ? []
              : [
                  {
                    label: t('inbox.item.left_this_year', 'Left this year'),
                    value: days(str(detail['leftThisYear']) ?? '0'),
                  },
                ]),
            ...(str(detail['note']) === null
              ? []
              : [
                  {
                    label: t('inbox.item.s_note', '{{by}}’s note', { by }),
                    value: `“${str(detail['note']) ?? ''}”`,
                  },
                ]),
          ]}
        />
      </View>
    ),
    foot: approved ? (
      <Button
        className="flex-1"
        startIcon={<Icon icon={ArrowUpRight} />}
        onPress={() => {
          openIn(signed, navigation, item);
        }}
      >
        {t('inbox.item.open_in_time_off', 'Open in Time off')}
      </Button>
    ) : (
      <Button
        className="flex-1"
        variant="primary"
        onPress={() => {
          const params: PeopleRoutes['TimeOffRequest'] = {
            from: str(detail['from']) ?? '',
            to: str(detail['to']) ?? '',
          };
          navigation.navigate('TimeOffRequest', params);
        }}
      >
        {t('inbox.item.request_other_dates', 'Request other dates')}
      </Button>
    ),
  };
}

function expiring({ item, navigation }: BodyArgs): Body {
  const detail = d(item);
  return {
    content: (
      <KeyValues
        items={[
          {
            label: str(detail['leaveTypeName']) ?? 'Days',
            value: days(str(detail['days']) ?? '0'),
          },
          {
            label: t('inbox.item.use_them_by', 'Use them by'),
            value: shortDay(str(detail['by']) ?? ''),
          },
        ]}
      />
    ),
    foot: (
      <Button
        className="flex-1"
        variant="primary"
        onPress={() => {
          navigation.navigate('TimeOffRequest', {
            leaveTypeKey: str(detail['leaveTypeKey']) ?? '',
          });
        }}
      >
        {t('inbox.item.plan_time_off', 'Plan time off')}
      </Button>
    ),
  };
}

function holidays({ item, signed, navigation }: BodyArgs): Body {
  const detail = d(item);
  const first = detail['first'] as { date: string; name: string } | null;
  return {
    content: (
      <KeyValues
        items={[
          {
            label: t('inbox.item.calendar', 'Calendar'),
            value: `${str(detail['calendar']) ?? ''} · ${num(detail['year'])}`,
          },
          {
            label: t('inbox.item.public_holidays', 'Public holidays'),
            value: num(detail['count']),
          },
          ...(first === null
            ? []
            : [
                {
                  label: t('inbox.item.first_one', 'First one'),
                  value: `${shortDay(first.date)} · ${first.name}`,
                },
              ]),
        ]}
      />
    ),
    foot: (
      <Button
        className="flex-1"
        startIcon={<Icon icon={ArrowUpRight} />}
        onPress={() => {
          openIn(signed, navigation, item);
        }}
      >
        {t('inbox.item.open_in_time_off', 'Open in Time off')}
      </Button>
    ),
  };
}
