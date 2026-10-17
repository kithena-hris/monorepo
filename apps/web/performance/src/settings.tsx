import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Combobox,
  CopyField,
  DatePicker,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  FormSaveBar,
  FormSection,
  FormSections,
  Input,
  List,
  ListItem,
  NumberField,
  PageHeader,
  RadioCard,
  RadioGroup,
  SegmentedControl,
  SegmentedControlItem,
  Slider,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TagsInput,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded } from './load';
import {
  Choose,
  Modal,
  PersonPicker,
  Refusal,
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

const GENERAL = {
  title: 'General',
  description: 'The company’s rating scale, its scores, and the parts of Performance it uses.',
  section: 'general',
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
  const meta = PAGES[page] ?? GENERAL;
  const [saved, setSaved] = useState<Obj>(data.settings[meta.section] ?? {});
  const [value, setValue] = useState<Obj>(saved);
  const dirty = JSON.stringify(value) !== JSON.stringify(saved);
  const ui: Ui = {
    get: (...path) => at(value, path),
    set: (path, v) => {
      setValue(put(value, path, v));
    },
    off: !data.admin,
  };
  return (
    <div className="flex flex-col gap-4 pb-16">
      <PageHeader title={meta.title} description={meta.description} />
      <Refusal error={act.error} />
      {data.admin ? null : (
        <Alert tone="info" title="Read only">
          Only an administrator changes Performance’s settings.
        </Alert>
      )}
      {meta.section === 'ai' && !data.model ? (
        <Alert tone="warning" title="No model is connected">
          Every AI feature is unavailable until one is, whatever these say.
        </Alert>
      ) : null}
      <Card>
        <CardContent>
          <FormSections>
            <Body page={page} ui={ui} data={data} act={act} />
          </FormSections>
        </CardContent>
      </Card>
      <FormSaveBar
        open={dirty && data.admin}
        saving={act.pending}
        message="New cycles, feedback and goals follow these once saved."
        onDiscard={() => {
          setValue(saved);
        }}
        onSave={() => {
          act.run('SavePerformanceSettings', { section: meta.section, input: value }, () => {
            setSaved(value);
          });
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------- the settings -- */

type Path = readonly string[];

/** One page's values, read and written by path, and whether the viewer may change them. */
interface Ui {
  readonly get: (...path: Path) => Json;
  readonly set: (path: Path, v: Json) => void;
  readonly off: boolean;
}

const at = (o: Json, path: Path): Json =>
  path.reduce<Json>((v, k) => (isObj(v) ? (v[k] ?? null) : null), o);

function put(o: Obj, path: Path, v: Json): Obj {
  const [k, ...rest] = path;
  if (k === undefined) return o;
  const inner = o[k] ?? null;
  return { ...o, [k]: rest.length === 0 ? v : put(isObj(inner) ? inner : {}, rest, v) };
}

/** A stored list, as the rows it holds; anything else is none. */
const list = (v: Json): readonly unknown[] => (isList(v) ? v : []);
const num = (v: Json): number | null => (typeof v === 'number' ? v : null);
const str = (v: Json): string => (typeof v === 'string' ? v : '');

/** Settings that are each on or off, in one group: a row each, its switch at the end. */
function Switches({
  ui,
  items,
}: {
  readonly ui: Ui;
  readonly items: readonly {
    readonly path: Path;
    readonly label: string;
    readonly hint?: string;
  }[];
}): JSX.Element {
  return (
    <List>
      {items.map((i) => (
        <ListItem
          key={i.path.join('.')}
          description={i.hint}
          trailing={
            <Switch
              aria-label={i.label}
              checked={ui.get(...i.path) === true}
              disabled={ui.off}
              onCheckedChange={(on) => {
                ui.set(i.path, on);
              }}
            />
          }
        >
          {i.label}
        </ListItem>
      ))}
    </List>
  );
}

/** One of a few choices, each with a line on what it means. */
function Choice({
  ui,
  path,
  label,
  options,
}: {
  readonly ui: Ui;
  readonly path: Path;
  readonly label: string;
  readonly options: readonly (readonly [string, string, string?])[];
}): JSX.Element {
  return (
    <RadioGroup
      aria-label={label}
      className="flex max-w-2xl flex-col gap-2 touch:max-w-none"
      value={str(ui.get(...path))}
      disabled={ui.off}
      onValueChange={(v) => {
        ui.set(path, v);
      }}
    >
      {options.map(([v, l, d]) => (
        <RadioCard key={v} value={v} description={d}>
          {l}
        </RadioCard>
      ))}
    </RadioGroup>
  );
}

function Count({
  ui,
  path,
  label,
  hint,
  min,
  max,
  suffix,
}: {
  readonly ui: Ui;
  readonly path: Path;
  readonly label: string;
  readonly hint?: string;
  readonly min: number;
  readonly max: number;
  readonly suffix?: string;
}): JSX.Element {
  return (
    <NumberField
      label={label}
      hint={hint}
      min={min}
      max={max}
      suffix={suffix}
      value={num(ui.get(...path))}
      disabled={ui.off}
      onChange={(v) => {
        if (v !== null) ui.set(path, v);
      }}
    />
  );
}

const ZONES = [...new Set(['UTC', ...Intl.supportedValuesOf('timeZone')])].map((z) => ({
  value: z,
  label: z.replaceAll('_', ' '),
}));

const KINDS_WITH_FORMS = [
  ['self', 'Self reviews'],
  ['manager', 'Manager reviews'],
  ['peer', 'Peer reviews'],
  ['upward', 'Upward reviews'],
  ['skip', 'Skip-level reviews'],
] as const;

const CADENCE = [
  ['weekly', 'Weekly'],
  ['fortnightly', 'Every two weeks'],
  ['monthly', 'Monthly'],
  ['none', 'No check-ins'],
] as const;

const NINE_BOX = [
  ['star', 'Star', 'High performance, high potential'],
  ['high', 'High performer', 'High performance, moderate potential'],
  ['trusted', 'Trusted professional', 'High performance, low potential'],
  ['corePotential', 'Rising talent', 'Moderate performance, high potential'],
  ['core', 'Core player', 'Moderate performance, moderate potential'],
  ['effective', 'Effective', 'Moderate performance, low potential'],
  ['inconsistent', 'Inconsistent', 'Low performance, high potential'],
  ['lowPotential', 'Dilemma', 'Low performance, moderate potential'],
  ['under', 'Underperformer', 'Low performance, low potential'],
] as const;

const AI_FEATURES = [
  ['builder', 'Form builder', 'Drafts a form’s questions from a description.'],
  ['summaries', 'Summaries', 'Summarises what was written about a person, for their manager.'],
  [
    'sentiment',
    'Sentiment',
    'Reads the tone of feedback for analytics, in groups of five or more.',
  ],
  ['prefill', 'Prefill', 'Suggests a first draft of a review from the year’s evidence.'],
  ['writingChecks', 'Writing checks', 'Flags vague or biased wording while someone writes.'],
  ['toneCheck', 'Tone check', 'Flags feedback that may land badly before it is sent.'],
  ['setupByChat', 'Set up in words', 'Builds a cycle’s setup from a description.'],
  ['automationsInWords', 'Automations in words', 'Turns a sentence into an automation.'],
  ['charts', 'Charts in words', 'Draws the analytics chart someone asks for.'],
  ['learningSuggestions', 'Learning suggestions', 'Suggests courses from a review’s outcome.'],
  [
    'calibrationSuggestions',
    'Calibration suggestions',
    'Proposes moves in a session, each for a person to accept.',
  ],
  ['panel', 'Ask Kithena', 'The assistant panel on every Performance screen.'],
] as const;

const CONNECTIONS = [
  ['google', 'Google Workspace', 'Calendar invitations for sessions and 1:1s.'],
  ['microsoft', 'Microsoft 365', 'Calendar invitations for sessions and 1:1s.'],
  ['slack', 'Slack', 'Reminders, praise and asking Kithena in the chat app.'],
  ['teams', 'Microsoft Teams', 'Reminders and praise in Teams.'],
  ['gchat', 'Google Chat', 'Reminders and praise in Google Chat.'],
] as const;

/** What each settings page holds, laid out as sections of one form. */
function Body({
  page,
  ui,
  data,
  act,
}: {
  readonly page: string;
  readonly ui: Ui;
  readonly data: SettingsData;
  readonly act: ReturnType<typeof useAct>;
}): JSX.Element {
  switch (page) {
    case 'release':
      return (
        <>
          <FormSection
            title="When people see their reviews"
            description="Where a new cycle starts; each cycle can change it."
          >
            <Choice
              ui={ui}
              path={['release']}
              label="Release"
              options={[
                [
                  'manager',
                  'As each is submitted',
                  'The manager releases each review once it is in.',
                ],
                ['hr_date', 'On a date', 'HR sets one day, and everyone sees theirs then.'],
                ['close', 'When the cycle closes', 'After calibration, if the cycle has one.'],
              ]}
            />
          </FormSection>
          <FormSection
            title="Confidentiality"
            description="Peer and upward answers stay unread until enough are in."
          >
            <Count
              ui={ui}
              path={['minimum']}
              label="Response minimum"
              hint="Confidential answers show only once this many are in."
              min={1}
              max={20}
              suffix="responses"
            />
          </FormSection>
          <FormSection title="Workload" description="What a cycle’s launch checks warn about.">
            <Count
              ui={ui}
              path={['perReviewer']}
              label="Peer reviews one person writes, at most"
              min={1}
              max={50}
              suffix="reviews"
            />
            <Count
              ui={ui}
              path={['workload']}
              label="Warn when someone has more than"
              hint="Listed by name before launch."
              min={1}
              max={100}
              suffix="reviews"
            />
          </FormSection>
          <FormSection title="After release" description="What the person reviewed can do.">
            <Switches
              ui={ui}
              items={[
                {
                  path: ['acknowledge'],
                  label: 'Ask for an acknowledgement',
                  hint: '“I’ve read this” is not agreement.',
                },
                {
                  path: ['subjectComment'],
                  label: 'Let them comment',
                  hint: 'Shown to their manager and HR.',
                },
              ]}
            />
          </FormSection>
          <FormSection
            title="Default forms"
            description="The form each kind of review starts with in a new cycle."
          >
            {KINDS_WITH_FORMS.map(([kind, label]) => (
              <Choose
                key={kind}
                label={label}
                value={str(ui.get('templates', kind)) || 'default'}
                options={[
                  ['default', 'Kithena’s default'],
                  ...data.templates
                    .filter((t) => t.purpose.length === 0 || t.purpose.includes(kind))
                    .map((t) => [t.id, t.name] as const),
                ]}
                onChange={(v) => {
                  ui.set(['templates', kind], v === 'default' ? null : v);
                }}
              />
            ))}
          </FormSection>
        </>
      );
    case 'feedback':
      return (
        <>
          <FormSection title="Who gives feedback">
            <Choice
              ui={ui}
              path={['who']}
              label="Who gives feedback"
              options={[
                ['anyone', 'Anyone, to anyone'],
                ['team', 'Within their team'],
                ['nobody', 'Nobody', 'Feedback is off; praise and reviews are not.'],
              ]}
            />
          </FormSection>
          <FormSection title="Who sees it" description="Unless the writer narrows it.">
            <Choice
              ui={ui}
              path={['sees']}
              label="Who sees it"
              options={[
                ['recipient', 'Only the receiver'],
                ['recipient_manager', 'The receiver and their manager'],
                ['recipient_manager_hr', 'The receiver, their manager and HR'],
              ]}
            />
          </FormSection>
          <FormSection title="Writers’ names">
            <Choice
              ui={ui}
              path={['names']}
              label="Writers’ names"
              options={[
                ['never', 'Always hidden', 'Shown as “Someone at the company”.'],
                ['always', 'Always shown'],
                ['writer', 'The writer chooses'],
              ]}
            />
          </FormSection>
          <FormSection title="Praise" description="Thanks in public, tagged with a company value.">
            <Switches
              ui={ui}
              items={[
                {
                  path: ['praise', 'public'],
                  label: 'Praise is public',
                  hint: 'On the company’s praise wall.',
                },
                {
                  path: ['praise', 'chat'],
                  label: 'Post praise to the chat app',
                  hint: 'When the chat app is connected.',
                },
              ]}
            />
            <TagsInput
              label="Company values"
              hint="Enter or a comma adds one."
              max={20}
              disabled={ui.off}
              value={list(ui.get('praise', 'values')) as readonly string[]}
              onChange={(v) => {
                ui.set(['praise', 'values'], v);
              }}
            />
          </FormSection>
          <FormSection title="Writing help">
            <Switches
              ui={ui}
              items={[
                {
                  path: ['toneCheck'],
                  label: 'Check the tone before sending',
                  hint: 'The writer decides; nothing is changed for them.',
                },
                { path: ['templates'], label: 'Offer feedback templates' },
              ]}
            />
          </FormSection>
        </>
      );
    case 'goals':
      return <GoalsSettings ui={ui} />;
    case 'learning': {
      const providers = list(ui.get('providers')) as readonly {
        readonly name: string;
        readonly connected: boolean;
        readonly items: number;
      }[];
      const share = num(ui.get('attendanceShare')) ?? 75;
      return (
        <>
          <FormSection
            title="Learning platforms"
            description="Completions arrive on their own from a connected platform."
          >
            <List>
              {providers.map((p) => (
                <ListItem
                  key={p.name}
                  description={p.connected ? plural(p.items, 'course') : 'Not connected yet'}
                  trailing={
                    <Badge size="sm" tone={p.connected ? 'success' : 'neutral'}>
                      {p.connected ? 'Connected' : 'Off'}
                    </Badge>
                  }
                >
                  {p.name}
                </ListItem>
              ))}
            </List>
          </FormSection>
          <FormSection title="Completion">
            <Slider
              label="Attendance that completes a live session"
              valueDisplay={`${String(share)}%`}
              min={5}
              max={100}
              step={5}
              disabled={ui.off}
              value={[share]}
              onValueChange={([v = share]) => {
                ui.set(['attendanceShare'], v);
              }}
            />
            <Count
              ui={ui}
              path={['certificatesYears']}
              label="Certificates stay valid for"
              hint="0: they never expire."
              min={0}
              max={20}
              suffix="years"
            />
          </FormSection>
        </>
      );
    }
    case 'calibration': {
      const total = NINE_BOX.reduce((n, [k]) => n + (num(ui.get('guide', k)) ?? 0), 0);
      return (
        <>
          <FormSection
            title="Nine-box guide"
            description="The share of people expected in each box: a guide for the session, never a quota."
          >
            {NINE_BOX.map(([k, label, hint]) => (
              <Count
                key={k}
                ui={ui}
                path={['guide', k]}
                label={label}
                hint={hint}
                min={0}
                max={100}
                suffix="%"
              />
            ))}
            <p className="flex items-center gap-2 text-sm">
              <Badge size="sm" tone={total === 100 ? 'success' : 'warning'}>
                {`${String(total)}%`}
              </Badge>
              {total === 100 ? 'Adds up to the whole company.' : 'Should add up to 100%.'}
            </p>
          </FormSection>
          <FormSection title="In a session" description="What calibrators see.">
            <Switches
              ui={ui}
              items={[
                {
                  path: ['managersOwnOnly'],
                  label: 'Managers see only their own people',
                  hint: 'HR and the session’s owner see everyone in it.',
                },
                {
                  path: ['peerNames'],
                  label: 'Show peer reviewers’ names',
                },
              ]}
            />
          </FormSection>
        </>
      );
    }
    case 'ai':
      return (
        <FormSection
          title="Features"
          description="Each on or off for the whole company. Every output is logged, and a person confirms every number."
        >
          <Switches
            ui={ui}
            items={AI_FEATURES.map(([k, label, hint]) => ({
              path: ['features', k],
              label,
              hint,
            }))}
          />
        </FormSection>
      );
    case 'connections':
      return (
        <>
          <FormSection title="Calendars and chat">
            <Switches
              ui={ui}
              items={CONNECTIONS.map(([k, label, hint]) => ({
                path: ['connections', k],
                label,
                hint,
              }))}
            />
          </FormSection>
          <FormSection
            title="Tools people may connect"
            description="Each person still decides for their own work, in My connected tools; off here, nobody can."
          >
            <Switches
              ui={ui}
              items={Object.entries(SOURCE).map(([k, label]) => ({
                path: ['evidence', k],
                label,
              }))}
            />
          </FormSection>
        </>
      );
    case 'works-councils':
      return (
        <FormSection
          title="Legal entities"
          description="Until a works council agrees, people in that entity are left out of cycles, and AI and connected tools are off for them."
        >
          {data.legalEntities.length === 0 ? (
            <p className="text-sm text-fg-muted">
              The company has no legal entities in People yet.
            </p>
          ) : (
            data.legalEntities.map((entity) => {
              const agreed = ui.get('worksCouncil', entity, 'agreed');
              return (
                <div key={entity} className="flex max-w-2xl flex-col gap-3 touch:max-w-none">
                  <Switches
                    ui={ui}
                    items={[
                      { path: ['worksCouncil', entity, 'on'], label: entity, hint: 'Agreed' },
                    ]}
                  />
                  {ui.get('worksCouncil', entity, 'on') === true ? (
                    <Field>
                      <FieldLabel>Agreed on</FieldLabel>
                      <FieldControl>
                        <DatePicker
                          label={`${entity} agreed on`}
                          value={typeof agreed === 'string' ? agreed : null}
                          onChange={(d) => {
                            ui.set(['worksCouncil', entity, 'agreed'], d);
                          }}
                        />
                      </FieldControl>
                    </Field>
                  ) : null}
                </div>
              );
            })
          )}
        </FormSection>
      );
    case 'access':
      return <AccessSettings ui={ui} data={data} act={act} />;
    default:
      return <GeneralSettings ui={ui} />;
  }
}

function GeneralSettings({ ui }: { readonly ui: Ui }): JSX.Element {
  return (
    <>
      <FormSection
        title="Rating scale"
        description="Every performance score is computed on it. Changing it changes no score already submitted."
      >
        <Scale
          value={list(ui.get('scale')) as readonly ScaleOption[]}
          disabled={ui.off}
          onChange={(s) => {
            ui.set(['scale'], s as unknown as Json);
          }}
        />
      </FormSection>
      <FormSection title="Scores">
        <Field>
          <FieldLabel>Decimal places</FieldLabel>
          <SegmentedControl
            value={String(num(ui.get('decimals')) ?? 1)}
            onValueChange={(v) => {
              if (!ui.off && v !== '') ui.set(['decimals'], Number(v));
            }}
          >
            <SegmentedControlItem value="1">3.4</SegmentedControlItem>
            <SegmentedControlItem value="2">3.42</SegmentedControlItem>
          </SegmentedControl>
        </Field>
        <Field>
          <FieldLabel>Company time zone</FieldLabel>
          <FieldControl>
            <Combobox
              label="Company time zone"
              options={ZONES}
              value={str(ui.get('zone'))}
              searchPlaceholder="Find a zone"
              onChange={(v) => {
                if (!ui.off && typeof v === 'string') ui.set(['zone'], v);
              }}
            />
          </FieldControl>
          <FieldDescription>
            Cycles start and fall due in it unless one says otherwise.
          </FieldDescription>
        </Field>
      </FormSection>
      <FormSection title="Parts of Performance" description="Off hides the part for everyone.">
        <Switches
          ui={ui}
          items={[
            { path: ['parts', 'goals'], label: 'Goals', hint: 'Goals, key results and check-ins.' },
            {
              path: ['parts', 'learning'],
              label: 'Learning',
              hint: 'Courses, sessions and attendance.',
            },
            {
              path: ['parts', 'calibration'],
              label: 'Calibration',
              hint: 'Sessions over a cycle’s scores, and the nine-box.',
            },
            {
              path: ['parts', 'automations'],
              label: 'Automations',
              hint: 'Cycles made on a calendar or after an event.',
            },
          ]}
        />
      </FormSection>
    </>
  );
}

interface PeriodRow {
  readonly id: string;
  readonly name: string;
  readonly from: string;
  readonly to: string;
  readonly cadence: string;
}

function GoalsSettings({ ui }: { readonly ui: Ui }): JSX.Element {
  const periods = list(ui.get('periods')) as readonly PeriodRow[];
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<PeriodRow>({
    id: '',
    name: '',
    from: '',
    to: '',
    cadence: 'fortnightly',
  });
  const cadence = (c: string): string => (CADENCE.find(([v]) => v === c)?.[1] ?? c).toLowerCase();
  return (
    <>
      <FormSection
        title="Periods"
        description="What a goal is set for, and how often its owner checks in."
      >
        <List>
          {periods.map((p) => (
            <ListItem
              key={p.id}
              description={`${day(p.from)} to ${day(p.to)} · check-ins ${cadence(p.cadence)}`}
              trailing={
                ui.off ? undefined : (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${p.name}`}
                    startIcon={<icons.delete aria-hidden />}
                    onClick={() => {
                      ui.set(['periods'], periods.filter((x) => x.id !== p.id) as unknown as Json);
                    }}
                  />
                )
              }
            >
              {p.name}
            </ListItem>
          ))}
        </List>
        {ui.off ? null : (
          <Button
            size="sm"
            variant="secondary"
            className="self-start"
            startIcon={<icons.add aria-hidden />}
            onClick={() => {
              setAdding(true);
            }}
          >
            Add a period
          </Button>
        )}
      </FormSection>
      <FormSection title="Goals">
        <Switches
          ui={ui}
          items={[
            {
              path: ['weighted'],
              label: 'Weighted goals',
              hint: 'A person’s goals for a period add up to 100%.',
            },
            {
              path: ['rollUp'],
              label: 'Parent goals take their children’s progress',
              hint: 'Off: the parent’s owner updates it.',
            },
            {
              path: ['follow'],
              label: 'Key results can follow a Linear project or Jira epic',
              hint: 'Once those tools are connected.',
            },
          ]}
        />
      </FormSection>
      <Modal
        open={adding}
        onClose={() => {
          setAdding(false);
        }}
        title="Add a period"
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
              disabled={
                draft.name.trim() === '' ||
                draft.from === '' ||
                draft.to === '' ||
                draft.to < draft.from
              }
              onClick={() => {
                const id = `${draft.name
                  .trim()
                  .toLowerCase()
                  .replaceAll(/[^a-z0-9]+/gu, '-')}-${String(periods.length + 1)}`.slice(0, 40);
                ui.set(['periods'], [
                  ...periods,
                  { ...draft, id, name: draft.name.trim() },
                ] as unknown as Json);
                setAdding(false);
                setDraft({ id: '', name: '', from: '', to: '', cadence: 'fortnightly' });
              }}
            >
              Add
            </Button>
          </>
        }
      >
        <Field required>
          <FieldLabel>Name</FieldLabel>
          <Input
            value={draft.name}
            placeholder="Q1 2027"
            onChange={(e) => {
              setDraft({ ...draft, name: e.target.value });
            }}
          />
        </Field>
        <Field required>
          <FieldLabel>From</FieldLabel>
          <FieldControl>
            <DatePicker
              label="From"
              value={draft.from === '' ? null : draft.from}
              onChange={(d) => {
                setDraft({ ...draft, from: d ?? '' });
              }}
            />
          </FieldControl>
        </Field>
        <Field required>
          <FieldLabel>To</FieldLabel>
          <FieldControl>
            <DatePicker
              label="To"
              value={draft.to === '' ? null : draft.to}
              onChange={(d) => {
                setDraft({ ...draft, to: d ?? '' });
              }}
            />
          </FieldControl>
        </Field>
        <Choose
          label="Check-ins"
          value={draft.cadence}
          options={CADENCE}
          onChange={(v) => {
            setDraft({ ...draft, cadence: v });
          }}
        />
      </Modal>
    </>
  );
}

function AccessSettings({
  ui,
  data,
  act,
}: {
  readonly ui: Ui;
  readonly data: SettingsData;
  readonly act: ReturnType<typeof useAct>;
}): JSX.Element {
  const ids = list(ui.get('hr')) as readonly string[];
  const [named, setNamed] = useState<Readonly<Record<string, string>>>(
    Object.fromEntries(data.hrPeople.map((p) => [p.personId, p.name])),
  );
  return (
    <FormSection
      title="HR to Performance"
      description="They run cycles and calibration and read every review, beyond the company’s administrators, who always can."
    >
      {ids.length === 0 ? (
        <p className="text-sm text-fg-muted">Only the company’s administrators.</p>
      ) : (
        <List>
          {ids.map((id) => (
            <ListItem
              key={id}
              trailing={
                ui.off ? undefined : (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${named[id] ?? 'this person'}`}
                    startIcon={<icons.delete aria-hidden />}
                    onClick={() => {
                      ui.set(
                        ['hr'],
                        ids.filter((x) => x !== id),
                      );
                    }}
                  />
                )
              }
            >
              {named[id] ?? 'Someone who left'}
            </ListItem>
          ))}
        </List>
      )}
      {ui.off ? null : (
        <PersonPicker
          act={act}
          label="Add someone"
          value={[]}
          onChange={(picked, people) => {
            const id = picked[0];
            if (id === undefined || ids.includes(id)) return;
            setNamed({ ...named, ...Object.fromEntries(people.map((p) => [p.personId, p.name])) });
            ui.set(['hr'], [...ids, id]);
          }}
        />
      )}
    </FormSection>
  );
}

/** The company's scale: a row per level, its value, its name and what it means. */
function Scale({
  value,
  disabled,
  onChange,
}: {
  readonly value: readonly ScaleOption[];
  readonly disabled: boolean;
  readonly onChange: (s: readonly ScaleOption[]) => void;
}): JSX.Element {
  const change = (i: number, patch: Partial<ScaleOption>): void => {
    onChange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  };
  return (
    <div className="flex max-w-3xl flex-col gap-3 touch:max-w-none">
      {value.map((o, i) => (
        <div
          key={`level-${String(i)}`}
          className="grid grid-cols-[5rem_minmax(0,14rem)_minmax(0,1fr)_auto] items-end gap-3 touch:grid-cols-1"
        >
          <NumberField
            hideSteppers
            label="Value"
            value={o.value}
            disabled={disabled}
            onChange={(v) => {
              if (v !== null) change(i, { value: v });
            }}
          />
          <Field>
            <FieldLabel>Label</FieldLabel>
            <Input
              value={o.label}
              disabled={disabled}
              onChange={(e) => {
                change(i, { label: e.target.value });
              }}
            />
          </Field>
          <Field>
            <FieldLabel>What it means</FieldLabel>
            <Input
              value={o.description ?? ''}
              placeholder="Optional"
              disabled={disabled}
              onChange={(e) => {
                change(i, { description: e.target.value === '' ? null : e.target.value });
              }}
            />
          </Field>
          <Button
            variant="ghost"
            aria-label={`Remove ${o.label || 'this level'}`}
            startIcon={<icons.delete aria-hidden />}
            disabled={disabled || value.length <= 2}
            onClick={() => {
              onChange(value.filter((_, j) => j !== i));
            }}
          />
        </div>
      ))}
      {disabled || value.length >= 10 ? null : (
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          startIcon={<icons.add aria-hidden />}
          onClick={() => {
            const top = value.reduce((n, o) => Math.max(n, o.value), 0);
            onChange([...value, { value: top + 1, label: '', description: null }]);
          }}
        >
          Add a level
        </Button>
      )}
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
            <CardContent>
              <FormSections>
                <FormSection
                  title="Tools"
                  description="Each is read only for reviews about you or by you."
                >
                  <List>
                    {data.sources.map((s) => (
                      <ListItem
                        key={s.source}
                        description={
                          s.at === null
                            ? 'Never turned on'
                            : `${s.on ? 'On' : 'Off'} since ${when(s.at)}`
                        }
                        trailing={
                          <Switch
                            aria-label={SOURCE[s.source] ?? s.source}
                            checked={s.on}
                            disabled={act.pending}
                            onCheckedChange={(on) => {
                              act.run('SetPerformanceGrant', { source: s.source, input: { on } });
                            }}
                          />
                        }
                      >
                        {SOURCE[s.source] ?? s.source}
                      </ListItem>
                    ))}
                  </List>
                </FormSection>
                <FormSection title="Recent reads" description="Every time Kithena read something.">
                  {data.reads.length === 0 ? (
                    <p className="text-sm text-fg-muted">Nothing has been read.</p>
                  ) : (
                    <List>
                      {data.reads.map((r) => (
                        <ListItem
                          key={`${r.source}-${r.at}`}
                          description={r.purpose}
                          meta={when(r.at)}
                        >
                          {SOURCE[r.source] ?? r.source}
                        </ListItem>
                      ))}
                    </List>
                  )}
                </FormSection>
              </FormSections>
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
    <div className="flex flex-col gap-4 pb-16">
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
          <FormSaveBar
            open={changed && data.admin}
            saving={act.pending}
            onDiscard={() => {
              setRule(data.rule);
            }}
            onSave={() => {
              act.run('SavePerformanceSettings', {
                section: 'privacy',
                input: { ...data.privacy, retention: rule },
              });
            }}
          />
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
              <Button
                onClick={() => {
                  setSecret(null);
                }}
              >
                Done
              </Button>
            }
          >
            <CopyField value={secret ?? ''} label="Copy the secret" />
          </Modal>
        </div>
      )}
    </Loaded>
  );
}
