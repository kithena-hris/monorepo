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
import { useState, type ReactNode } from 'react';

import { Failed, Loading, Page } from '../frame';
import { ask, formInputs, useSigned, type Signed } from '../people/api';
import { shareBase64 } from '../people/media';
import type { PeopleRoutes, PeopleScreen } from '../people/routes';
import { changeInbox, readInbox, useInbox } from './api';
import { RowBadges } from './inbox';
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

/**
 * One item on its own page (M:B1–B7, M:C2–C4, M:D2, M:F2, M:G1, M:S1): the kind
 * and where it lives, the ask in the sender's words, the body its kind draws,
 * and the buttons pinned above the home indicator. Done here is done in the
 * module, because acting runs the module's own operation; the Inbox is read
 * again after, and a task finished goes back to the list with an Undo.
 */

type Nav = PeopleScreen<'InboxItem'>['navigation'];

interface Field_ {
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
const d = (item: Item): Detail => (item.detail ?? {}) as Detail;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
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
function openIn(signed: Signed, navigation: Nav, item: Item): void {
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
      toast({ title: 'That did not work', description: answer.message, tone: 'danger' });
      return null;
    }
    toast({
      title: done.title,
      ...(done.description === undefined ? {} : { description: done.description }),
      tone: 'success',
      ...(done.undo === undefined
        ? {}
        : { action: { label: 'Undo', onPress: done.undo }, duration: 10_000 }),
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
  const back = { label: 'Inbox', onPress: navigation.goBack };
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
          <Loading label="Loading" />
        ) : (
          <Text tone="muted">This is no longer in your Inbox.</Text>
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
            accessibilityLabel={`Open in ${item.openIn}`}
            startIcon={<Icon icon={ArrowUpRight} />}
            onPress={() => {
              openIn(signed, navigation, item);
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            accessibilityLabel="More"
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
            ? 'Task'
            : item.lane === 'update'
              ? 'Update'
              : item.lane === 'request'
                ? 'Request'
                : 'Done'}
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
            ? `You asked on ${when(item.at, zone)}`
            : `${item.from?.name ?? 'Kithena'} · ${when(item.at, zone)}`}
        </Text>
      </View>
      <RowBadges item={{ ...item, unread: false }} now={now} zone={zone} />
      {item.message === null || item.message === '' ? null : (
        <ChatLog accessibilityLabel="Their message">
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
              {`Ask ${sender} a question`}
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
              Remind me later
            </ActionSheetItem>
          ) : null}
          {canAsk ? (
            <ActionSheetItem
              icon={X}
              onSelect={() => {
                setSendingBack(true);
              }}
            >
              I can’t do this
            </ActionSheetItem>
          ) : null}
          {item.lane === 'update' ? (
            <ActionSheetItem
              onSelect={() => {
                void changeInbox(signed, { kind: 'done', ids: [item.id] }).then(() => {
                  toast({ title: 'Moved to Done', tone: 'success' });
                  navigation.goBack();
                });
              }}
            >
              Move to Done
            </ActionSheetItem>
          ) : null}
          {item.lane === 'update' ? (
            <ActionSheetItem
              onSelect={() => {
                void changeInbox(signed, {
                  kind: 'mute',
                  mute: { what: item.kind, inbox: false, email: true, phone: true },
                }).then(() => toast({ title: 'Muted on email and phone', tone: 'success' }));
              }}
            >
              Mute updates like this
            </ActionSheetItem>
          ) : null}
          <ActionSheetItem
            icon={ArrowUpRight}
            onSelect={() => {
              openIn(signed, navigation, item);
            }}
          >
            {`Open in ${item.openIn}`}
          </ActionSheetItem>
          <ActionSheetItem
            onSelect={() => {
              void Clipboard.setStringAsync(
                `${signed.company.origin}/inbox/todo?item=${encodeURIComponent(item.id)}`,
              ).then(() => toast({ title: 'Link copied', tone: 'success' }));
            }}
          >
            Copy link
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
          title="Remind me"
          description={
            item.due === null
              ? undefined
              : `It comes back by ${shortDay(item.due)}, the day it’s due.`
          }
        >
          {snoozeChoices(new Date(), item.due).map((c) => (
            <ActionSheetItem
              key={c.label}
              onSelect={() => {
                void changeInbox(signed, { kind: 'snooze', id: item.id, until: c.at }).then(() => {
                  toast({ title: `Snoozed until ${when(c.at, zone)}`, tone: 'success' });
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
              { title: 'Sent back', description: `${sender} gets an update`, back: true },
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
    <Timeline accessibilityLabel="What happened">
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
      <Button
        className="flex-1"
        startIcon={<Icon icon={ArrowUpRight} />}
        onPress={() => {
          openIn(signed, navigation, item);
        }}
      >
        {`Open in ${item.openIn}`}
      </Button>
    ),
  };
}

/** One field as the phone draws it; anything richer opens the profile. */
function FieldInput({
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
              <SelectValue placeholder="Choose" />
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
        <FieldDescription>A change to this goes to HR first.</FieldDescription>
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
        title: `${fields.map((f) => f.label).join(', ')} added`,
        description: `${sender} gets an update`,
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
        <Alert tone="neutral" title={`${str(detail['closedBy']) ?? sender} cancelled this`}>
          {str(detail['note']) === null ? 'Nothing to do.' : `“${str(detail['note']) ?? ''}”`}
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
            ? 'Some of this goes to HR first.'
            : 'Only you and HR see this. It goes on your record straight away.'}
        </Text>
      ) : null}
      {thread.length === 0 ? null : (
        <ChatLog accessibilityLabel="Questions on this task">
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
          accessibilityLabel={`Reply to ${sender}`}
          placeholder={`Reply to ${sender}…`}
          busy={writes.busy === 'ReplyToAsk'}
          onSend={(text) => {
            void writes.write(
              'people',
              'ReplyToAsk',
              { id: askId, body: text },
              { title: 'Sent', description: `${sender} gets an update` },
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
            {`Ask ${sender}`}
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            startIcon={<Icon icon={Check} />}
            disabled={!filled}
            loading={writes.busy === 'CompleteAsk'}
            onPress={submit}
          >
            Add to my record
          </Button>
        </View>
      ) : state === 'cancelled' ? (
        <Button
          onPress={() => {
            void changeInbox(signed, { kind: 'done', ids: [item.id] });
          }}
        >
          Move to Done
        </Button>
      ) : null}
      {open ? (
        <Button
          variant="ghost"
          onPress={() => {
            setSendingBack(true);
          }}
        >
          I can’t do this
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
                    ? 'The check passes. HR still checks it against your document.'
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
            { title: `${field.label} sent to HR`, back: true },
          );
        }}
      >
        Send to HR
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
            { label: 'On the record', value: shown(detail['before']) },
            { label: 'Asked for', value: shown(detail['after']) },
          ]}
        />
        <Stepper steps={stepsOf(steps)} orientation="vertical" label="Where it is" />
        {nudge === null ? null : (
          <Text variant="footnote" tone="muted">
            {nudge.used
              ? 'You nudged HR'
              : can
                ? 'Nudge once'
                : `You can nudge from ${when(nudge.from, zone)}`}
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
                    { title: 'Withdrawn', back: true },
                  );
                }}
              >
                Withdraw
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
                    { title: 'HR was nudged' },
                  );
                }}
              >
                Nudge HR
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
          label={`${String(done)} of ${String(total)} done`}
          value={total === 0 ? 0 : (done / total) * 100}
          showValue
          valueLabel={left.length === 0 ? 'All done' : `${String(left.length)} to go`}
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
                          { batchId, action: 'remind', personIds: [p.personId] },
                          { title: `${p.name} reminded` },
                        );
                      }}
                    >
                      Remind
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onPress={() => {
                        void writes.write(
                          'people',
                          'CancelAsk',
                          { id: p.askId, note: null },
                          { title: `Cancelled for ${p.name}` },
                        );
                      }}
                    >
                      Cancel
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
                    { title: 'Cancelled for everyone', back: true },
                  );
                }}
              >
                Cancel all
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
                    { title: `Reminded ${String(left.length)}` },
                  );
                }}
              >
                {left.length === 1 ? 'Remind' : `Remind the ${String(left.length)}`}
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
              description={q.by.length === 0 ? undefined : `From ${q.by.join(', ')}`}
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
          Review items keep their own tools. They aren’t copied here, so the two can’t disagree.
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
        Open Review
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
        label="Your checklist"
        value={(count / Math.max(1, steps.length)) * 100}
        showValue
        valueLabel={`${String(count)} of ${String(steps.length)}`}
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
                  Fill in
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
        toast({ title: 'That did not open', description: a.message, tone: 'danger' });
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
          description={`${String(Math.max(1, Math.round(Number(detail['size'] ?? 0) / 1024)))} KB`}
          trailing={
            <Button
              size="sm"
              variant="ghost"
              accessibilityLabel="Open"
              startIcon={<Icon icon={Eye} />}
              onPress={open}
            />
          }
        >
          {str(detail['name']) ?? 'Document'}
        </ListItem>
      </List>
      <KeyValues
        items={[
          { label: 'Sent by', value: str(detail['sentBy']) ?? '—' },
          ...(signature === null
            ? []
            : [
                {
                  label: 'Signed',
                  value: `${when(signature.at, zone)}${signature.place === null ? '' : ` · ${signature.place}`} · ${signature.name}`,
                },
              ]),
          { label: 'Kept in', value: 'Your profile › Documents' },
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
                { title: 'Acknowledged', back: true },
              );
            } else setSigning(true);
          }}
        >
          {action === 'acknowledge'
            ? 'I’ve read it'
            : counter
              ? 'Countersign'
              : seen
                ? 'Sign'
                : 'Open it first'}
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
                ? { id: documentId, action: 'countersign', name: s.name }
                : { id: documentId, action: 'sign', ...s },
              {
                title: counter ? 'Countersigned' : 'Signed',
                description: 'Kept in the profile under Documents',
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
            A signed copy is kept in the profile under Documents.
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
              accessibilityLabel="How to sign"
            >
              <SegmentedControlItem value="typed">Type</SegmentedControlItem>
              <SegmentedControlItem value="drawn">Draw</SegmentedControlItem>
            </SegmentedControl>
          )}
          <Field>
            <FieldLabel>Your full name</FieldLabel>
            <FieldControl>
              <Input value={full} onChange={setFull} autoComplete="name" />
            </FieldControl>
          </Field>
          {how === 'drawn' ? (
            <SignaturePad value={mark} onValueChange={setMark} label="Draw your signature" />
          ) : null}
          <Checkbox checked={agreed} onCheckedChange={setAgreed}>
            I agree this is my signature
          </Checkbox>
        </DialogBody>
        <DialogFooter>
          <Button onPress={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!ready}
            onPress={() => {
              onSign({ name: full.trim(), how, mark: how === 'typed' ? full.trim() : mark });
            }}
          >
            {counter ? 'Countersign' : 'Sign'}
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
          <DialogTitle>{`Send this back to ${sender}?`}</DialogTitle>
          <DialogDescription>{`It leaves your To do. ${sender} gets an update with your reason.`}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <RadioGroup
            value={reason}
            onValueChange={(v) => {
              if (v === 'no_information' || v === 'not_applicable' || v === 'other') setReason(v);
            }}
          >
            <RadioGroupItem value="no_information">I don’t have this information</RadioGroupItem>
            <RadioGroupItem value="not_applicable">This doesn’t apply to me</RadioGroupItem>
            <RadioGroupItem value="other">Something else</RadioGroupItem>
          </RadioGroup>
          <Textarea
            value={note}
            onChange={setNote}
            placeholder={`Note for ${sender}`}
            accessibilityLabel={`Note for ${sender}`}
          />
        </DialogBody>
        <DialogFooter>
          <Button onPress={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={reason === 'other' && note.trim() === ''}
            onPress={() => {
              onSend(reason, note.trim() === '' ? null : note.trim());
            }}
          >
            Send back
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
              ? 'Sending is switched off'
              : `Failed ${num(detail['attempts'], 3)} times in a row`
          }
        >
          {str(detail['problem']) ?? 'Nothing new reaches it until it is fixed.'}
        </Alert>
        <KeyValues
          items={[
            { label: 'Failing since', value: when(str(detail['since']) ?? item.at, zone) },
            { label: 'Waiting to send', value: num(detail['waiting']) },
            { label: 'Who sees this', value: team?.role ?? 'All admins' },
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
          Open
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
                { title: 'It’s yours', description: 'It stops counting for the other admins' },
              );
            }}
          >
            {taken ? 'Take it over' : 'Take it'}
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
      label="Dates"
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
        title: decision === 'approve' ? `Approved ${who}’s time off` : `Declined ${who}’s time off`,
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
            {`${str(detail['teamName']) ?? 'The team'} that week${out === null ? '' : ` · ${String(out.out)} of ${String(out.of)} already out`}`}
          </Text>
          <List>
            {week.map((day) => (
              <ListItem
                key={day.date}
                description={day.out.length === 0 ? 'Nobody else out' : day.out.join(', ')}
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
                  label: `${who} has left after this`,
                  value: days(str(detail['balanceAfter']) ?? '0'),
                },
              ]),
          ...(str(detail['firstAsk']) === null
            ? []
            : [{ label: 'Asked first for', value: str(detail['firstAsk']) ?? '' }]),
        ]}
      />
      {item.lane === 'task' ? (
        <>
          <Field>
            <FieldLabel>{`Note to ${who}`}</FieldLabel>
            <FieldControl>
              <Input value={note} onChange={setNote} placeholder="Optional" />
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
              Decline
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
              Approve
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
        <Stepper steps={stepsOf(steps)} orientation="vertical" label="Where it is" />
        <KeyValues
          items={[
            ...(holder === null
              ? []
              : [
                  {
                    label: 'With',
                    value:
                      holder.covering === null
                        ? holder.name
                        : `${holder.name}, covering for ${holder.covering}`,
                  },
                ]),
            ...(str(detail['balanceAfter']) === null
              ? []
              : [{ label: 'Left after this', value: days(str(detail['balanceAfter']) ?? '0') }]),
          ]}
        />
        {nudge === null ? null : (
          <Text variant="footnote" tone="muted">
            {nudge.used
              ? `You nudged ${who}`
              : can
                ? 'Nudge once'
                : `You can nudge after 48 hours, from ${when(nudge.from, zone)}`}
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
                    { title: 'Withdrawn', back: true },
                  );
                }}
              >
                Withdraw
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
                    { title: `${who} was nudged` },
                  );
                }}
              >
                {`Nudge ${who}`}
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
  const by = firstName(str(detail['by'])) || 'Your approver';
  return {
    content: (
      <View className="gap-4">
        <Dates detail={detail} {...(approved ? {} : { extra: 'Declined' })} />
        <KeyValues
          items={[
            ...(str(detail['leftThisYear']) === null
              ? []
              : [{ label: 'Left this year', value: days(str(detail['leftThisYear']) ?? '0') }]),
            ...(str(detail['note']) === null
              ? []
              : [{ label: `${by}’s note`, value: `“${str(detail['note']) ?? ''}”` }]),
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
        Open in Time off
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
        Request other dates
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
          { label: 'Use them by', value: shortDay(str(detail['by']) ?? '') },
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
        Plan time off
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
            label: 'Calendar',
            value: `${str(detail['calendar']) ?? ''} · ${num(detail['year'])}`,
          },
          { label: 'Public holidays', value: num(detail['count']) },
          ...(first === null
            ? []
            : [{ label: 'First one', value: `${shortDay(first.date)} · ${first.name}` }]),
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
        Open in Time off
      </Button>
    ),
  };
}
