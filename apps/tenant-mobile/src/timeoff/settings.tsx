import {
  Alert,
  Badge,
  Button,
  Card,
  CardTitle,
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
  FieldLabel,
  Icon,
  Input,
  List,
  ListItem,
  NumberField,
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
  Tags,
  Trash2,
} from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useState } from 'react';
import { View } from 'react-native';

import { Failed, Loading, Page } from '../frame';
import { useAct } from '../people/act';
import { useSigned } from '../people/api';
import type { PeopleScreen } from '../people/routes';
import { useTimeOff } from './api';
import { leaveIcon } from './icons';
import { todayHere } from './time';
import { amount, shortDate } from './words';

type Section =
  'leave-types' | 'negative' | 'approvals' | 'attendance' | 'holidays' | 'integrations';

const SECTIONS: readonly { key: Section; label: string; line: string; icon: typeof Tags }[] = [
  {
    key: 'leave-types',
    label: 'Leave types and policies',
    line: 'What people can take, and how much',
    icon: Tags,
  },
  {
    key: 'negative',
    label: 'Going below zero',
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
    label: 'Attendance rules',
    line: 'Breaks, rest, weekly limits and overtime',
    icon: Clock3,
  },
  {
    key: 'holidays',
    label: 'Holiday calendars',
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

export const CATEGORIES = [
  ['annual_leave', 'Vacation', 'sun'],
  ['sick_leave', 'Sick leave', 'thermometer'],
  ['parental_leave', 'Parental leave', 'baby'],
  ['unpaid_leave', 'Unpaid leave', 'circle-slash'],
  ['other', 'Something else', 'flag'],
] as const;

export const keyOf = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

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
      <Button variant="primary" startIcon={<Icon icon={Plus} />} onPress={onAdd}>
        Add a leave type
      </Button>
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
      <Text tone="muted">{`Applies in ${[...d.places.countries, ...d.places.locations].join(', ') || 'every place'}`}</Text>
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
  return (
    <>
      <Card>
        <Stack gap={3}>
          <View className="flex-row items-center gap-2">
            <CardTitle className="flex-1">{`Version ${String(shown.version)}`}</CardTitle>
            <Badge size="sm" tone={draft === undefined ? 'success' : 'warning'}>
              {draft === undefined
                ? `In effect${shown.effectiveFrom === null ? '' : ` from ${shortDate(shown.effectiveFrom)}`}`
                : 'Draft'}
            </Badge>
          </View>
          <NumberField
            label="Days a year"
            size="sm"
            min={0}
            max={365}
            step={0.5}
            value={allowance ?? Number(first?.days ?? '0')}
            onChange={setAllowance}
          />
          {def.allowance.length > 1 ? (
            <Text variant="footnote" tone="muted">
              {def.allowance
                .slice(1)
                .map((a) => `${amount(a.days)} from ${String(a.fromYears)} years`)
                .join(' · ')}
            </Text>
          ) : null}
          <NumberField
            label="Carried over, at most"
            size="sm"
            min={0}
            max={365}
            step={0.5}
            value={carry ?? Number(def.carryOver?.maxDays ?? '0')}
            onChange={setCarry}
          />
          <NumberField
            label="Probation, months"
            size="sm"
            min={0}
            max={24}
            value={probation ?? def.probationMonths}
            onChange={setProbation}
          />
          <Text
            variant="footnote"
            tone="muted"
          >{`Earned ${def.earning === 'monthly' ? 'month by month' : 'up front'}.`}</Text>
          <View className="flex-row gap-2">
            <Button
              className="flex-1"
              variant="primary"
              disabled={!changed}
              loading={busy === 'ReviseTimeOffPolicy' || busy === 'DraftTimeOffPolicy'}
              onPress={() => {
                void (
                  draft === undefined
                    ? act('DraftTimeOffPolicy', { input: revised }, 'Saved as a draft')
                    : act('ReviseTimeOffPolicy', { policyId, input: revised }, 'Draft saved')
                ).then((done) => {
                  if (done === null) return;
                  setAllowance(null);
                  setCarry(null);
                  setProbation(null);
                  onChanged();
                  preview.reload();
                });
              }}
            >
              Save draft
            </Button>
            <Button className="flex-1" onPress={onDescribe}>
              Describe in words
            </Button>
          </View>
        </Stack>
      </Card>
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
  return (
    <>
      <Text tone="muted">
        How far below zero people may go on each balance, who approves it, and what happens to it
        after.
      </Text>
      <List>
        {load.data.policies.map((p) => (
          <ListItem
            key={p.policyId}
            description={
              p.rule === null ? 'Nobody may go below zero' : `Up to ${amount(p.rule.limit)} days`
            }
            chevron
            onPress={() => {
              setEditing(p.policyId);
            }}
          >
            {p.leaveTypeName}
          </ListItem>
        ))}
      </List>
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
  if (load.status !== 'ready') {
    return load.status === 'error' ? (
      <Failed message={load.message} onRetry={reload} />
    ) : (
      <Loading label="Loading" />
    );
  }
  const d = load.data;
  const a = auto ?? d.autoApproval;
  const changedTeams = d.teams.filter(
    (t) => t.teamKey in mins && JSON.stringify(mins[t.teamKey]) !== JSON.stringify(t.minimum),
  );
  return (
    <>
      <Text variant="footnote" weight="semibold" tone="muted" className="px-1">
        Who approves
      </Text>
      <List>
        {d.rules.map((r, i) => (
          <ListItem
            key={`${r.subject}${String(i)}`}
            description={`${r.when === 'always' ? 'Always' : r.when === 'below_zero' ? 'Below zero' : 'Unpaid'}${r.leaveTypes === null ? '' : ` · ${r.leaveTypes.join(', ')}`}`}
          >
            {`${r.subject === 'request' ? 'Requests' : r.subject === 'plan' ? 'Parental plans' : 'Timesheets'}: ${r.approvers.map((x) => APPROVER[x] ?? x).join(', then ')}`}
          </ListItem>
        ))}
      </List>
      <Text variant="footnote" weight="semibold" tone="muted" className="px-1">
        Approved without asking
      </Text>
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
      <Text variant="footnote" weight="semibold" tone="muted" className="px-1">
        Team minimums
      </Text>
      {d.teams.map((t) => {
        const m = t.teamKey in mins ? mins[t.teamKey] : t.minimum;
        return (
          <View key={t.teamKey} className="flex-row items-center gap-2">
            <Text className="flex-1">{t.teamName}</Text>
            <View style={{ width: 140 }}>
              <NumberField
                label={`${t.teamName}: at least`}
                hideLabel
                size="sm"
                min={0}
                value={m?.atLeast ?? null}
                onChange={(n) => {
                  setMins((all) => ({
                    ...all,
                    [t.teamKey]: n === null ? null : { atLeast: n, unit: m?.unit ?? 'people' },
                  }));
                }}
              />
            </View>
            <SegmentedControl
              size="sm"
              value={m?.unit ?? 'people'}
              accessibilityLabel={`${t.teamName}: unit`}
              onValueChange={(u) => {
                setMins((all) => ({
                  ...all,
                  [t.teamKey]: {
                    atLeast: m?.atLeast ?? 1,
                    unit: u === 'percent' ? 'percent' : 'people',
                  },
                }));
              }}
            >
              <SegmentedControlItem value="people">In</SegmentedControlItem>
              <SegmentedControlItem value="percent">%</SegmentedControlItem>
            </SegmentedControl>
          </View>
        );
      })}
      <Button
        variant="primary"
        disabled={auto === null && changedTeams.length === 0}
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
            for (const t of changedTeams) {
              const done = await act('SetTimeOffTeamMinimum', {
                teamKey: t.teamKey,
                input: { minimum: mins[t.teamKey] ?? null },
              });
              if (done === null) return;
            }
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
}

function Attendance(): React.JSX.Element {
  const { load, reload } = useTimeOff<{ defaultSchedule: string | null; rules: AttendanceRules }>(
    'TimeOffAttendanceSettings',
  );
  const { act, busy } = useAct('timeoff');
  const [rules, setRules] = useState<AttendanceRules | null>(null);
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
  return (
    <>
      <Text tone="muted">What the working-time law asks for, and what overtime becomes.</Text>
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
      <Button
        variant="primary"
        disabled={rules === null}
        loading={busy === 'SetTimeOffAttendanceRules'}
        onPress={() => {
          void act('SetTimeOffAttendanceRules', { input: r }, 'Saved').then(() => {
            setRules(null);
            reload();
          });
        }}
      >
        Save
      </Button>
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
  const [year, setYear] = useState(new Date().getUTCFullYear());
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
  return (
    <>
      <SegmentedControl
        fullWidth
        value={String(year)}
        accessibilityLabel="Year"
        onValueChange={(y) => {
          setYear(Number(y));
        }}
      >
        {[year - 1, year, year + 1].map((y) => (
          <SegmentedControlItem key={y} value={String(y)}>
            {String(y)}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
      <Text variant="footnote" weight="semibold" tone="muted" className="px-1">
        Where people work
      </Text>
      {d.locations.map((l) => (
        <Card key={l.locationKey}>
          <Stack gap={2}>
            <CardTitle>{l.locationKey}</CardTitle>
            <Text
              variant="footnote"
              tone="muted"
            >{`${String(l.holidays.length)} holidays in ${String(year)}`}</Text>
            <View className="flex-row flex-wrap gap-2">
              {d.layers.map((layer) => {
                const on = l.layerKeys.includes(layer.key);
                return (
                  <Button
                    key={layer.key}
                    size="sm"
                    variant={on ? 'primary' : 'secondary'}
                    loading={busy === 'AssignTimeOffHolidayCalendars'}
                    onPress={() => {
                      const next = on
                        ? l.layerKeys.filter((k) => k !== layer.key)
                        : [...l.layerKeys, layer.key];
                      void act(
                        'AssignTimeOffHolidayCalendars',
                        { locationKey: l.locationKey, input: { layerKeys: next } },
                        'Saved',
                      ).then(reload);
                    }}
                  >
                    {layer.name}
                  </Button>
                );
              })}
            </View>
          </Stack>
        </Card>
      ))}
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
