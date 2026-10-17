import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Chip,
  ChipRow,
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
import { Choose, Refusal, Search, SwitchRow, useAct, when } from './shared';
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
        <CardContent className="flex flex-col gap-3">
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
      <div className="flex flex-col gap-1 border-t border-[var(--reach-line)] pt-3">
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
          className="grid grid-cols-[4rem_minmax(0,1fr)_minmax(0,2fr)] items-end gap-2"
        >
          <NumberField
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

/* --------------------------------------------------- the activity log -- */

export interface AuditLogData {
  readonly rows: readonly {
    readonly id: string;
    readonly at: string;
    readonly actorPersonId: string | null;
    readonly actorAccountId: string;
    readonly as: string;
    readonly action: string;
    readonly target: string;
    readonly where: string;
    readonly outcome: 'done' | 'refused';
    readonly fields: readonly string[];
    readonly ai: boolean;
  }[];
}

/** S13: who did what, as whom, on what and where; field names, never values. */
export function AuditLog(props: ScreenProps<AuditLogData>): JSX.Element {
  const refused = props.search?.['refused'] === 'true';
  const ai = props.search?.['ai'] === 'true';
  return (
    <Loaded load={props.load} what="the activity log">
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title="Activity log"
            description="Every read of a review and every change in Performance, kept for the retention period. Values are never written here."
          />
          <div className="flex flex-wrap items-center gap-3">
            <Search
              label="Search the log"
              placeholder="A person, an action, a cycle"
              initial={props.search?.['q'] ?? ''}
              onSearch={(q) => {
                props.onFilter?.({ q: q === '' ? null : q });
              }}
            />
            <ChipRow aria-label="Show">
              <Chip
                selected={refused}
                onClick={() => {
                  props.onFilter?.({ refused: refused ? null : 'true' });
                }}
              >
                Refused
              </Chip>
              <Chip
                selected={ai}
                onClick={() => {
                  props.onFilter?.({ ai: ai ? null : 'true' });
                }}
              >
                By AI
              </Chip>
            </ChipRow>
          </div>
          <Card>
            <CardContent className="overflow-x-auto">
              {data.rows.length === 0 ? (
                <EmptyState
                  icon={<icons.history aria-hidden />}
                  title="Nothing logged"
                  description="Reads and changes appear here as they happen."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>As whom</TableHead>
                      <TableHead>What</TableHead>
                      <TableHead>On what</TableHead>
                      <TableHead>Parts</TableHead>
                      <TableHead>Where</TableHead>
                      <TableHead>Outcome</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap text-sm">{when(r.at)}</TableCell>
                        <TableCell className="text-sm">
                          {r.as}
                          {r.ai ? (
                            <Badge size="sm" tone="accent" className="ml-2">
                              AI
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-sm">{r.action}</TableCell>
                        <TableCell className="text-sm">{r.target}</TableCell>
                        <TableCell className="text-sm text-fg-muted">
                          {r.fields.length === 0 ? '—' : r.fields.join(', ')}
                        </TableCell>
                        <TableCell className="text-sm">{r.where}</TableCell>
                        <TableCell>
                          <Badge size="sm" tone={r.outcome === 'done' ? 'success' : 'danger'}>
                            {r.outcome === 'done' ? 'Done' : 'Refused'}
                          </Badge>
                        </TableCell>
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
