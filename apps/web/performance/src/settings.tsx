import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  RadioCard,
  RadioGroup,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  FieldLabel,
  Input,
  NumberField,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded } from './load';
import {
  Choose,
  Modal,
  PersonPicker,
  Refusal,
  SwitchRow,
  day,
  download,
  plural,
  useAct,
  when,
} from './shared';
import type { ScaleOption, ScreenProps } from './types';

/**
 * Settings › Performance (PRD §21; design S1–S13 v2): one page per part, each
 * saved whole and checked by Performance; the activity log, the AI log, and
 * the tools each person lets Kithena read for their own reviews.
 */

type Json = string | number | boolean | null | readonly Json[] | { readonly [k: string]: Json };
type Obj = { readonly [k: string]: Json };

export interface SettingsData {
  /** Which page: the last part of its address, `general`, `feedback`… */
  readonly page?: string;
  readonly settings: Readonly<Record<string, Obj>>;
  readonly admin: boolean;
  readonly hr: boolean;
  readonly model: boolean;
  readonly templates: readonly {
    readonly id: string;
    readonly name: string;
    readonly purpose: readonly string[];
  }[];
  readonly hrPeople: readonly { readonly personId: string; readonly name: string }[];
  readonly legalEntities: readonly string[];
}

/** Each page of the settings, from its address, and the stored sections it edits. */
const PAGES: Readonly<
  Record<
    string,
    {
      readonly title: string;
      readonly description: string;
      readonly section: string;
      readonly only?: readonly string[];
    }
  >
> = {
  general: {
    title: 'General',
    description: 'The company’s rating scale and the parts of Performance it uses.',
    section: 'general',
  },
  release: {
    title: 'Release',
    description:
      'The defaults a new cycle starts from: who releases, the response minimum, acknowledgement.',
    section: 'reviews',
  },
  feedback: {
    title: 'Feedback',
    description: 'Who may give feedback, whether names are shown, praise and its company values.',
    section: 'feedback',
  },
  goals: {
    title: 'Goals',
    description: 'Goal periods, their check-in cadence, and whether goals are weighted.',
    section: 'goals',
  },
  learning: {
    title: 'Learning',
    description: 'Learning platforms and the attendance share that completes a session.',
    section: 'learning',
  },
  calibration: {
    title: 'Calibration',
    description: 'The nine-box guide and who sees what in a session.',
    section: 'calibration',
  },
  ai: {
    title: 'AI',
    description:
      'Each AI feature, on or off. Every output is logged; a person confirms every number.',
    section: 'ai',
  },
  connections: {
    title: 'Connections',
    description: 'Calendars, chat and the tools people may let Kithena read for their reviews.',
    section: 'integrations',
  },
  retention: {
    title: 'Retention',
    description: 'How long each kind of record is kept after someone leaves, and legal holds.',
    section: 'privacy',
    only: ['retention', 'holds'],
  },
  'works-councils': {
    title: 'Works councils',
    description: 'Where a works council has agreed to Performance, and to which parts.',
    section: 'privacy',
    only: ['worksCouncil'],
  },
  access: {
    title: 'Access',
    description: 'Who is HR to Performance, beyond the company’s administrators.',
    section: 'roles',
  },
};

const OPTIONS: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  release: [
    ['close', 'When the cycle closes, after calibration'],
    ['hr_date', 'On a date HR sets'],
    ['manager', 'As each is submitted'],
  ],
  who: [
    ['anyone', 'Anyone, to anyone'],
    ['team', 'Within their team'],
    ['nobody', 'Nobody: feedback is off'],
  ],
  sees: [
    ['recipient', 'Only the receiver'],
    ['recipient_manager', 'The receiver and their manager'],
    ['recipient_manager_hr', 'The receiver, their manager and HR'],
  ],
  names: [
    ['never', 'Always hidden'],
    ['always', 'Always shown'],
    ['writer', 'The writer chooses'],
  ],
};

