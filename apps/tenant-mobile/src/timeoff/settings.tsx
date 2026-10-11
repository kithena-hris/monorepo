import {
  Alert,
  Badge,
  Button,
  Card,
  CardTitle,
  Chip,
  ChipGroup,
  ChipGroupItem,
  CopyField,
  DatePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldControl,
  FieldLabel,
  Icon,
  Input,
  List,
  ListItem,
  NumberField,
  SearchField,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Switch,
  Text,
  Textarea,
} from '@reach/ui-native';
import * as WebBrowser from 'expo-web-browser';
import {
  CalendarDays,
  CheckCheck,
  Clock3,
  Monitor,
  Plug,
  Plus,
  Scale,
  Sparkles,
  Tags,
  Trash2,
} from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useState } from 'react';
import { View } from 'react-native';

import { Failed, Heading, Loading, Page } from '../frame';
import { useAct } from '../people/act';
import { useSigned } from '../people/api';
import type { PeopleScreen } from '../people/routes';
import { useTimeOff } from './api';
import { DescribeLeaveTypeDialog } from './add-leave-type';
import { leaveIcon } from './icons';
import { hereOnce, type Office } from './office-area';
import { todayHere } from './time';
import { amount, shortDate } from './words';

type Section =
  'leave-types' | 'negative' | 'approvals' | 'attendance' | 'holidays' | 'integrations';

const SECTIONS: readonly { key: Section; label: string; line: string; icon: typeof Tags }[] = [
  {
    key: 'leave-types',
    label: 'Leave types',
    line: 'What people can take, and how much',
    icon: Tags,
  },
  {
    key: 'negative',
    label: 'Balance rules',
    line: 'How far, who approves, and what happens after',
    icon: Scale,
  },
  {
    key: 'approvals',
    label: 'Approvals',
    line: 'Who approves what, automatic approval, team minimums',
    icon: CheckCheck,
  },
  {
    key: 'attendance',
    label: 'Attendance',
    line: 'Breaks, rest, weekly limits and overtime',
    icon: Clock3,
  },
  {
    key: 'holidays',
    label: 'Holidays',
    line: 'National, regional and city holidays',
    icon: CalendarDays,
  },
  {
    key: 'integrations',
    label: 'Integrations and kiosks',
    line: 'Calendars, chat, kiosks at the door',
    icon: Plug,
  },
];

/** Time Off's settings, for HR: one row each, and each its own page. */
export function TimeOffSettings({
  navigation,
  route,
}: PeopleScreen<'TimeOffSettings'>): React.JSX.Element {
  const section = route.params?.section;
  const back = {
    label: section === undefined ? 'Time off' : 'Settings',
    onPress: navigation.goBack,
  };
  const title = SECTIONS.find((s) => s.key === section)?.label ?? 'Time off settings';
  return (
    <Page title={title} back={back}>
      {section === undefined ? (
        <List>
          {SECTIONS.map((s) => (
            <ListItem
              key={s.key}
              icon={s.icon}
              description={s.line}
              chevron
              onPress={() => {
                navigation.push('TimeOffSettings', { section: s.key });
              }}
            >
              {s.label}
            </ListItem>
          ))}
        </List>
      ) : section === 'leave-types' ? (
        <LeaveTypes
          onOpen={(key, name) => {
            navigation.navigate('TimeOffLeaveType', { leaveTypeKey: key, name });
          }}
          onAdd={() => {
            navigation.navigate('TimeOffAddLeaveType');
          }}
        />
      ) : section === 'negative' ? (
        <Negative />
      ) : section === 'approvals' ? (
        <Approvals />
      ) : section === 'attendance' ? (
        <Attendance />
      ) : section === 'holidays' ? (
        <Holidays />
      ) : (
        <Integrations />
      )}
    </Page>
  );
}

interface LeaveTypeRow {
  readonly definition: {
    key: string;
    name: { default: string };
    category: string;
    icon: string;
    unit: 'day' | 'hour';
    tracked: boolean;
    paid: string;
    visibility: string;
    statutory: boolean;
  };
  readonly hidden: boolean;
  readonly deleted: boolean;
  readonly policyIds: readonly string[];
}

/** A card of rules with a title (v3 S13–S17): each rule a small grey label over a plain answer. */
function Rules({
  title,
  action,
  onAction,
  children,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Card padded={false} className="overflow-hidden">
      <View className="flex-row items-center justify-between px-4 pb-1 pt-4">
        <Text variant="headline">{title}</Text>
        {action === undefined || onAction === undefined ? null : (
          <Button size="xs" variant="link" onPress={onAction}>
            {action}
          </Button>
        )}
      </View>
      {children}
    </Card>
  );
}

/** One rule: its label, the answer in words, and a tap to change it in a modal. */
function Rule({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  onPress?: () => void;
}): React.JSX.Element {
  return (
    <ListItem
      listitem={false}
      overline={label}
      {...(onPress === undefined ? {} : { chevron: true, onPress })}
    >
      {value}
    </ListItem>
  );
}