const words = (key: string): string => {
  const spaced = key.replaceAll(/([A-Z])/gu, ' $1').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

const isObj = (v: Json): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isList = (v: Json): v is readonly Json[] => Array.isArray(v);

export function Settings(props: ScreenProps<SettingsData>): JSX.Element {
  return (
    <Loaded load={props.load} what="Performance’s settings">
      {(data) => (
        <SettingsPage
          key={data.page ?? 'general'}
          page={data.page ?? 'general'}
          data={data}
          {...props}
        />
      )}
    </Loaded>
  );
}

function SettingsPage({
  page,
  data,
  ...props
}: ScreenProps<SettingsData> & {
  readonly page: string;
  readonly data: SettingsData;
}): JSX.Element {
  const act = useAct(props);
  const meta = PAGES[page] ?? PAGES['general'];
  const section = meta?.section ?? 'general';
  const [value, setValue] = useState<Obj>(data.settings[section] ?? {});
  const [saved, setSaved] = useState(false);
  const set = (key: string, v: Json): void => {
    setValue({ ...value, [key]: v });
    setSaved(false);
  };
  const keys = Object.keys(value).filter((k) => meta?.only === undefined || meta.only.includes(k));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={meta?.title ?? 'Settings'}
        description={meta?.description ?? ''}
        actions={
          data.admin ? (
            <Button
              loading={act.pending}
              onClick={() => {
                act.run('SavePerformanceSettings', { section, input: value }, () => {
                  setSaved(true);
                });
              }}
            >
              Save
            </Button>
          ) : null
        }
      />
      <Refusal error={act.error} />
      {saved ? (
        <Alert tone="success" title="Saved">
          New cycles, feedback and goals follow it from now on.
        </Alert>
      ) : null}
      {data.admin ? null : (
        <Alert tone="info" title="Read only">
          Only an administrator changes Performance’s settings.
        </Alert>
      )}
      {section === 'ai' && !data.model ? (
        <Alert tone="warning" title="No model is connected">
          Every AI feature is unavailable until one is, whatever these say.
        </Alert>
      ) : null}
      <Card>
        <CardContent className="flex flex-col gap-4">
          {keys.map((k) => (
            <Value
              key={k}
              name={k}
              value={value[k] ?? null}
              onChange={(v) => {
                set(k, v);
              }}
              disabled={!data.admin}
              data={data}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/** One stored value, drawn by its shape. */
function Value({
  name,
  value,
  onChange,
  disabled,
  data,
}: {
  readonly name: string;
  readonly value: Json;
  readonly onChange: (v: Json) => void;
  readonly disabled: boolean;
  readonly data: SettingsData;
}): JSX.Element | null {
  if (typeof value === 'boolean')
    return (
      <SwitchRow label={words(name)} checked={value} disabled={disabled} onChange={onChange} />
    );
  if (typeof value === 'number')
    return (
      <NumberField
        label={words(name)}
        value={value}
        disabled={disabled}
        onChange={(v) => {
          if (v !== null) onChange(v);
        }}
      />
    );
  if (typeof value === 'string') {
    const options = OPTIONS[name];
    if (options !== undefined)
      return <Choose label={words(name)} value={value} options={options} onChange={onChange} />;
    return (
      <Field>
        <FieldLabel>{words(name)}</FieldLabel>
        <Input
          value={value}
          disabled={disabled}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
      </Field>
    );
  }
  if (name === 'scale' && isList(value))
    return (
      <Scale
        value={value as unknown as readonly ScaleOption[]}
        disabled={disabled}
        onChange={(s) => {
          onChange(s as unknown as Json);
        }}
      />
    );
  if (name === 'hr' && isList(value))
    return (
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold">HR to Performance</p>
        <p className="text-sm">
          {data.hrPeople.length === 0
            ? 'Only the company’s administrators.'
            : data.hrPeople.map((p) => p.name).join(', ')}
        </p>
      </div>
    );
  if (isList(value)) {
    if (value.every((v) => typeof v === 'string'))
      return (
        <Field>
          <FieldLabel>{words(name)}</FieldLabel>
          <Input
            value={value.join(', ')}
            disabled={disabled}
            onChange={(e) => {
              onChange(
                e.target.value
                  .split(',')
                  .map((x) => x.trim())
                  .filter(Boolean),
              );
            }}
          />
        </Field>
      );
    return (
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold">{words(name)}</p>
        {value.length === 0 ? (
          <p className="text-sm text-fg-muted">None</p>
        ) : (
          value.map((v, i) => (
            <p key={`${name}-${String(i)}`} className="text-sm">
              {isObj(v)
                ? Object.values(v)
                    .filter((x) => typeof x !== 'object')
                    .map(String)
                    .join(' · ')
                : JSON.stringify(v)}
            </p>
          ))
        )}
      </div>
    );
  }
  if (isObj(value))
    return (
      <div className="flex flex-col gap-4 border-t border-[var(--reach-line)] pt-4">
        <p className="text-sm font-semibold">{words(name)}</p>
        {Object.entries(value).map(([k, v]) => (
          <Value
            key={k}
            name={k}
            value={v}
            disabled={disabled}
            data={data}
            onChange={(x) => {
              onChange({ ...value, [k]: x });
            }}
          />
        ))}
      </div>
    );
  return null;
}

function Scale({
  value,
  disabled,
  onChange,
}: {
  readonly value: readonly ScaleOption[];
  readonly disabled: boolean;
  readonly onChange: (s: readonly ScaleOption[]) => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold">Rating scale</p>
      <p className="text-sm text-fg-muted">
        Every performance score is computed on this scale. Changing it changes no score already
        submitted.
      </p>
      {value.map((o, i) => (
        <div
          key={`${String(o.value)}-${String(i)}`}
          className="grid max-w-3xl grid-cols-[5rem_minmax(0,14rem)_minmax(0,1fr)] items-end gap-3 touch:grid-cols-1"
        >
          <NumberField
            hideSteppers
            label="Value"
            value={o.value}
            disabled={disabled}
            onChange={(v) => {
              if (v !== null) onChange(value.map((x, j) => (j === i ? { ...x, value: v } : x)));
            }}
          />
          <Field>
            <FieldLabel>Label</FieldLabel>
            <Input
              value={o.label}
              disabled={disabled}
              onChange={(e) => {
                onChange(value.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)));
              }}
            />
          </Field>
          <Field>
            <FieldLabel>Description</FieldLabel>
            <Input
              value={o.description ?? ''}
              disabled={disabled}
              onChange={(e) => {
                onChange(
                  value.map((x, j) =>
                    j === i
                      ? { ...x, description: e.target.value === '' ? null : e.target.value }
                      : x,
                  ),
                );
              }}
            />
          </Field>
        </div>
      ))}
    </div>
  );
}

export interface AiLogData {
  readonly rows: readonly {
    readonly id: string;
    readonly at: string;
    readonly feature: string;
    readonly for: string;
    readonly on: string;
    readonly prompt: string;
    readonly outcome: string;
    readonly model: string;
  }[];
}

/** S7b: every AI output, for whom, on what and with which prompt version. */
export function AiLog(props: ScreenProps<AiLogData>): JSX.Element {
  return (
    <Loaded load={props.load} what="the AI log">
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title="AI log"
            description="Each time AI wrote, suggested or checked something: the feature, for whom, the prompt version and what became of it."
          />
          <Card>
            <CardContent className="overflow-x-auto">
              {data.rows.length === 0 ? (
                <EmptyState
                  icon={<icons.assistant aria-hidden />}
                  title="No AI output yet"
                  description="Summaries, suggestions and checks are logged here."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Feature</TableHead>
                      <TableHead>For</TableHead>
                      <TableHead>On</TableHead>
                      <TableHead>Prompt</TableHead>
                      <TableHead>Outcome</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap text-sm">{when(r.at)}</TableCell>
                        <TableCell className="text-sm">{words(r.feature)}</TableCell>
                        <TableCell className="text-sm">{r.for}</TableCell>
                        <TableCell className="text-sm">{r.on}</TableCell>
                        <TableCell className="text-sm text-fg-muted">{`v${r.prompt} · ${r.model}`}</TableCell>
                        <TableCell className="text-sm">{words(r.outcome)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </Loaded>
  );
}

export interface ConnectedToolsData {
  readonly sources: readonly {
    readonly source: string;
    readonly on: boolean;
    readonly at: string | null;
  }[];
  readonly reads: readonly {
    readonly source: string;
    readonly at: string;
    readonly purpose: string;
  }[];
}

const SOURCE: Readonly<Record<string, string>> = {
  slack: 'Slack',
  teams: 'Microsoft Teams',
  gchat: 'Google Chat',
  meet: 'Google Meet',
  github: 'GitHub',
  gitlab: 'GitLab',
  linear: 'Linear',
  jira: 'Jira',
  confluence: 'Confluence',
};

/** S12: what I let Kithena read of my own work, each on or off, and every read. */
export function ConnectedTools(props: ScreenProps<ConnectedToolsData>): JSX.Element {
  const act = useAct(props);
  return (
    <Loaded load={props.load} what="your connected tools">
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title="My connected tools"
            description="What Kithena may read of your own work to suggest evidence for reviews about you and by you. Off stops it at once and drops what was read."
          />
          <Refusal error={act.error} />
          <Card>
            <CardContent className="flex flex-col">
              {data.sources.map((s) => (
                <SwitchRow
                  key={s.source}
                  label={SOURCE[s.source] ?? s.source}
                  hint={
                    s.at === null ? 'Never turned on' : `${s.on ? 'On' : 'Off'} since ${when(s.at)}`
                  }
                  checked={s.on}
                  disabled={act.pending}
                  onChange={(on) => {
                    act.run('SetPerformanceGrant', { source: s.source, input: { on } });
                  }}
                />
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle level={2}>Recent reads</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm">
              {data.reads.length === 0 ? (
                <p className="text-fg-muted">Nothing has been read.</p>
              ) : (
                data.reads.map((r) => (
                  <p
                    key={`${r.source}-${r.at}`}
                  >{`${when(r.at)} · ${SOURCE[r.source] ?? r.source} · ${r.purpose}`}</p>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </Loaded>
  );
}

/* ---------------------------------------------------------- retention -- */

type Rule = Readonly<Record<string, number>>;

export interface RetentionData {
  readonly rule: Rule;
  readonly privacy: Obj;
  readonly admin: boolean;
  readonly kinds: readonly { readonly kind: string; readonly label: string }[];
  readonly holds: readonly {
    readonly personId: string;
    readonly name: string;
    readonly reason: string;
    readonly at: string;
  }[];
  readonly due: readonly {
    readonly personId: string;
    readonly name: string;
    readonly leftOn: string;
    readonly what: readonly {
      readonly kind: string;
      readonly label: string;
      readonly count: number;
    }[];
  }[];
  readonly upcoming: readonly {
    readonly personId: string;
    readonly name: string;
    readonly leftOn: string;
    readonly next: string;
  }[];
}

const YEARS_OF: Readonly<Record<string, string>> = {
  reviews: 'reviewsYears',
  feedback: 'feedbackYears',
  notes: 'notesYears',
  learning: 'learningYears',
  ai: 'aiYears',
};

/**
 * S10 (PRD §30): how long each kind of record is kept after someone leaves,
 * what is due to go now, for HR to confirm, legal holds, and a person's data
 * for their request.
 */
export function Retention(props: ScreenProps<RetentionData>): JSX.Element {
  const act = useAct(props);
  return (
    <Loaded load={props.load} what="retention">
      {(data) => <RetentionPage data={data} act={act} />}
    </Loaded>
  );
}

function RetentionPage({
  data,
  act,
}: {
  readonly data: RetentionData;
  readonly act: ReturnType<typeof useAct>;
}): JSX.Element {
  const [rule, setRule] = useState<Rule>(data.rule);
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [holding, setHolding] = useState(false);
  const [holdFor, setHoldFor] = useState<readonly string[]>([]);
  const [reason, setReason] = useState('');
  const [whose, setWhose] = useState<readonly string[]>([]);
  const changed = Object.keys(rule).some((k) => rule[k] !== data.rule[k]);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Retention"
        description="How long each kind of record is kept after someone leaves. Nothing is deleted until HR confirms, and a legal hold keeps everything of the person it names."
      />
      <Refusal error={act.error} />
      <Card>
        <CardHeader>
          <CardTitle level={2}>After someone leaves</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-4">
            {data.kinds.map((k) => {
              const key = YEARS_OF[k.kind] ?? k.kind;
              return (
                <NumberField
                  key={k.kind}
                  label={k.label}
                  suffix="years"
                  min={1}
                  max={30}
                  value={rule[key] ?? null}
                  disabled={!data.admin}
                  onChange={(v) => {
                    setRule({ ...rule, [key]: v ?? 1 });
                  }}
                />
              );
            })}
          </div>
          <p className="text-sm text-fg-muted">
            A leaver’s own notes go 30 days after their last day, whatever is set here.
          </p>
          {data.admin ? (
            <Button
              className="self-start"
              disabled={!changed}
              loading={act.pending}
              onClick={() => {
                act.run('SavePerformanceSettings', {
                  section: 'privacy',
                  input: { ...data.privacy, retention: rule },
                });
              }}
            >
              Save
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle level={2}>Due to go</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 overflow-x-auto">
          {data.due.length === 0 ? (
            <EmptyState
              icon={<icons.archive aria-hidden />}
              title="Nothing is due"
              description="Records appear here once their time after someone leaves has passed."
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <span className="sr-only">Choose</span>
                    </TableHead>
                    <TableHead>Person</TableHead>
                    <TableHead>Left</TableHead>
                    <TableHead>What goes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.due.map((d) => (
                    <TableRow key={d.personId}>
                      <TableCell>
                        <Checkbox
                          aria-label={`Delete ${d.name}’s due records`}
                          checked={chosen.includes(d.personId)}
                          onCheckedChange={(on) => {
                            setChosen(
                              on === true
                                ? [...chosen, d.personId]
                                : chosen.filter((x) => x !== d.personId),
                            );
                          }}
                        />
                      </TableCell>
                      <TableCell>{d.name}</TableCell>
                      <TableCell>{day(d.leftOn)}</TableCell>
                      <TableCell className="text-sm">
                        {d.what.map((w) => `${w.label}: ${String(w.count)}`).join(' · ')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Button
                className="self-start"
                variant="destructive"
                disabled={chosen.length === 0}
                onClick={() => {
                  setConfirming(true);
                }}
              >
                {chosen.length === 0
                  ? 'Delete'
                  : `Delete ${plural(chosen.length, 'person’s', 'people’s')} records`}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle level={2}>Legal holds</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {data.holds.length === 0 ? (
            <p className="text-sm text-fg-muted">No one’s records are held.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Why</TableHead>
                  <TableHead>Since</TableHead>
                  <TableHead>
                    <span className="sr-only">Lift</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.holds.map((h) => (
                  <TableRow key={h.personId}>
                    <TableCell>{h.name}</TableCell>
                    <TableCell className="text-sm">{h.reason}</TableCell>
                    <TableCell>{day(h.at)}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={act.pending}
                        onClick={() => {
                          act.run('LiftPerformanceHold', {
                            id: h.personId,
                            input: { reason: null },
                          });
                        }}
                      >
                        Lift
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Button
            className="self-start"
            variant="secondary"
            startIcon={<icons.add aria-hidden />}
            onClick={() => {
              setHolding(true);
            }}
          >
            Place a hold
          </Button>
        </CardContent>
      </Card>

      {data.upcoming.length === 0 ? null : (
        <Card>
          <CardHeader>
            <CardTitle level={2}>Coming up</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Left</TableHead>
                  <TableHead>Next due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.upcoming.map((u) => (
                  <TableRow key={u.personId}>
                    <TableCell>{u.name}</TableCell>
                    <TableCell>{day(u.leftOn)}</TableCell>
                    <TableCell>{day(u.next)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle level={2}>A person’s data</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-fg-muted">
            For a request to see or take their data: everything about them in Performance, without
            the private questions about them or the names of anyone who wrote in confidence.
          </p>
          <PersonPicker act={act} label="Whose data" value={whose} onChange={setWhose} />
          <Button
            className="self-start"
            variant="secondary"
            startIcon={<icons.download aria-hidden />}
            disabled={whose.length === 0}
            loading={act.pending}
            onClick={() => {
              act.run('ExportPerformancePerson', { id: whose[0], input: {} }, (d) => {
                download(d as { filename: string; base64: string; mediaType: string });
              });
            }}
          >
            Export their data
          </Button>
        </CardContent>
      </Card>

      <Modal
        open={confirming}
        onClose={() => {
          setConfirming(false);
        }}
        title="Delete these records?"
        description="They are gone for good: reviews, feedback, notes, learning and AI output whose time has passed. The activity log keeps that you did it."
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={act.pending}
              onClick={() => {
                act.run('ConfirmPerformanceRetention', { input: { personIds: chosen } }, () => {
                  setChosen([]);
                  setConfirming(false);
                });
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <Alert tone="warning">
          {data.due
            .filter((d) => chosen.includes(d.personId))
            .map((d) => d.name)
            .join(', ')}
        </Alert>
      </Modal>

      <Modal
        open={holding}
        onClose={() => {
          setHolding(false);
        }}
        title="Place a legal hold"
        description="Nothing of this person’s is deleted until the hold is lifted, whatever the retention periods say."
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setHolding(false);
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={holdFor.length === 0 || reason.trim() === ''}
              loading={act.pending}
              onClick={() => {
                act.run(
                  'PlacePerformanceHold',
                  { input: { personId: holdFor[0], reason: reason.trim() } },
                  () => {
                    setHolding(false);
                    setHoldFor([]);
                    setReason('');
                  },
                );
              }}
            >
              Place the hold
            </Button>
          </>
        }
      >
        <PersonPicker act={act} label="Whose records" value={holdFor} onChange={setHoldFor} />
        <Field required>
          <FieldLabel>Why</FieldLabel>
          <Input
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
            placeholder="A tribunal claim, an investigation"
          />
        </Field>
      </Modal>
    </div>
  );
}

/* ----------------------------------------------------------- webhooks -- */

export interface WebhooksData {
  readonly available: boolean;
  readonly events: readonly string[];
  readonly rows: readonly {
    readonly id: string;
    readonly url: string;
    readonly events: readonly string[];
    readonly createdAt: string;
    readonly disabled: { readonly at: string; readonly why: string } | null;
    readonly failing: { readonly since: string; readonly status: number } | null;
    readonly last: { readonly at: string; readonly status: number } | null;
    readonly rotatedUntil: string | null;
  }[];
}

/** `performance.review.released` → "Review released". */
const eventWords = (name: string): string => words(name.split('.').slice(1).join(' '));

/**
 * S8b (PRD §31, PRF-058): signed webhooks for Performance's events. Each
 * endpoint's secret is shown once, when it is added or rotated; every
 * delivery carries `kithena-signature: v1=<hex>`, HMAC-SHA256 of the body.
 */
export function Webhooks(props: ScreenProps<WebhooksData>): JSX.Element {
  const act = useAct(props);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState('');
  const [which, setWhich] = useState('every');
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const [secret, setSecret] = useState<string | null>(null);
  const [tested, setTested] = useState<string | null>(null);
  return (
    <Loaded load={props.load} what="webhooks">
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title="Webhooks"
            description="Performance’s events sent to your own systems as they happen, in the order they happened, each signed so you can check it came from Kithena."
            actions={
              data.available ? (
                <Button
                  startIcon={<icons.add aria-hidden />}
                  onClick={() => {
                    setAdding(true);
                  }}
                >
                  Add an endpoint
                </Button>
              ) : null
            }
          />
          <Refusal error={act.error} />
          {data.available ? null : <Alert tone="info">Webhooks aren’t set up here yet.</Alert>}
          {tested === null ? null : <Alert tone="info">{tested}</Alert>}
          <Card>
            <CardContent className="overflow-x-auto">
              {data.rows.length === 0 ? (
                <EmptyState
                  icon={<icons.link aria-hidden />}
                  title="No endpoints"
                  description="Add one to receive reviews released, cycles launched, ratings finalised and the rest."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Endpoint</TableHead>
                      <TableHead>Events</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last delivery</TableHead>
                      <TableHead>
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-sm">{r.url}</TableCell>
                        <TableCell className="text-sm">
                          {r.events.includes('*')
                            ? 'Every event'
                            : r.events.map(eventWords).join(', ')}
                        </TableCell>
                        <TableCell>
                          {r.disabled !== null ? (
                            <span className="flex flex-col gap-0.5">
                              <Badge size="sm" tone="danger">
                                Off
                              </Badge>
                              <span className="text-xs text-fg-muted">{r.disabled.why}</span>
                            </span>
                          ) : r.failing !== null ? (
                            <Badge size="sm" tone="warning">
                              {`Failing since ${when(r.failing.since)}`}
                            </Badge>
                          ) : (
                            <Badge size="sm" tone="success">
                              On
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-fg-muted">
                          {r.last === null
                            ? 'None yet'
                            : `${when(r.last.at)} · ${r.last.status === 0 ? 'no answer' : String(r.last.status)}`}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={`Actions for ${r.url}`}
                                startIcon={<icons.more aria-hidden />}
                              />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onSelect={() => {
                                  act.run(
                                    'TestPerformanceWebhook',
                                    { id: r.id, input: {} },
                                    (d) => {
                                      const status = (d as { status: number }).status;
                                      setTested(
                                        status >= 200 && status < 300
                                          ? `The test reached ${r.url} (${String(status)}).`
                                          : `The test did not reach ${r.url}: ${status === 0 ? 'no answer' : `it answered ${String(status)}`}.`,
                                      );
                                    },
                                  );
                                }}
                              >
                                Send a test
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => {
                                  act.run(
                                    'RotatePerformanceWebhook',
                                    { id: r.id, input: {} },
                                    (d) => {
                                      setSecret((d as { secret: string }).secret);
                                    },
                                  );
                                }}
                              >
                                New secret
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => {
                                  act.run('ChangePerformanceWebhook', {
                                    id: r.id,
                                    input: { on: r.disabled !== null },
                                  });
                                }}
                              >
                                {r.disabled === null ? 'Turn off' : 'Turn on'}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => {
                                  act.run('RemovePerformanceWebhook', { id: r.id });
                                }}
                              >
                                Remove
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          <Modal
            open={adding}
            onClose={() => {
              setAdding(false);
            }}
            title="Add an endpoint"
            description="An https address on the public internet. It is sent only what is written from now on."
            footer={
              <>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setAdding(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  disabled={url.trim() === '' || (which === 'choose' && chosen.length === 0)}
                  loading={act.pending}
                  onClick={() => {
                    act.run(
                      'AddPerformanceWebhook',
                      { input: { url: url.trim(), events: which === 'every' ? ['*'] : chosen } },
                      (d) => {
                        setSecret((d as { secret: string }).secret);
                        setAdding(false);
                        setUrl('');
                        setChosen([]);
                      },
                    );
                  }}
                >
                  Add
                </Button>
              </>
            }
          >
            <Refusal error={act.error} />
            <Field required>
              <FieldLabel>Address</FieldLabel>
              <Input
                type="url"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                }}
                placeholder="https://hooks.example.com/kithena"
              />
            </Field>
            <RadioGroup aria-label="Which events" value={which} onValueChange={setWhich}>
              <RadioCard value="every">Every event</RadioCard>
              <RadioCard value="choose">Only these</RadioCard>
            </RadioGroup>
            {which === 'choose' ? (
              <div className="flex flex-col gap-1.5">
                {data.events.map((e) => (
                  <Field key={e} orientation="horizontal">
                    <Checkbox
                      checked={chosen.includes(e)}
                      onCheckedChange={(on) => {
                        setChosen(on === true ? [...chosen, e] : chosen.filter((x) => x !== e));
                      }}
                    />
                    <FieldLabel>{eventWords(e)}</FieldLabel>
                  </Field>
                ))}
              </div>
            ) : null}
          </Modal>
          <Modal
            open={secret !== null}
            onClose={() => {
              setSecret(null);
            }}
            title="The endpoint’s secret"
            description="Shown this once. Every delivery carries kithena-signature: v1=<hex>, the HMAC-SHA256 of the body with this secret. After a new secret, the old one also signs for a day."
            footer={
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (secret !== null) void navigator.clipboard.writeText(secret);
                  }}
                >
                  Copy
                </Button>
                <Button
                  onClick={() => {
                    setSecret(null);
                  }}
                >
                  Done
                </Button>
              </>
            }
          >
            <Input readOnly value={secret ?? ''} aria-label="Secret" className="font-mono" />
          </Modal>
        </div>
      )}
    </Loaded>
  );
}