/** A modal with one rule's control and Save. */
function RuleDialog({
  title,
  busy,
  onClose,
  onSave,
  children,
}: {
  title: string;
  busy: boolean;
  onClose: () => void;
  onSave: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogBody>{children}</DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            Cancel
          </Button>
          <Button className="flex-1" variant="primary" loading={busy} onPress={onSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LeaveTypes({
  onOpen,
  onAdd,
}: {
  onOpen: (key: string, name: string) => void;
  onAdd: () => void;
}): React.JSX.Element {
  const { load, reload } = useTimeOff<{
    leaveTypes: LeaveTypeRow[];
    parentalCompany: { leaveTypeKey: string; extraWeeks: number; afterServiceYears: number } | null;
  }>('TimeOffLeaveTypeSettings');
  const { act, busy } = useAct('timeoff');
  // Back from adding one: the list again.
  useFocusEffect(reload);
  const [weeks, setWeeks] = useState<number | null>(null);
  const [years, setYears] = useState<number | null>(null);
  const [typed, setTyped] = useState('');
  const [describing, setDescribing] = useState<string | null>(null);
  if (load.status !== 'ready') {
    return load.status === 'error' ? (
      <Failed message={load.message} onRetry={reload} />
    ) : (
      <Loading label="Loading the leave types" />
    );
  }
  const company = load.data.parentalCompany;
  return (
    <>
      <SearchField
        ask
        value={typed}
        onValueChange={setTyped}
        onSearch={(text) => {
          setDescribing(text.trim());
        }}
        placeholder="Describe a new kind of leave"
        label="Describe a new kind of leave"
      />
      {describing === null ? null : (
        <DescribeLeaveTypeDialog
          initial={describing}
          onClose={() => {
            setDescribing(null);
          }}
          onSteps={() => {
            setDescribing(null);
            onAdd();
          }}
          onCreated={(key, name) => {
            setDescribing(null);
            setTyped('');
            reload();
            onOpen(key, name);
          }}
        />
      )}
      <List>
        {load.data.leaveTypes
          .filter((t) => !t.deleted)
          .map((t) => (
            <ListItem
              key={t.definition.key}
              icon={leaveIcon(t.definition.icon)}
              description={[
                t.definition.tracked
                  ? t.definition.unit === 'hour'
                    ? 'Hours, from a balance'
                    : 'Days, from a balance'
                  : 'Not from a balance',
                t.definition.paid === 'unpaid' ? 'unpaid' : 'paid',
                t.definition.statutory ? 'by law' : null,
                t.hidden ? 'hidden' : null,
                `${String(t.policyIds.length)} ${t.policyIds.length === 1 ? 'policy' : 'policies'}`,
              ]
                .filter(Boolean)
                .join(' · ')}
              chevron
              onPress={() => {
                onOpen(t.definition.key, t.definition.name.default);
              }}
            >
              {t.definition.name.default}
            </ListItem>
          ))}
      </List>
      <View className="flex-row items-start gap-1.5 px-1">
        <Icon icon={Sparkles} size={13} tone="accent" />
        <Text variant="footnote" tone="accent" className="flex-1">
          Kithena checks each type against the law where it applies.
        </Text>
      </View>
      <Button variant="ghost" startIcon={<Icon icon={Plus} />} onPress={onAdd}>
        Add one step by step
      </Button>
      <Card>
        <Stack gap={2}>
          <CardTitle>Company parental weeks</CardTitle>
          <Text variant="subhead" tone="muted">
            Weeks the company adds to parental leave, after a length of service.
          </Text>
          <View className="flex-row gap-2">
            <View className="flex-1">
              <NumberField
                label="Extra weeks"
                size="sm"
                min={0}
                max={52}
                value={weeks ?? company?.extraWeeks ?? 0}
                onChange={setWeeks}
              />
            </View>
            <View className="flex-1">
              <NumberField
                label="After years"
                size="sm"
                min={0}
                max={40}
                value={years ?? company?.afterServiceYears ?? 0}
                onChange={setYears}
              />
            </View>
          </View>
          <Button
            loading={busy === 'SetTimeOffParentalCompany'}
            disabled={weeks === null && years === null}
            onPress={() => {
              const parental = load.data.leaveTypes.find(
                (t) => t.definition.category === 'parental_leave',
              );
              void act(
                'SetTimeOffParentalCompany',
                {
                  input: {
                    leaveTypeKey:
                      company?.leaveTypeKey ?? parental?.definition.key ?? 'parental_leave',
                    extraWeeks: weeks ?? company?.extraWeeks ?? 0,
                    afterServiceYears: years ?? company?.afterServiceYears ?? 0,
                  },
                },
                'Saved',
              ).then(reload);
            }}
          >
            Save
          </Button>
        </Stack>
      </Card>
    </>
  );
}

interface PolicyDefinition {
  readonly leaveTypeKey: string;
  readonly allowance: readonly { fromYears: number; days: string }[];
  readonly carryOver: { maxDays: string; useBy: { day: number; month: number } | null } | null;
  readonly probationMonths: number;
  readonly earning: string;
  readonly [more: string]: unknown;
}

interface LeaveTypeSetting {
  readonly leaveType: LeaveTypeRow;
  readonly places: { countries: readonly string[]; locations: readonly string[] };
  readonly policies: readonly {
    id: string;
    versions: readonly {
      version: number;
      status: string;
      effectiveFrom: string | null;
      definition: PolicyDefinition;
    }[];
  }[];
}

interface Preview {
  readonly draftVersion: number;
  readonly effectiveFrom: string;
  readonly yearEnd: string;
  readonly members: readonly {
    personId: string;
    displayName: string;
    allowance: { current: string; draft: string };
    left: { current: string; draft: string };
  }[];
  readonly shadow: { from: string; to: string | null; asOf: string } | null;
}

/**
 * One leave type: its policies and their versions, a draft's effect on each
 * person before it is published, a shadow run beside the live one, and
 * publishing from a day. A policy can be described in words and read back.
 */
export function TimeOffLeaveType({
  navigation,
  route,
}: PeopleScreen<'TimeOffLeaveType'>): React.JSX.Element {
  const { load, reload } = useTimeOff<LeaveTypeSetting>('TimeOffLeaveTypeSetting', {
    leaveTypeKey: route.params.leaveTypeKey,
  });
  const { act, busy } = useAct('timeoff');
  const [chosen, setChosen] = useState<string | null>(null);
  const back = { label: 'Leave types', onPress: navigation.goBack };
  if (load.status !== 'ready') {
    return (
      <Page title={route.params.name} back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label="Loading" />
        )}
      </Page>
    );
  }
  const d = load.data;
  const policy = d.policies.find((p) => p.id === chosen) ?? d.policies[0];
  return (
    <Page title={route.params.name} back={back}>
      <Card>
        <View className="flex-row items-center gap-3">
          <View className="size-11 items-center justify-center rounded-[13px] bg-accent-subtle">
            <Icon icon={leaveIcon(d.leaveType.definition.icon)} size={20} tone="accent" />
          </View>
          <View className="flex-1 gap-0.5">
            <Text variant="headline">{d.leaveType.definition.name.default}</Text>
            <Text variant="footnote" tone="muted">
              {`Applies in ${[...d.places.countries, ...d.places.locations].join(', ') || 'every place'}`}
            </Text>
          </View>
        </View>
      </Card>
      {d.policies.length > 1 ? (
        <Select value={policy?.id ?? ''} onValueChange={setChosen}>
          <SelectTrigger size="sm" accessibilityLabel="Policy">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {d.policies.map((p, i) => (
              <SelectItem key={p.id} value={p.id}>
                {`Policy ${String(i + 1)}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {policy === undefined ? (
        d.leaveType.definition.tracked ? (
          <Card>
            <Stack gap={2}>
              <Text>No policy yet: nobody has an allowance for it.</Text>
              <Button
                variant="primary"
                loading={busy === 'DraftTimeOffPolicy'}
                onPress={() => {
                  void act(
                    'DraftTimeOffPolicy',
                    {
                      input: {
                        leaveTypeKey: route.params.leaveTypeKey,
                        allowance: [{ fromYears: 0, days: '0.000' }],
                      },
                    },
                    'Policy started',
                  ).then(reload);
                }}
              >
                Start a policy
              </Button>
              <Button
                onPress={() => {
                  navigation.navigate('TimeOffPolicyDescribe', {
                    leaveTypeKey: route.params.leaveTypeKey,
                  });
                }}
              >
                Describe it in words
              </Button>
            </Stack>
          </Card>
        ) : (
          <Text tone="muted">Not taken from a balance, so it has no policy.</Text>
        )
      ) : (
        <PolicyCard
          key={policy.id}
          policyId={policy.id}
          versions={policy.versions}
          onChanged={reload}
          onDescribe={() => {
            navigation.navigate('TimeOffPolicyDescribe', {
              leaveTypeKey: route.params.leaveTypeKey,
              policyId: policy.id,
            });
          }}
        />
      )}
    </Page>
  );
}

function PolicyCard({
  policyId,
  versions,
  onChanged,
  onDescribe,
}: {
  policyId: string;
  versions: LeaveTypeSetting['policies'][number]['versions'];
  onChanged: () => void;
  onDescribe: () => void;
}): React.JSX.Element {
  const { act, busy } = useAct('timeoff');
  const last = versions.at(-1);
  const draft = last?.status === 'draft' ? last : undefined;
  const live = [...versions].reverse().find((v) => v.status === 'published');
  const shown = draft ?? live;
  const preview = useTimeOff<Preview>('TimeOffPolicyPreview', { policyId });
  const [allowance, setAllowance] = useState<number | null>(null);
  const [carry, setCarry] = useState<number | null>(null);
  const [probation, setProbation] = useState<number | null>(null);
  const [from, setFrom] = useState<string | null>(todayHere());
  const [open, setOpen] = useState<'allowance' | 'carry' | 'probation' | null>(null);
  if (shown === undefined) return <Text tone="muted">No version yet.</Text>;
  const def = shown.definition;
  const first = def.allowance[0];
  const revised: PolicyDefinition = {
    ...def,
    allowance:
      allowance === null
        ? def.allowance
        : [
            { fromYears: first?.fromYears ?? 0, days: allowance.toFixed(3) },
            ...def.allowance.slice(1),
          ],
    carryOver:
      carry === null
        ? def.carryOver
        : carry === 0
          ? null
          : { maxDays: carry.toFixed(3), useBy: def.carryOver?.useBy ?? null },
    probationMonths: probation ?? def.probationMonths,
  };
  const changed = allowance !== null || carry !== null || probation !== null;
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const save = (): void => {
    void (
      draft === undefined
        ? act('DraftTimeOffPolicy', { input: revised }, 'Saved as a draft')
        : act('ReviseTimeOffPolicy', { policyId, input: revised }, 'Draft saved')
    ).then((done) => {
      if (done === null) return;
      setAllowance(null);
      setCarry(null);
      setProbation(null);
      setOpen(null);
      onChanged();
      preview.reload();
    });
  };
  const close = (): void => {
    setOpen(null);
    setAllowance(null);
    setCarry(null);
    setProbation(null);
  };
  return (
    <>
      {/* The rules, each a label and a plain answer (v3 S13); a tap changes one in a modal. */}
      <Rules
        title={draft === undefined ? 'Rules' : `Rules · draft of version ${String(shown.version)}`}
        action="Describe"
        onAction={onDescribe}
      >
        <Rule
          label="How much"
          value={[
            `${amount(first?.days ?? '0')} days a year`,
            ...def.allowance
              .slice(1)
              .map((x) => `${amount(x.days)} after ${String(x.fromYears)} years`),
          ].join(', ')}
          onPress={() => {
            setOpen('allowance');
          }}
        />
        <Rule
          label="How it’s earned"
          value={
            def.earning === 'monthly'
              ? `${amount((Number(first?.days ?? '0') / 12).toFixed(3))} days on the 1st of each month`
              : 'All of it at the start of the year'
          }
        />
        <Rule
          label="Carry over"
          value={
            def.carryOver === null
              ? 'Nothing carried over'
              : `Up to ${amount(def.carryOver.maxDays)} days${def.carryOver.useBy === null ? '' : `, used by ${String(def.carryOver.useBy.day)} ${months[def.carryOver.useBy.month - 1] ?? ''}`}`
          }
          onPress={() => {
            setOpen('carry');
          }}
        />
        <Rule
          label="Waiting period"
          value={
            def.probationMonths === 0
              ? 'From day one'
              : `After ${String(def.probationMonths)} months`
          }
          onPress={() => {
            setOpen('probation');
          }}
        />
      </Rules>
      {draft === undefined ? null : (
        <Text variant="footnote" tone="muted" className="px-1">
          {`Version ${String(shown.version)} is a draft. Nothing changes for anyone until it is published below.`}
        </Text>
      )}
      {open === null ? null : (
        <RuleDialog
          title={
            open === 'allowance' ? 'How much' : open === 'carry' ? 'Carry over' : 'Waiting period'
          }
          busy={busy === 'ReviseTimeOffPolicy' || busy === 'DraftTimeOffPolicy'}
          onClose={close}
          onSave={() => {
            if (changed) save();
            else close();
          }}
        >
          {open === 'allowance' ? (
            <NumberField
              label="Days a year"
              size="sm"
              min={0}
              max={365}
              step={0.5}
              value={allowance ?? Number(first?.days ?? '0')}
              onChange={setAllowance}
            />
          ) : open === 'carry' ? (
            <NumberField
              label="Carried over, at most"
              size="sm"
              min={0}
              max={365}
              step={0.5}
              value={carry ?? Number(def.carryOver?.maxDays ?? '0')}
              onChange={setCarry}
            />
          ) : (
            <NumberField
              label="Months before it is earned"
              size="sm"
              min={0}
              max={24}
              value={probation ?? def.probationMonths}
              onChange={setProbation}
            />
          )}
        </RuleDialog>
      )}
      {draft === undefined || preview.load.status !== 'ready' ? null : (
        <Card>
          <Stack gap={2}>
            <CardTitle>{`What version ${String(preview.load.data.draftVersion)} does`}</CardTitle>
            <List>
              {preview.load.data.members.slice(0, 20).map((m) => (
                <ListItem
                  key={m.personId}
                  description={`${amount(m.allowance.current)} → ${amount(m.allowance.draft)} a year · ${amount(m.left.current)} → ${amount(m.left.draft)} left`}
                >
                  {m.displayName}
                </ListItem>
              ))}
            </List>
            {preview.load.data.shadow === null ? (
              <Button
                loading={busy === 'StartTimeOffShadowRun'}
                onPress={() => {
                  void act('StartTimeOffShadowRun', { policyId }, 'Shadow run started').then(
                    preview.reload,
                  );
                }}
              >
                Run it in the shadow first
              </Button>
            ) : (
              <>
                <Text
                  variant="footnote"
                  tone="muted"
                >{`Running in the shadow since ${shortDate(preview.load.data.shadow.from)}, beside the live policy.`}</Text>
                <Button
                  loading={busy === 'StopTimeOffShadowRun'}
                  onPress={() => {
                    void act('StopTimeOffShadowRun', { policyId }, 'Shadow run stopped').then(
                      preview.reload,
                    );
                  }}
                >
                  Stop the shadow run
                </Button>
              </>
            )}
            <DatePicker label="In effect from" size="sm" value={from} onChange={setFrom} />
            <Button
              variant="primary"
              disabled={from === null}
              loading={busy === 'PublishTimeOffPolicy'}
              onPress={() => {
                if (from === null) return;
                void act(
                  'PublishTimeOffPolicy',
                  { policyId, input: { effectiveFrom: from } },
                  'Published',
                ).then(onChanged);
              }}
            >
              Publish
            </Button>
          </Stack>
        </Card>
      )}
    </>
  );
}

interface PolicyRead {
  readonly ai: boolean;
  readonly text: string | null;
  readonly leaveTypeKey: string | null;
  readonly leaveTypes: readonly { key: string; name: string }[];
  readonly definition: PolicyDefinition | null;
  readonly rules: readonly { key: string; label: string; value: string }[];
  readonly problems: readonly { path: string; message: string }[];
  readonly question: {
    key: string;
    title: string;
    body: { text: string; ai: boolean };
    options: readonly { label: string; value: string }[];
  } | null;
}

/**
 * A policy described in words, read back as its rules: what it understood,
 * one question when something is unclear, and the policy saved as a draft.
 */
export function TimeOffPolicyDescribe({
  navigation,
  route,
}: PeopleScreen<'TimeOffPolicyDescribe'>): React.JSX.Element {
  const [text, setText] = useState('');
  const [asked, setAsked] = useState<Record<string, unknown> | null>(null);
  const { load } = useTimeOff<PolicyRead>(
    'TimeOffPolicyRead',
    asked ?? { leaveTypeKey: route.params.leaveTypeKey },
  );
  const { act, busy } = useAct('timeoff');
  const back = { label: 'Leave type', onPress: navigation.goBack };
  return (
    <Page title="Describe the policy" back={back}>
      <Field>
        <FieldLabel>The policy, as you would explain it</FieldLabel>
        <Textarea
          value={text}
          onChange={setText}
          placeholder="25 working days a year, 30 after five years. Up to 5 carried over, used by 31 March."
        />
      </Field>
      <Button
        disabled={text.trim() === ''}
        onPress={() => {
          setAsked({ text: text.trim(), leaveTypeKey: route.params.leaveTypeKey });
        }}
      >
        Read it
      </Button>
      {asked === null ? null : load.status === 'error' ? (
        <Alert tone="danger">{load.message}</Alert>
      ) : load.status === 'loading' ? (
        <Loading label="Reading it" />
      ) : (
        <>
          {load.data.rules.length === 0 ? null : (
            <List>
              {load.data.rules.map((r) => (
                <ListItem key={r.key} trailing={<Text weight="semibold">{r.value}</Text>}>
                  {r.label}
                </ListItem>
              ))}
            </List>
          )}
          {load.data.question === null ? null : (
            <Card>
              <Stack gap={2}>
                <Text variant="headline">{load.data.question.title}</Text>
                <Text>{load.data.question.body.text}</Text>
                <View className="flex-row flex-wrap gap-2">
                  {load.data.question.options.map((o) => (
                    <Button
                      key={o.value}
                      size="sm"
                      onPress={() => {
                        setAsked({ ...asked, [load.data.question?.key ?? '']: o.value });
                      }}
                    >
                      {o.label}
                    </Button>
                  ))}
                </View>
              </Stack>
            </Card>
          )}
          {load.data.problems.map((p) => (
            <Alert key={p.path} tone="warning">
              {p.message}
            </Alert>
          ))}
          {load.data.definition === null ? null : (
            <Button
              variant="primary"
              loading={busy !== null}
              onPress={() => {
                const definition = load.data.definition;
                if (definition === null) return;
                const policyId = route.params.policyId;
                void (
                  policyId === undefined
                    ? act('DraftTimeOffPolicy', { input: definition }, 'Saved as a draft')
                    : act('ReviseTimeOffPolicy', { policyId, input: definition }, 'Draft saved')
                ).then((done) => {
                  if (done !== null) navigation.goBack();
                });
              }}
            >
              Save as a draft
            </Button>
          )}
        </>
      )}
    </Page>
  );
}

type Rule = { limit: string; approvers: string; atYearEnd: string; onLeaving: string };

const NEG_APPROVERS: Readonly<Record<string, string>> = {
  manager: 'their manager decides',
  manager_then_hr: 'their manager, then HR',
  hr: 'HR decides',
};
const ON_LEAVING: Readonly<Record<string, string>> = {
  final_pay: 'Taken from the last salary',
  write_off: 'Written off',
  hr_decides: 'HR decides',
};

function Negative(): React.JSX.Element {
  const { load, reload } = useTimeOff<{
    policies: {
      policyId: string;
      leaveTypeName: string;
      version: number;
      status: string;
      rule: Rule | null;
    }[];
  }>('TimeOffNegativeBalanceSettings');
  const [editing, setEditing] = useState<string | null>(null);
  if (load.status !== 'ready') {
    return load.status === 'error' ? (
      <Failed message={load.message} onRetry={reload} />
    ) : (
      <Loading label="Loading" />
    );
  }
  const policy = load.data.policies.find((p) => p.policyId === editing);
  const example = load.data.policies.find((p) => p.rule !== null);
  return (
    <>
      {example?.rule == null ? null : (
        <Alert tone="accent" variant="summary">
          {`With these rules, people can book up to ${amount(example.rule.limit)} days of ${example.leaveTypeName.toLowerCase()} beyond what they have left.`}
        </Alert>
      )}
      <Rules title="Going below zero">
        {load.data.policies.map((p) => (
          <Rule
            key={p.policyId}
            label={p.leaveTypeName}
            value={
              p.rule === null
                ? 'Not allowed'
                : `Up to ${amount(p.rule.limit)} days · ${NEG_APPROVERS[p.rule.approvers] ?? p.rule.approvers}`
            }
            onPress={() => {
              setEditing(p.policyId);
            }}
          />
        ))}
      </Rules>
      {load.data.policies.some((p) => p.rule !== null) ? (
        <Rules title="When someone leaves">
          {load.data.policies.flatMap((p) =>
            p.rule === null
              ? []
              : [
                  <Rule
                    key={p.policyId}
                    label={`Days below zero · ${p.leaveTypeName}`}
                    value={ON_LEAVING[p.rule.onLeaving] ?? p.rule.onLeaving}
                    onPress={() => {
                      setEditing(p.policyId);
                    }}
                  />,
                ],
          )}
        </Rules>
      ) : null}
      {policy === undefined ? null : (
        <NegativeDialog
          policy={policy}
          onClose={() => {
            setEditing(null);
          }}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </>
  );
}

function NegativeDialog({
  policy,
  onClose,
  onSaved,
}: {
  policy: { policyId: string; leaveTypeName: string; status: string; rule: Rule | null };
  onClose: () => void;
  onSaved: () => void;
}): React.JSX.Element {
  const { act, busy } = useAct('timeoff');
  const [allowed, setAllowed] = useState(policy.rule !== null);
  const [limit, setLimit] = useState<number | null>(Number(policy.rule?.limit ?? '3'));
  const [approvers, setApprovers] = useState(policy.rule?.approvers ?? 'manager');
  const [atYearEnd, setAtYearEnd] = useState(policy.rule?.atYearEnd ?? 'next_year');
  const [onLeaving, setOnLeaving] = useState(policy.rule?.onLeaving ?? 'final_pay');
  const choose = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    items: readonly (readonly [string, string])[],
  ) => (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger size="sm" accessibilityLabel={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map(([v, l]) => (
            <SelectItem key={v} value={v}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
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
          <DialogTitle>{policy.leaveTypeName}</DialogTitle>
          <DialogDescription>
            {policy.status === 'published'
              ? 'Saved, it is in effect today.'
              : 'Saved, it joins the policy’s draft.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ListItem
            listitem={false}
            trailing={
              <Switch
                checked={allowed}
                accessibilityLabel="May go below zero"
                onCheckedChange={setAllowed}
              />
            }
          >
            May go below zero
          </ListItem>
          {allowed ? (
            <>
              <NumberField
                label="Days below zero, at most"
                size="sm"
                min={0}
                max={30}
                step={0.5}
                value={limit}
                onChange={setLimit}
              />
              {choose('Approved by', approvers, setApprovers, [
                ['manager', 'Their manager'],
                ['manager_then_hr', 'Their manager, then HR'],
                ['hr', 'HR'],
              ])}
              {choose('At year end', atYearEnd, setAtYearEnd, [
                ['next_year', 'Taken from next year'],
                ['unpaid', 'Becomes unpaid'],
                ['write_off', 'Written off'],
              ])}
              {choose('When they leave', onLeaving, setOnLeaving, [
                ['final_pay', 'Taken from the final pay'],
                ['write_off', 'Written off'],
                ['hr_decides', 'HR decides'],
              ])}
            </>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            loading={busy !== null}
            onPress={() => {
              const rule = allowed
                ? { limit: (limit ?? 0).toFixed(3), approvers, atYearEnd, onLeaving }
                : null;
              void act('SetTimeOffNegativeBalanceRule', {
                policyId: policy.policyId,
                input: { rule },
              }).then(async (done) => {
                if (done === null) return;
                if (policy.status === 'published') {
                  await act(
                    'PublishTimeOffPolicy',
                    { policyId: policy.policyId, input: { effectiveFrom: todayHere() } },
                    'Saved and in effect',
                  );
                }
                onSaved();
              });
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ApprovalSettings {
  readonly rules: readonly {
    subject: string;
    leaveTypes: readonly string[] | null;
    when: string;
    approvers: readonly string[];
  }[];
  readonly autoApproval: {
    oneDayAboveMinimum: boolean;
    shortenOrCancel: boolean;
    sickUnderDays: number | null;
  };
  readonly escalation: { afterWorkingDays: number; remindAt: number | null; to: string } | null;
  readonly teams: readonly {
    teamKey: string;
    teamName: string;
    minimum: { atLeast: number; unit: 'people' | 'percent' } | null;
  }[];
}

const APPROVER: Record<string, string> = {
  manager: 'Their manager',
  hr: 'HR',
  manager_chain: 'The manager above',
  delegate: 'A delegate',
};

function Approvals(): React.JSX.Element {
  const { load, reload } = useTimeOff<ApprovalSettings>('TimeOffApprovalSettings');
  const { act, busy } = useAct('timeoff');
  const [auto, setAuto] = useState<ApprovalSettings['autoApproval'] | null>(null);
  const [mins, setMins] = useState<
    Readonly<Record<string, { atLeast: number; unit: 'people' | 'percent' } | null>>
  >({});
  const [chat, setChat] = useState<boolean | null>(null);
  const [teamOpen, setTeamOpen] = useState<string | null>(null);
  if (load.status !== 'ready') {
    return load.status === 'error' ? (
      <Failed message={load.message} onRetry={reload} />
    ) : (
      <Loading label="Loading" />
    );
  }
  const d = load.data;
  const a = auto ?? d.autoApproval;
  const subject = (x: string): string =>
    x === 'request'
      ? 'Time off'
      : x === 'plan'
        ? 'Parental leave plans'
        : 'Overtime and clock fixes';
  const minimum = (m: { atLeast: number; unit: 'people' | 'percent' } | null): string =>
    m === null
      ? 'No minimum'
      : m.unit === 'percent'
        ? `At least ${String(m.atLeast)}% in`
        : `At least ${String(m.atLeast)} in`;
  const team = d.teams.find((t) => t.teamKey === teamOpen);
  return (
    <>
      {/* Three short lists (v3 S15): who approves, how many stay in, and what if nobody answers. */}
      <Rules title="Who approves">
        {d.rules.map((r, i) => (
          <Rule
            key={`${r.subject}${String(i)}`}
            label={`${r.leaveTypes === null ? subject(r.subject) : r.leaveTypes.join(', ')}${r.when === 'always' ? '' : r.when === 'below_zero' ? ' · below zero' : ' · unpaid'}`}
            value={
              r.approvers.length === 0
                ? 'Nobody. The manager is told'
                : r.approvers.map((x) => APPROVER[x] ?? x).join(', then ')
            }
          />
        ))}
      </Rules>
      <Rules title="Team minimums">
        {d.teams.map((t) => {
          const m = t.teamKey in mins ? (mins[t.teamKey] ?? null) : t.minimum;
          return (
            <Rule
              key={t.teamKey}
              label={t.teamName}
              value={minimum(m)}
              onPress={() => {
                setTeamOpen(t.teamKey);
              }}
            />
          );
        })}
      </Rules>
      {d.escalation === null ? null : (
        <Rules title="If nobody decides">
          <Rule
            label={`After ${String(d.escalation.afterWorkingDays)} working days`}
            value={`Remind ${d.escalation.to === 'manager_chain' ? 'the manager, then their manager' : (APPROVER[d.escalation.to] ?? d.escalation.to).toLowerCase()}`}
          />
        </Rules>
      )}
      <Rules title="Approved without asking">
        <ListItem
          listitem={false}
          description="The team stays above its minimum."
          trailing={
            <Switch
              checked={a.oneDayAboveMinimum}
              accessibilityLabel="One day, above the minimum"
              onCheckedChange={(on) => {
                setAuto({ ...a, oneDayAboveMinimum: on });
              }}
            />
          }
        >
          One day, above the minimum
        </ListItem>
        <ListItem
          listitem={false}
          description="Fewer days off is never a problem."
          trailing={
            <Switch
              checked={a.shortenOrCancel}
              accessibilityLabel="Shortening or cancelling"
              onCheckedChange={(on) => {
                setAuto({ ...a, shortenOrCancel: on });
              }}
            />
          }
        >
          Shortening or cancelling
        </ListItem>
        <View className="px-4 pb-4 pt-1">
          <NumberField
            label="Sick leave under this many days"
            size="sm"
            min={0}
            max={30}
            value={a.sickUnderDays}
            onChange={(n) => {
              setAuto({ ...a, sickUnderDays: n });
            }}
          />
        </View>
      </Rules>
      {team === undefined ? null : (
        <RuleDialog
          title={`${team.teamName}: who must stay in`}
          busy={busy === 'SetTimeOffTeamMinimum'}
          onClose={() => {
            setTeamOpen(null);
          }}
          onSave={() => {
            void act(
              'SetTimeOffTeamMinimum',
              {
                teamKey: team.teamKey,
                input: {
                  minimum: team.teamKey in mins ? (mins[team.teamKey] ?? null) : team.minimum,
                },
              },
              'Saved',
            ).then((done) => {
              if (done === null) return;
              setTeamOpen(null);
              setMins({});
              reload();
            });
          }}
        >
          <NumberField
            label="At least"
            size="sm"
            min={0}
            value={(team.teamKey in mins ? mins[team.teamKey] : team.minimum)?.atLeast ?? null}
            onChange={(n) => {
              const m = team.teamKey in mins ? (mins[team.teamKey] ?? null) : team.minimum;
              setMins((all) => ({
                ...all,
                [team.teamKey]: n === null ? null : { atLeast: n, unit: m?.unit ?? 'people' },
              }));
            }}
          />
          <SegmentedControl
            fullWidth
            size="sm"
            value={(team.teamKey in mins ? mins[team.teamKey] : team.minimum)?.unit ?? 'people'}
            accessibilityLabel="Counted as"
            onValueChange={(u) => {
              const m = team.teamKey in mins ? (mins[team.teamKey] ?? null) : team.minimum;
              setMins((all) => ({
                ...all,
                [team.teamKey]: {
                  atLeast: m?.atLeast ?? 1,
                  unit: u === 'percent' ? 'percent' : 'people',
                },
              }));
            }}
          >
            <SegmentedControlItem value="people">People in</SegmentedControlItem>
            <SegmentedControlItem value="percent">Percent in</SegmentedControlItem>
          </SegmentedControl>
        </RuleDialog>
      )}
      <Button
        variant="primary"
        disabled={auto === null}
        loading={busy !== null}
        onPress={() => {
          void (async () => {
            const set = await act('SetTimeOffApprovalRules', {
              input: {
                rules: d.rules,
                autoApproval: a,
                ...(d.escalation === null ? {} : { escalation: d.escalation }),
              },
            });
            if (set === null) return;
            setAuto(null);
            setMins({});
            reload();
          })();
        }}
      >
        Save
      </Button>
      <Card>
        <Stack gap={2}>
          <CardTitle>In chat apps</CardTitle>
          <ListItem
            listitem={false}
            description="Whether an answer in chat may name a private leave type beside a person."
            trailing={
              <Switch
                checked={chat ?? false}
                accessibilityLabel="Name private leave in chat"
                onCheckedChange={setChat}
              />
            }
          >
            Name private leave in chat
          </ListItem>
          <Button
            disabled={chat === null}
            loading={busy === 'SetTimeOffChatAnswers'}
            onPress={() => {
              void act(
                'SetTimeOffChatAnswers',
                { input: { namesPrivateLeave: chat === true } },
                'Saved',
              );
            }}
          >
            Save
          </Button>
        </Stack>
      </Card>
    </>
  );
}

interface AttendanceRules {
  readonly breakAfterMinutes: number;
  readonly breakMinutes: number;
  readonly restMinutes: number;
  readonly weeklyMaxMinutes: number;
  readonly overtime: { becomes: 'comp' | 'paid' | 'choose'; multiplier: string };
  readonly clockIn: { reader: boolean; web: boolean; mobile: boolean; pin: boolean; area: boolean };
  readonly offices: readonly Office[];
}

const WAYS = [
  ['reader', 'Badge or phone at a reader', 'At a kiosk, with a badge or the app’s code'],
  ['web', 'Web, from the top bar', 'Everyone'],
  ['mobile', 'Mobile app', 'Everyone'],
  ['pin', 'Shared kiosk with a PIN', 'At a kiosk, without a badge'],
] as const;

function Attendance(): React.JSX.Element {
  const { load, reload } = useTimeOff<{ defaultSchedule: string | null; rules: AttendanceRules }>(
    'TimeOffAttendanceSettings',
  );
  const { act, busy } = useAct('timeoff');
  const [rules, setRules] = useState<AttendanceRules | null>(null);
  const [open, setOpen] = useState<'breaks' | 'limits' | 'overtime' | 'offices' | null>(null);
  const [office, setOffice] = useState({ name: '', radiusMetres: 150 });
  const [locating, setLocating] = useState<string | null>(null);
  if (load.status !== 'ready') {
    return load.status === 'error' ? (
      <Failed message={load.message} onRetry={reload} />
    ) : (
      <Loading label="Loading" />
    );
  }
  const r = rules ?? load.data.rules;
  const set = (patch: Partial<AttendanceRules>): void => {
    setRules({ ...r, ...patch });
  };
  const hours = (m: number): number => Math.round((m / 60) * 10) / 10;
  const close = (): void => {
    setOpen(null);
    setRules(null);
    setLocating(null);
  };
  const save = (): void => {
    void act('SetTimeOffAttendanceRules', { input: r }, 'Saved').then((done) => {
      if (done === null) return;
      close();
      reload();
    });
  };
  const flip = (way: keyof AttendanceRules['clockIn'], on: boolean): void => {
    const next = { ...r, clockIn: { ...r.clockIn, [way]: on } };
    setRules(next);
    void act('SetTimeOffAttendanceRules', { input: next }, 'Saved').then((done) => {
      if (done === null) setRules(null);
      else reload();
    });
  };
  const addHere = (): void => {
    setLocating(null);
    void hereOnce().then((here) => {
      if (here === null) {
        setLocating('Kithena could not tell where this phone is. Allow location and try again.');
        return;
      }
      set({
        offices: [
          ...r.offices,
          { name: office.name.trim(), ...here, radiusMetres: office.radiusMetres },
        ],
      });
      setOffice({ name: '', radiusMetres: 150 });
    });
  };
  const BECOMES = {
    comp: 'banked as comp time',
    paid: 'paid',
    choose: 'the manager chooses',
  } as const;
  return (
    <>
      {/* Switches for how people clock in (v3 S16), each saved as it flips. */}
      <Rules title="Ways to clock in">
        {WAYS.map(([way, label, description]) => (
          <ListItem
            key={way}
            listitem={false}
            description={description}
            trailing={
              <Switch
                checked={r.clockIn[way]}
                accessibilityLabel={label}
                onCheckedChange={(on) => {
                  flip(way, on);
                }}
              />
            }
          >
            {label}
          </ListItem>
        ))}
        <ListItem
          listitem={false}
          description="Location is checked only at the moment you clock in"
          trailing={
            <Switch
              checked={r.clockIn.area}
              accessibilityLabel="Only inside the office area"
              onCheckedChange={(on) => {
                // Nowhere to compare with yet: say where the office is first, then save both.
                if (on && r.offices.length === 0) {
                  set({ clockIn: { ...r.clockIn, area: true } });
                  setOpen('offices');
                } else flip('area', on);
              }}
            />
          }
        >
          Only inside the office area
        </ListItem>
        <Rule
          label="Offices"
          value={
            r.offices.length === 0
              ? 'None yet'
              : r.offices.map((o) => `${o.name} · ${String(o.radiusMetres)} m`).join(', ')
          }
          onPress={() => {
            setOpen('offices');
          }}
        />
      </Rules>
      {/* Three rows for what counts as a working day (v3 S16), each changed in a modal. */}
      <Rules title="Working day">
        <Rule label="Schedule" value={load.data.defaultSchedule ?? 'Not set'} />
        <Rule
          label="Breaks"
          value={`${String(r.breakMinutes)} minutes after ${String(hours(r.breakAfterMinutes))} hours`}
          onPress={() => {
            setOpen('breaks');
          }}
        />
        <Rule
          label="Rest and weekly limit"
          value={`${String(hours(r.restMinutes))} hours between days · ${String(hours(r.weeklyMaxMinutes))} a week`}
          onPress={() => {
            setOpen('limits');
          }}
        />
        <Rule
          label="Overtime"
          value={`Manager approves · ${BECOMES[r.overtime.becomes]} at ×${r.overtime.multiplier}`}
          onPress={() => {
            setOpen('overtime');
          }}
        />
      </Rules>
      {open === 'breaks' ? (
        <RuleDialog title="Breaks" busy={busy !== null} onClose={close} onSave={save}>
          <NumberField
            label="Break after (hours)"
            size="sm"
            min={0}
            max={24}
            step={0.5}
            value={hours(r.breakAfterMinutes)}
            onChange={(n) => {
              set({ breakAfterMinutes: Math.round((n ?? 0) * 60) });
            }}
          />
          <NumberField
            label="Break length (minutes)"
            size="sm"
            min={0}
            max={240}
            value={r.breakMinutes}
            onChange={(n) => {
              set({ breakMinutes: n ?? 0 });
            }}
          />
        </RuleDialog>
      ) : null}
      {open === 'limits' ? (
        <RuleDialog
          title="Rest and weekly limit"
          busy={busy !== null}
          onClose={close}
          onSave={save}
        >
          <NumberField
            label="Rest between days (hours)"
            size="sm"
            min={0}
            max={24}
            step={0.5}
            value={hours(r.restMinutes)}
            onChange={(n) => {
              set({ restMinutes: Math.round((n ?? 0) * 60) });
            }}
          />
          <NumberField
            label="Weekly maximum (hours)"
            size="sm"
            min={0}
            max={80}
            step={0.5}
            value={hours(r.weeklyMaxMinutes)}
            onChange={(n) => {
              set({ weeklyMaxMinutes: Math.round((n ?? 0) * 60) });
            }}
          />
        </RuleDialog>
      ) : null}
      {open === 'offices' ? (
        <RuleDialog title="Offices" busy={busy !== null} onClose={close} onSave={save}>
          <Text variant="footnote" tone="muted">
            Stand in the office and add it. A clock-in within the distance counts as there.
          </Text>
          {r.offices.map((o, i) => (
            <ListItem
              key={`${o.name}-${String(i)}`}
              listitem={false}
              description={`Within ${String(o.radiusMetres)} m`}
              trailing={
                <Button
                  size="xs"
                  variant="link"
                  onPress={() => {
                    set({ offices: r.offices.filter((_, j) => j !== i) });
                  }}
                >
                  Remove
                </Button>
              }
            >
              {o.name}
            </ListItem>
          ))}
          <Field>
            <FieldLabel>Name</FieldLabel>
            <FieldControl>
              <Input
                size="sm"
                value={office.name}
                placeholder="Madrid office"
                onChange={(name) => {
                  setOffice({ ...office, name });
                }}
              />
            </FieldControl>
          </Field>
          <NumberField
            label="Counts within (metres)"
            size="sm"
            min={25}
            max={5000}
            step={25}
            value={office.radiusMetres}
            onChange={(n) => {
              setOffice({ ...office, radiusMetres: n ?? 150 });
            }}
          />
          {locating === null ? null : <Alert tone="warning">{locating}</Alert>}
          <Button disabled={office.name.trim() === ''} onPress={addHere}>
            Add where you are now
          </Button>
        </RuleDialog>
      ) : null}
      {open === 'overtime' ? (
        <RuleDialog title="Overtime" busy={busy !== null} onClose={close} onSave={save}>
          <Field>
            <FieldLabel>Overtime becomes</FieldLabel>
            <SegmentedControl
              fullWidth
              size="sm"
              value={r.overtime.becomes}
              accessibilityLabel="Overtime becomes"
              onValueChange={(v) => {
                set({
                  overtime: { ...r.overtime, becomes: v as AttendanceRules['overtime']['becomes'] },
                });
              }}
            >
              <SegmentedControlItem value="comp">Comp time</SegmentedControlItem>
              <SegmentedControlItem value="paid">Pay</SegmentedControlItem>
              <SegmentedControlItem value="choose">Manager chooses</SegmentedControlItem>
            </SegmentedControl>
          </Field>
          <NumberField
            label="Paid at (×)"
            size="sm"
            min={1}
            max={3}
            step={0.25}
            value={Number(r.overtime.multiplier)}
            onChange={(n) => {
              set({ overtime: { ...r.overtime, multiplier: (n ?? 1).toFixed(2) } });
            }}
          />
        </RuleDialog>
      ) : null}
    </>
  );
}

interface HolidaySettings {
  readonly year: number;
  readonly layers: readonly {
    key: string;
    name: string;
    level: string;
    weekendRule: string;
    holidays: readonly { date: string; name: string }[];
  }[];
  readonly locations: readonly {
    locationKey: string;
    layerKeys: readonly string[];
    holidays: readonly { date: string; name: string; layer: string }[];
  }[];
}

function Holidays(): React.JSX.Element {
  const thisYear = new Date().getUTCFullYear();
  const [year, setYear] = useState(thisYear);
  const [loc, setLoc] = useState('');
  const [addingDay, setAddingDay] = useState(false);
  const [dayOff, setDayOff] = useState<string | null>(null);
  const [dayName, setDayName] = useState('');
  const { load, reload } = useTimeOff<HolidaySettings>('TimeOffHolidaySettings', { year });
  const { act, busy } = useAct('timeoff');
  const [drafting, setDrafting] = useState<{ layerKey: string; source: string } | null>(null);
  const [source, setSource] = useState('');
  const [layerKey, setLayerKey] = useState<string>('');
  const draft = useTimeOff<{
    layerName: string;
    days: { date: string; name: string; confirmed: boolean }[];
    summary: { text: string };
  } | null>(
    'TimeOffHolidayDraft',
    drafting === null ? { year, layerKey: '', source: '' } : { year, ...drafting },
  );
  if (load.status !== 'ready') {
    return load.status === 'error' ? (
      <Failed message={load.message} onRetry={reload} />
    ) : (
      <Loading label="Loading" />
    );
  }
  const d = load.data;
  const place = d.locations.find((l) => l.locationKey === loc) ?? d.locations[0];
  const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' });
  const dayMonth = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  const layerName = (key: string): string => d.layers.find((l) => l.key === key)?.name ?? key;
  return (
    <>
      {/* Per location (v3 S14): chips with how many days each keeps, the year, then the days. */}
      <View>
        <ChipGroup
          type="single"
          value={place?.locationKey ?? ''}
          onValueChange={setLoc}
          accessibilityLabel="Location"
          scroll
        >
          {d.locations.map((l) => (
            <ChipGroupItem key={l.locationKey} value={l.locationKey}>
              {`${l.locationKey} ${String(l.holidays.length)}`}
            </ChipGroupItem>
          ))}
        </ChipGroup>
      </View>
      <SegmentedControl
        value={String(year)}
        size="sm"
        accessibilityLabel="Year"
        onValueChange={(y) => {
          setYear(Number(y));
        }}
      >
        {[thisYear, thisYear + 1].map((y) => (
          <SegmentedControlItem key={y} value={String(y)}>
            {String(y)}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
      {place === undefined ? null : place.holidays.length === 0 ? (
        <Text tone="muted">{`No holidays for ${place.locationKey} in ${String(year)} yet.`}</Text>
      ) : (
        <List>
          {place.holidays.map((h) => (
            <ListItem
              key={`${h.date}${h.layer}`}
              leading={
                <View className="w-12">
                  <Text variant="footnote" tone="subtle">
                    {weekday.format(new Date(`${h.date}T12:00:00Z`))}
                  </Text>
                  <Text weight="bold">{dayMonth.format(new Date(`${h.date}T12:00:00Z`))}</Text>
                </View>
              }
              description={layerName(h.layer)}
            >
              {h.name}
            </ListItem>
          ))}
        </List>
      )}
      <Button
        startIcon={<Icon icon={Plus} />}
        disabled={place === undefined}
        onPress={() => {
          setAddingDay(true);
        }}
      >
        Add a company day off
      </Button>
      {addingDay && place !== undefined ? (
        <RuleDialog
          title="A company day off"
          busy={busy !== null}
          onClose={() => {
            setAddingDay(false);
          }}
          onSave={() => {
            if (dayOff === null || dayName.trim() === '') return;
            const own = d.layers.find((l) => l.key === 'company-days');
            void (async () => {
              const saved = await act('SaveTimeOffHolidayCalendar', {
                calendarKey: 'company-days',
                input: {
                  name: own?.name ?? 'Company days off',
                  level: own?.level ?? 'city',
                  weekendRule: own?.weekendRule ?? 'none',
                  holidays: [...(own?.holidays ?? []), { date: dayOff, name: dayName.trim() }].sort(
                    (p, q) => p.date.localeCompare(q.date),
                  ),
                },
              });
              if (saved === null) return;
              if (!place.layerKeys.includes('company-days')) {
                const assigned = await act('AssignTimeOffHolidayCalendars', {
                  locationKey: place.locationKey,
                  input: { layerKeys: [...place.layerKeys, 'company-days'] },
                });
                if (assigned === null) return;
              }
              setAddingDay(false);
              setDayOff(null);
              setDayName('');
              reload();
            })();
          }}
        >
          <Field>
            <FieldLabel>Day</FieldLabel>
            <DatePicker label="Day" size="sm" value={dayOff} onChange={setDayOff} />
          </Field>
          <Field>
            <FieldLabel>What it is</FieldLabel>
            <Input
              value={dayName}
              onChange={setDayName}
              size="sm"
              placeholder="Company anniversary"
            />
          </Field>
        </RuleDialog>
      ) : null}
      {place === undefined ? null : (
        <>
          <Heading title={`Calendars ${place.locationKey} keeps`} />
          <View className="flex-row flex-wrap gap-2">
            {d.layers.map((layer) => {
              const on = place.layerKeys.includes(layer.key);
              return (
                <Chip
                  key={layer.key}
                  selected={on}
                  onPress={() => {
                    const next = on
                      ? place.layerKeys.filter((k) => k !== layer.key)
                      : [...place.layerKeys, layer.key];
                    void act(
                      'AssignTimeOffHolidayCalendars',
                      { locationKey: place.locationKey, input: { layerKeys: next } },
                      'Saved',
                    ).then(reload);
                  }}
                >
                  {layer.name}
                </Chip>
              );
            })}
          </View>
        </>
      )}
      <Text variant="footnote" weight="semibold" tone="muted" className="px-1">
        Calendars
      </Text>
      <List>
        {d.layers.map((layer) => (
          <ListItem
            key={layer.key}
            description={`${layer.level} · ${String(layer.holidays.length)} days${layer.weekendRule === 'move_to_monday' ? ' · weekend days move to Monday' : ''}`}
            trailing={
              <Button
                size="sm"
                variant="ghost"
                startIcon={<Icon icon={Trash2} />}
                accessibilityLabel={`Remove ${layer.name}`}
                onPress={() => {
                  void act(
                    'RemoveTimeOffHolidayCalendar',
                    { calendarKey: layer.key },
                    'Removed',
                  ).then(reload);
                }}
              />
            }
          >
            {layer.name}
          </ListItem>
        ))}
      </List>
      <Card>
        <Stack gap={2}>
          <CardTitle>{`Draft a year from the official list`}</CardTitle>
          <Select value={layerKey} onValueChange={setLayerKey}>
            <SelectTrigger size="sm" accessibilityLabel="Calendar">
              <SelectValue placeholder="Which calendar" />
            </SelectTrigger>
            <SelectContent>
              {d.layers.map((l) => (
                <SelectItem key={l.key} value={l.key}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea value={source} onChange={setSource} placeholder="Paste the official list" />
          <Button
            disabled={layerKey === '' || source.trim() === ''}
            onPress={() => {
              setDrafting({ layerKey, source: source.slice(0, 4000) });
            }}
          >
            Draft it
          </Button>
          {drafting === null ? null : draft.load.status === 'loading' ? (
            <Loading label="Drafting" />
          ) : draft.load.status === 'error' ? (
            <Alert tone="danger">{draft.load.message}</Alert>
          ) : draft.load.data === null ? null : (
            <>
              <Text>{draft.load.data.summary.text}</Text>
              <List>
                {draft.load.data.days.map((day) => (
                  <ListItem
                    key={day.date}
                    description={shortDate(day.date)}
                    trailing={
                      day.confirmed ? undefined : (
                        <Badge size="sm" tone="warning">
                          Not confirmed
                        </Badge>
                      )
                    }
                  >
                    {day.name}
                  </ListItem>
                ))}
              </List>
              <Button
                variant="primary"
                loading={busy === 'SaveTimeOffHolidayCalendar'}
                onPress={() => {
                  const layer = d.layers.find((l) => l.key === drafting.layerKey);
                  const days =
                    draft.load.status === 'ready' && draft.load.data !== null
                      ? draft.load.data.days.filter((x) => x.confirmed)
                      : [];
                  if (layer === undefined) return;
                  const kept = layer.holidays.filter((h) => !h.date.startsWith(String(year)));
                  void act(
                    'SaveTimeOffHolidayCalendar',
                    {
                      calendarKey: layer.key,
                      input: {
                        name: layer.name,
                        level: layer.level,
                        weekendRule: layer.weekendRule,
                        holidays: [
                          ...kept,
                          ...days.map((x) => ({ date: x.date, name: x.name })),
                        ].sort((p, q) => p.date.localeCompare(q.date)),
                      },
                    },
                    'Calendar saved',
                  ).then(() => {
                    setDrafting(null);
                    setSource('');
                    reload();
                  });
                }}
              >
                Save the confirmed days
              </Button>
            </>
          )}
        </Stack>
      </Card>
    </>
  );
}

interface Integrations {
  readonly integrations: readonly {
    provider: 'google' | 'microsoft' | 'slack' | 'teams';
    kind: string;
    available: boolean;
    configured: boolean;
    connected: boolean;
    account: string | null;
  }[];
  readonly kiosks: readonly {
    id: string;
    name: string;
    locationKey: string;
    lastSeenAt: string | null;
    revokedAt: string | null;
  }[];
  readonly locations: readonly { locationKey: string; name: string }[];
}

const PROVIDER: Record<string, string> = {
  google: 'Google Calendar',
  microsoft: 'Microsoft 365',
  slack: 'Slack',
  teams: 'Microsoft Teams',
};

function Integrations(): React.JSX.Element {
  const signed = useSigned();
  const { load, reload } = useTimeOff<Integrations>('TimeOffIntegrations');
  const { act, busy } = useAct('timeoff');
  const [registering, setRegistering] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  if (load.status !== 'ready') {
    return load.status === 'error' ? (
      <Failed message={load.message} onRetry={reload} />
    ) : (
      <Loading label="Loading" />
    );
  }
  const d = load.data;
  return (
    <>
      <List>
        {d.integrations.map((i) => (
          <ListItem
            key={i.provider}
            icon={Plug}
            description={
              i.connected
                ? `Connected${i.account === null ? '' : ` · ${i.account}`}`
                : i.available
                  ? 'Not connected'
                  : 'Not set up in this deployment'
            }
            trailing={
              i.connected ? (
                <Button
                  size="sm"
                  variant="danger-soft"
                  onPress={() => {
                    void act(
                      'DisconnectTimeOffIntegration',
                      { provider: i.provider },
                      'Disconnected',
                    ).then(reload);
                  }}
                >
                  Disconnect
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={!i.available}
                  loading={busy === 'ConnectTimeOffIntegration'}
                  onPress={() => {
                    void act<{ url: string | null }>('ConnectTimeOffIntegration', {
                      provider: i.provider,
                      input: { back: `${signed.company.origin}/settings/time-off/integrations` },
                    }).then(async (r) => {
                      if (r?.url != null) await WebBrowser.openBrowserAsync(r.url);
                      reload();
                    });
                  }}
                >
                  Connect
                </Button>
              )
            }
          >
            {PROVIDER[i.provider] ?? i.provider}
          </ListItem>
        ))}
      </List>
      <Text variant="footnote" weight="semibold" tone="muted" className="px-1">
        Kiosks at the door
      </Text>
      {token === null ? null : (
        <Alert tone="warning" title="Copy the kiosk’s code now">
          <Stack gap={2}>
            <Text>It is shown once. Enter it on the kiosk to pair it.</Text>
            <CopyField value={token} label="Copy the kiosk code" mono />
          </Stack>
        </Alert>
      )}
      {d.kiosks.length === 0 ? (
        <EmptyState
          icon={Monitor}
          title="No kiosks"
          description="A tablet at the door people clock in on."
        />
      ) : (
        <List>
          {d.kiosks.map((k) => (
            <ListItem
              key={k.id}
              icon={Monitor}
              description={[
                d.locations.find((l) => l.locationKey === k.locationKey)?.name ?? k.locationKey,
                k.revokedAt !== null
                  ? 'Revoked'
                  : k.lastSeenAt === null
                    ? 'Never seen'
                    : `Seen ${shortDate(k.lastSeenAt.slice(0, 10))}`,
              ].join(' · ')}
              {...(k.revokedAt === null
                ? {
                    trailing: (
                      <Button
                        size="sm"
                        variant="ghost"
                        onPress={() => {
                          void act('RevokeTimeOffKiosk', { deviceId: k.id }, 'Revoked').then(
                            reload,
                          );
                        }}
                      >
                        Revoke
                      </Button>
                    ),
                  }
                : {})}
            >
              {k.name}
            </ListItem>
          ))}
        </List>
      )}
      <Button
        startIcon={<Icon icon={Plus} />}
        onPress={() => {
          setRegistering(true);
        }}
      >
        Add a kiosk
      </Button>
      {registering ? (
        <RegisterKiosk
          locations={d.locations}
          onClose={() => {
            setRegistering(false);
          }}
          onDone={(t) => {
            setRegistering(false);
            setToken(t);
            reload();
          }}
        />
      ) : null}
    </>
  );
}

function RegisterKiosk({
  locations,
  onClose,
  onDone,
}: {
  locations: Integrations['locations'];
  onClose: () => void;
  onDone: (token: string) => void;
}): React.JSX.Element {
  const { act, busy } = useAct('timeoff');
  const [name, setName] = useState('');
  const [location, setLocation] = useState(locations[0]?.locationKey ?? '');
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a kiosk</DialogTitle>
          <DialogDescription>Its code is shown once, to pair the tablet.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field required>
            <FieldLabel>Name</FieldLabel>
            <Input value={name} onChange={setName} size="sm" placeholder="Madrid front door" />
          </Field>
          <Select value={location} onValueChange={setLocation}>
            <SelectTrigger size="sm" accessibilityLabel="Location">
              <SelectValue placeholder="Where it is" />
            </SelectTrigger>
            <SelectContent>
              {locations.map((l) => (
                <SelectItem key={l.locationKey} value={l.locationKey}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            disabled={name.trim() === '' || location === ''}
            loading={busy === 'RegisterTimeOffKiosk'}
            onPress={() => {
              void act<{ deviceId: string; token: string }>('RegisterTimeOffKiosk', {
                input: { name: name.trim(), locationKey: location },
              }).then((r) => {
                if (r !== null) onDone(r.token);
              });
            }}
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
