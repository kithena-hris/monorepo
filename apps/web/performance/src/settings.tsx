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
import { Choose, Modal, PersonPicker, Refusal, day, download, useAct, when } from './shared';
import type { ScaleOption, ScreenProps } from './types';
import { t as tr } from './i18n';

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
    title: tr('settings.general', 'General'),
    description: tr(
      'settings.the_companys_rating_scale_and_the',
      'The company’s rating scale and the parts of Performance it uses.',
    ),
    section: 'general',
  },
  release: {
    title: tr('settings.release', 'Release'),
    description: tr(
      'settings.the_defaults_a_new_cycle_starts',
      'The defaults a new cycle starts from: who releases, the response minimum, acknowledgement.',
    ),
    section: 'reviews',
  },
  feedback: {
    title: tr('settings.feedback', 'Feedback'),
    description: tr(
      'settings.who_may_give_feedback_whether_names',
      'Who may give feedback, whether names are shown, praise and its company values.',
    ),
    section: 'feedback',
  },
  goals: {
    title: tr('settings.goals', 'Goals'),
    description: tr(
      'settings.goal_periods_their_check_in_cadence',
      'Goal periods, their check-in cadence, and whether goals are weighted.',
    ),
    section: 'goals',
  },
  learning: {
    title: tr('settings.learning', 'Learning'),
    description: tr(
      'settings.learning_platforms_and_the_attendance_share',
      'Learning platforms and the attendance share that completes a session.',
    ),
    section: 'learning',
  },
  calibration: {
    title: tr('settings.calibration', 'Calibration'),
    description: tr(
      'settings.the_nine_box_guide_and_who',
      'The nine-box guide and who sees what in a session.',
    ),
    section: 'calibration',
  },
  ai: {
    title: 'AI',
    description: tr(
      'settings.each_ai_feature_on_or_off_every',
      'Each AI feature, on or off. Every output is logged; a person confirms every number.',
    ),
    section: 'ai',
  },
  connections: {
    title: tr('settings.connections', 'Connections'),
    description: tr(
      'settings.calendars_chat_and_the_tools_people',
      'Calendars, chat and the tools people may let Kithena read for their reviews.',
    ),
    section: 'integrations',
  },
  retention: {
    title: tr('settings.retention', 'Retention'),
    description: tr(
      'settings.how_long_each_kind_of_record',
      'How long each kind of record is kept after someone leaves, and legal holds.',
    ),
    section: 'privacy',
    only: ['retention', 'holds'],
  },
  'works-councils': {
    title: tr('settings.works_councils', 'Works councils'),
    description: tr(
      'settings.where_a_works_council_has_agreed',
      'Where a works council has agreed to Performance, and to which parts.',
    ),
    section: 'privacy',
    only: ['worksCouncil'],
  },
  access: {
    title: tr('settings.access', 'Access'),
    description: tr(
      'settings.who_is_hr_to_performance_beyond',
      'Who is HR to Performance, beyond the company’s administrators.',
    ),
    section: 'roles',
  },
};

const GENERAL = {
  title: tr('settings.general', 'General'),
  description: tr(
    'settings.the_companys_rating_scale_its_scores',
    'The company’s rating scale, its scores, and the parts of Performance it uses.',
  ),
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
    <Loaded load={props.load} what={tr('settings.performances_settings', 'Performance’s settings')}>
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
        <Alert tone="info" title={tr('settings.read_only', 'Read only')}>
          {tr(
            'settings.only_an_administrator_changes_performances_settings',
            'Only an administrator changes Performance’s settings.',
          )}
        </Alert>
      )}
      {meta.section === 'ai' && !data.model ? (
        <Alert tone="warning" title={tr('settings.no_model_is_connected', 'No model is connected')}>
          {tr(
            'settings.every_ai_feature_is_unavailable_until',
            'Every AI feature is unavailable until one is, whatever these say.',
          )}
        </Alert>
      ) : null}
      <FormSections>
        <Body page={page} ui={ui} data={data} act={act} />
      </FormSections>
      <FormSaveBar
        open={dirty && data.admin}
        saving={act.pending}
        message={tr(
          'settings.new_cycles_feedback_and_goals_follow',
          'New cycles, feedback and goals follow these once saved.',
        )}
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
  ['self', tr('settings.self_reviews', 'Self reviews')],
  ['manager', tr('settings.manager_reviews', 'Manager reviews')],
  ['peer', tr('settings.peer_reviews', 'Peer reviews')],
  ['upward', tr('settings.upward_reviews', 'Upward reviews')],
  ['skip', tr('settings.skip_level_reviews', 'Skip-level reviews')],
] as const;

const CADENCE = [
  ['weekly', tr('settings.weekly', 'Weekly')],
  ['fortnightly', tr('settings.every_two_weeks', 'Every two weeks')],
  ['monthly', tr('settings.monthly', 'Monthly')],
  ['none', tr('settings.no_check_ins', 'No check-ins')],
] as const;

const NINE_BOX = [
  [
    'star',
    tr('settings.star', 'Star'),
    tr('settings.high_performance_high_potential', 'High performance, high potential'),
  ],
  [
    'high',
    tr('settings.high_performer', 'High performer'),
    tr('settings.high_performance_moderate_potential', 'High performance, moderate potential'),
  ],
  [
    'trusted',
    tr('settings.trusted_professional', 'Trusted professional'),
    tr('settings.high_performance_low_potential', 'High performance, low potential'),
  ],
  [
    'corePotential',
    tr('settings.rising_talent', 'Rising talent'),
    tr('settings.moderate_performance_high_potential', 'Moderate performance, high potential'),
  ],
  [
    'core',
    tr('settings.core_player', 'Core player'),
    tr(
      'settings.moderate_performance_moderate_potential',
      'Moderate performance, moderate potential',
    ),
  ],
  [
    'effective',
    tr('settings.effective', 'Effective'),
    tr('settings.moderate_performance_low_potential', 'Moderate performance, low potential'),
  ],
  [
    'inconsistent',
    tr('settings.inconsistent', 'Inconsistent'),
    tr('settings.low_performance_high_potential', 'Low performance, high potential'),
  ],
  [
    'lowPotential',
    tr('settings.dilemma', 'Dilemma'),
    tr('settings.low_performance_moderate_potential', 'Low performance, moderate potential'),
  ],
  [
    'under',
    tr('settings.underperformer', 'Underperformer'),
    tr('settings.low_performance_low_potential', 'Low performance, low potential'),
  ],
] as const;

const AI_FEATURES = [
  [
    'builder',
    tr('settings.form_builder', 'Form builder'),
    tr('settings.drafts_a_forms_questions_from_a', 'Drafts a form’s questions from a description.'),
  ],
  [
    'summaries',
    tr('settings.summaries', 'Summaries'),
    tr(
      'settings.summarises_what_was_written_about_a',
      'Summarises what was written about a person, for their manager.',
    ),
  ],
  [
    'sentiment',
    tr('settings.sentiment', 'Sentiment'),
    tr(
      'settings.reads_the_tone_of_feedback_for',
      'Reads the tone of feedback for analytics, in groups of five or more.',
    ),
  ],
  [
    'prefill',
    tr('settings.prefill', 'Prefill'),
    tr(
      'settings.suggests_a_first_draft_of_a',
      'Suggests a first draft of a review from the year’s evidence.',
    ),
  ],
  [
    'writingChecks',
    tr('settings.writing_checks', 'Writing checks'),
    tr(
      'settings.flags_vague_or_biased_wording_while',
      'Flags vague or biased wording while someone writes.',
    ),
  ],
  [
    'toneCheck',
    tr('settings.tone_check', 'Tone check'),
    tr(
      'settings.flags_feedback_that_may_land_badly',
      'Flags feedback that may land badly before it is sent.',
    ),
  ],
  [
    'setupByChat',
    tr('settings.set_up_in_words', 'Set up in words'),
    tr('settings.builds_a_cycles_setup_from_a', 'Builds a cycle’s setup from a description.'),
  ],
  [
    'automationsInWords',
    tr('settings.automations_in_words', 'Automations in words'),
    tr('settings.turns_a_sentence_into_an_automation', 'Turns a sentence into an automation.'),
  ],
  [
    'charts',
    tr('settings.charts_in_words', 'Charts in words'),
    tr(
      'settings.draws_the_analytics_chart_someone_asks',
      'Draws the analytics chart someone asks for.',
    ),
  ],
  [
    'learningSuggestions',
    tr('settings.learning_suggestions', 'Learning suggestions'),
    tr(
      'settings.suggests_courses_from_a_reviews_outcome',
      'Suggests courses from a review’s outcome.',
    ),
  ],
  [
    'calibrationSuggestions',
    tr('settings.calibration_suggestions', 'Calibration suggestions'),
    tr(
      'settings.proposes_moves_in_a_session_each',
      'Proposes moves in a session, each for a person to accept.',
    ),
  ],
  [
    'panel',
    tr('settings.ask_kithena', 'Ask Kithena'),
    tr(
      'settings.the_assistant_panel_on_every_performance',
      'The assistant panel on every Performance screen.',
    ),
  ],
] as const;

const CONNECTIONS = [
  [
    'google',
    tr('settings.google_workspace', 'Google Workspace'),
    tr(
      'settings.calendar_invitations_for_sessions_and_1_1s',
      'Calendar invitations for sessions and 1:1s.',
    ),
  ],
  [
    'microsoft',
    tr('settings.microsoft_365', 'Microsoft 365'),
    tr(
      'settings.calendar_invitations_for_sessions_and_1_1s',
      'Calendar invitations for sessions and 1:1s.',
    ),
  ],
  [
    'slack',
    tr('settings.slack', 'Slack'),
    tr(
      'settings.reminders_praise_and_asking_kithena_in',
      'Reminders, praise and asking Kithena in the chat app.',
    ),
  ],
  [
    'teams',
    tr('settings.microsoft_teams', 'Microsoft Teams'),
    tr('settings.reminders_and_praise_in_teams', 'Reminders and praise in Teams.'),
  ],
  [
    'gchat',
    tr('settings.google_chat', 'Google Chat'),
    tr('settings.reminders_and_praise_in_google_chat', 'Reminders and praise in Google Chat.'),
  ],
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
            title={tr('settings.when_people_see_their_reviews', 'When people see their reviews')}
            description={tr(
              'settings.where_a_new_cycle_starts_each',
              'Where a new cycle starts; each cycle can change it.',
            )}
          >
            <Choice
              ui={ui}
              path={['release']}
              label={tr('settings.release', 'Release')}
              options={[
                [
                  'manager',
                  tr('settings.as_each_is_submitted', 'As each is submitted'),
                  tr(
                    'settings.the_manager_releases_each_review_once',
                    'The manager releases each review once it is in.',
                  ),
                ],
                [
                  'hr_date',
                  tr('settings.on_a_date', 'On a date'),
                  tr(
                    'settings.hr_sets_one_day_and_everyone',
                    'HR sets one day, and everyone sees theirs then.',
                  ),
                ],
                [
                  'close',
                  tr('settings.when_the_cycle_closes', 'When the cycle closes'),
                  tr(
                    'settings.after_calibration_if_the_cycle_has',
                    'After calibration, if the cycle has one.',
                  ),
                ],
              ]}
            />
          </FormSection>
          <FormSection
            title={tr('settings.confidentiality', 'Confidentiality')}
            description={tr(
              'settings.peer_and_upward_answers_stay_unread',
              'Peer and upward answers stay unread until enough are in.',
            )}
          >
            <Count
              ui={ui}
              path={['minimum']}
              label={tr('settings.response_minimum', 'Response minimum')}
              hint={tr(
                'settings.confidential_answers_show_only_once_this',
                'Confidential answers show only once this many are in.',
              )}
              min={1}
              max={20}
              suffix={tr('settings.responses', 'responses')}
            />
          </FormSection>
          <FormSection
            title={tr('settings.workload', 'Workload')}
            description={tr(
              'settings.what_a_cycles_launch_checks_warn',
              'What a cycle’s launch checks warn about.',
            )}
          >
            <Count
              ui={ui}
              path={['perReviewer']}
              label={tr(
                'settings.peer_reviews_one_person_writes_at',
                'Peer reviews one person writes, at most',
              )}
              min={1}
              max={50}
              suffix={tr('settings.reviews', 'reviews')}
            />
            <Count
              ui={ui}
              path={['workload']}
              label={tr(
                'settings.warn_when_someone_has_more_than',
                'Warn when someone has more than',
              )}
              hint={tr('settings.listed_by_name_before_launch', 'Listed by name before launch.')}
              min={1}
              max={100}
              suffix={tr('settings.reviews', 'reviews')}
            />
          </FormSection>
          <FormSection
            title={tr('settings.after_release', 'After release')}
            description={tr(
              'settings.what_the_person_reviewed_can_do',
              'What the person reviewed can do.',
            )}
          >
            <Switches
              ui={ui}
              items={[
                {
                  path: ['acknowledge'],
                  label: tr('settings.ask_for_an_acknowledgement', 'Ask for an acknowledgement'),
                  hint: tr(
                    'settings.ive_read_this_is_not_agreement',
                    '“I’ve read this” is not agreement.',
                  ),
                },
                {
                  path: ['subjectComment'],
                  label: tr('settings.let_them_comment', 'Let them comment'),
                  hint: tr(
                    'settings.shown_to_their_manager_and_hr',
                    'Shown to their manager and HR.',
                  ),
                },
              ]}
            />
          </FormSection>
          <FormSection
            title={tr('settings.default_forms', 'Default forms')}
            description={tr(
              'settings.the_form_each_kind_of_review',
              'The form each kind of review starts with in a new cycle.',
            )}
          >
            {KINDS_WITH_FORMS.map(([kind, label]) => (
              <Choose
                key={kind}
                label={label}
                value={str(ui.get('templates', kind)) || 'default'}
                options={[
                  ['default', tr('settings.kithenas_default', 'Kithena’s default')],
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
          <FormSection title={tr('settings.who_gives_feedback', 'Who gives feedback')}>
            <Choice
              ui={ui}
              path={['who']}
              label={tr('settings.who_gives_feedback', 'Who gives feedback')}
              options={[
                ['anyone', tr('settings.anyone_to_anyone', 'Anyone, to anyone')],
                ['team', tr('settings.within_their_team', 'Within their team')],
                [
                  'nobody',
                  tr('settings.nobody', 'Nobody'),
                  tr(
                    'settings.feedback_is_off_praise_and_reviews_are',
                    'Feedback is off; praise and reviews are not.',
                  ),
                ],
              ]}
            />
          </FormSection>
          <FormSection
            title={tr('settings.who_sees_it', 'Who sees it')}
            description={tr(
              'settings.unless_the_writer_narrows_it',
              'Unless the writer narrows it.',
            )}
          >
            <Choice
              ui={ui}
              path={['sees']}
              label={tr('settings.who_sees_it', 'Who sees it')}
              options={[
                ['recipient', tr('settings.only_the_receiver', 'Only the receiver')],
                [
                  'recipient_manager',
                  tr('settings.the_receiver_and_their_manager', 'The receiver and their manager'),
                ],
                [
                  'recipient_manager_hr',
                  tr(
                    'settings.the_receiver_their_manager_and_hr',
                    'The receiver, their manager and HR',
                  ),
                ],
              ]}
            />
          </FormSection>
          <FormSection title={tr('settings.writers_names', 'Writers’ names')}>
            <Choice
              ui={ui}
              path={['names']}
              label={tr('settings.writers_names', 'Writers’ names')}
              options={[
                [
                  'never',
                  tr('settings.always_hidden', 'Always hidden'),
                  tr(
                    'settings.shown_as_someone_at_the_company',
                    'Shown as “Someone at the company”.',
                  ),
                ],
                ['always', tr('settings.always_shown', 'Always shown')],
                ['writer', tr('settings.the_writer_chooses', 'The writer chooses')],
              ]}
            />
          </FormSection>
          <FormSection
            title={tr('settings.praise', 'Praise')}
            description={tr(
              'settings.thanks_in_public_tagged_with_a',
              'Thanks in public, tagged with a company value.',
            )}
          >
            <Switches
              ui={ui}
              items={[
                {
                  path: ['praise', 'public'],
                  label: tr('settings.praise_is_public', 'Praise is public'),
                  hint: tr('settings.on_the_companys_praise_wall', 'On the company’s praise wall.'),
                },
                {
                  path: ['praise', 'chat'],
                  label: tr('settings.post_praise_to_the_chat_app', 'Post praise to the chat app'),
                  hint: tr(
                    'settings.when_the_chat_app_is_connected',
                    'When the chat app is connected.',
                  ),
                },
              ]}
            />
            <TagsInput
              label={tr('settings.company_values', 'Company values')}
              hint={tr('settings.enter_or_a_comma_adds_one', 'Enter or a comma adds one.')}
              max={20}
              disabled={ui.off}
              value={list(ui.get('praise', 'values')) as readonly string[]}
              onChange={(v) => {
                ui.set(['praise', 'values'], v);
              }}
            />
          </FormSection>
          <FormSection title={tr('settings.writing_help', 'Writing help')}>
            <Switches
              ui={ui}
              items={[
                {
                  path: ['toneCheck'],
                  label: tr(
                    'settings.check_the_tone_before_sending',
                    'Check the tone before sending',
                  ),
                  hint: tr(
                    'settings.the_writer_decides_nothing_is_changed_for',
                    'The writer decides; nothing is changed for them.',
                  ),
                },
                {
                  path: ['templates'],
                  label: tr('settings.offer_feedback_templates', 'Offer feedback templates'),
                },
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
            title={tr('settings.learning_platforms', 'Learning platforms')}
            description={tr(
              'settings.completions_arrive_on_their_own_from',
              'Completions arrive on their own from a connected platform.',
            )}
          >
            <List>
              {providers.map((p) => (
                <ListItem
                  key={p.name}
                  description={
                    p.connected
                      ? tr(
                          'settings.count_courses',
                          { one: '{{count}} course', other: '{{count}} courses' },
                          { count: p.items },
                        )
                      : tr('settings.not_connected_yet', 'Not connected yet')
                  }
                  trailing={
                    <Badge size="sm" tone={p.connected ? 'success' : 'neutral'}>
                      {p.connected
                        ? tr('settings.connected', 'Connected')
                        : tr('settings.off', 'Off')}
                    </Badge>
                  }
                >
                  {p.name}
                </ListItem>
              ))}
            </List>
          </FormSection>
          <FormSection title={tr('settings.completion', 'Completion')}>
            <Slider
              label={tr(
                'settings.attendance_that_completes_a_live_session',
                'Attendance that completes a live session',
              )}
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
              label={tr('settings.certificates_stay_valid_for', 'Certificates stay valid for')}
              hint={tr('settings.0_they_never_expire', '0: they never expire.')}
              min={0}
              max={20}
              suffix={tr('settings.years', 'years')}
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
            title={tr('settings.nine_box_guide', 'Nine-box guide')}
            description={tr(
              'settings.the_share_of_people_expected_in',
              'The share of people expected in each box: a guide for the session, never a quota.',
            )}
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
              {total === 100
                ? tr('settings.adds_up_to_the_whole_company', 'Adds up to the whole company.')
                : tr('settings.should_add_up_to_100', 'Should add up to 100%.')}
            </p>
          </FormSection>
          <FormSection
            title={tr('settings.in_a_session', 'In a session')}
            description={tr('settings.what_calibrators_see', 'What calibrators see.')}
          >
            <Switches
              ui={ui}
              items={[
                {
                  path: ['managersOwnOnly'],
                  label: tr(
                    'settings.managers_see_only_their_own_people',
                    'Managers see only their own people',
                  ),
                  hint: tr(
                    'settings.hr_and_the_sessions_owner_see',
                    'HR and the session’s owner see everyone in it.',
                  ),
                },
                {
                  path: ['peerNames'],
                  label: tr('settings.show_peer_reviewers_names', 'Show peer reviewers’ names'),
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
          title={tr('settings.features', 'Features')}
          description={tr(
            'settings.each_on_or_off_for_the',
            'Each on or off for the whole company. Every output is logged, and a person confirms every number.',
          )}
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
          <FormSection title={tr('settings.calendars_and_chat', 'Calendars and chat')}>
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
            title={tr('settings.tools_people_may_connect', 'Tools people may connect')}
            description={tr(
              'settings.each_person_still_decides_for_their',
              'Each person still decides for their own work, in My connected tools; off here, nobody can.',
            )}
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
          title={tr('settings.legal_entities', 'Legal entities')}
          description={tr(
            'settings.until_a_works_council_agrees_people',
            'Until a works council agrees, people in that entity are left out of cycles, and AI and connected tools are off for them.',
          )}
        >
          {data.legalEntities.length === 0 ? (
            <p className="text-sm text-fg-muted">
              {tr(
                'settings.the_company_has_no_legal_entities',
                'The company has no legal entities in People yet.',
              )}
            </p>
          ) : (
            data.legalEntities.map((entity) => {
              const agreed = ui.get('worksCouncil', entity, 'agreed');
              return (
                <div key={entity} className="flex max-w-2xl flex-col gap-3 touch:max-w-none">
                  <Switches
                    ui={ui}
                    items={[
                      {
                        path: ['worksCouncil', entity, 'on'],
                        label: entity,
                        hint: tr('settings.agreed', 'Agreed'),
                      },
                    ]}
                  />
                  {ui.get('worksCouncil', entity, 'on') === true ? (
                    <Field>
                      <FieldLabel>{tr('settings.agreed_on', 'Agreed on')}</FieldLabel>
                      <FieldControl>
                        <DatePicker
                          label={tr('settings.agreed_on_2', '{{entity}} agreed on', { entity })}
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
        title={tr('settings.rating_scale', 'Rating scale')}
        description={tr(
          'settings.every_performance_score_is_computed_on',
          'Every performance score is computed on it. Changing it changes no score already submitted.',
        )}
      >
        <Scale
          value={list(ui.get('scale')) as readonly ScaleOption[]}
          disabled={ui.off}
          onChange={(s) => {
            ui.set(['scale'], s as unknown as Json);
          }}
        />
      </FormSection>
      <FormSection title={tr('settings.scores', 'Scores')}>
        <Field>
          <FieldLabel>{tr('settings.decimal_places', 'Decimal places')}</FieldLabel>
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
          <FieldLabel>{tr('settings.company_time_zone', 'Company time zone')}</FieldLabel>
          <FieldControl>
            <Combobox
              label={tr('settings.company_time_zone', 'Company time zone')}
              options={ZONES}
              value={str(ui.get('zone'))}
              searchPlaceholder={tr('settings.find_a_zone', 'Find a zone')}
              onChange={(v) => {
                if (!ui.off && typeof v === 'string') ui.set(['zone'], v);
              }}
            />
          </FieldControl>
          <FieldDescription>
            {tr(
              'settings.cycles_start_and_fall_due_in',
              'Cycles start and fall due in it unless one says otherwise.',
            )}
          </FieldDescription>
        </Field>
      </FormSection>
      <FormSection
        title={tr('settings.parts_of_performance', 'Parts of Performance')}
        description={tr(
          'settings.off_hides_the_part_for_everyone',
          'Off hides the part for everyone.',
        )}
      >
        <Switches
          ui={ui}
          items={[
            {
              path: ['parts', 'goals'],
              label: tr('settings.goals', 'Goals'),
              hint: tr(
                'settings.goals_key_results_and_check_ins',
                'Goals, key results and check-ins.',
              ),
            },
            {
              path: ['parts', 'learning'],
              label: tr('settings.learning', 'Learning'),
              hint: tr(
                'settings.courses_sessions_and_attendance',
                'Courses, sessions and attendance.',
              ),
            },
            {
              path: ['parts', 'calibration'],
              label: tr('settings.calibration', 'Calibration'),
              hint: tr(
                'settings.sessions_over_a_cycles_scores_and_the',
                'Sessions over a cycle’s scores, and the nine-box.',
              ),
            },
            {
              path: ['parts', 'automations'],
              label: tr('settings.automations', 'Automations'),
              hint: tr(
                'settings.cycles_made_on_a_calendar_or',
                'Cycles made on a calendar or after an event.',
              ),
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
        title={tr('settings.periods', 'Periods')}
        description={tr(
          'settings.what_a_goal_is_set_for',
          'What a goal is set for, and how often its owner checks in.',
        )}
      >
        <List>
          {periods.map((p) => (
            <ListItem
              key={p.id}
              description={tr(
                'settings.to_check_ins',
                '{{from}} to {{to}} · check-ins {{cadence}}',
                { from: day(p.from), to: day(p.to), cadence: cadence(p.cadence) },
              )}
              trailing={
                ui.off ? undefined : (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={tr('settings.remove', 'Remove {{name}}', { name: p.name })}
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
            {tr('settings.add_a_period', 'Add a period')}
          </Button>
        )}
      </FormSection>
      <FormSection title={tr('settings.goals', 'Goals')}>
        <Switches
          ui={ui}
          items={[
            {
              path: ['weighted'],
              label: tr('settings.weighted_goals', 'Weighted goals'),
              hint: tr(
                'settings.a_persons_goals_for_a_period',
                'A person’s goals for a period add up to 100%.',
              ),
            },
            {
              path: ['rollUp'],
              label: tr(
                'settings.parent_goals_take_their_childrens_progress',
                'Parent goals take their children’s progress',
              ),
              hint: tr(
                'settings.off_the_parents_owner_updates_it',
                'Off: the parent’s owner updates it.',
              ),
            },
            {
              path: ['follow'],
              label: tr(
                'settings.key_results_can_follow_a_linear',
                'Key results can follow a Linear project or Jira epic',
              ),
              hint: tr(
                'settings.once_those_tools_are_connected',
                'Once those tools are connected.',
              ),
            },
          ]}
        />
      </FormSection>
      <Modal
        open={adding}
        onClose={() => {
          setAdding(false);
        }}
        title={tr('settings.add_a_period', 'Add a period')}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setAdding(false);
              }}
            >
              {tr('settings.cancel', 'Cancel')}
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
              {tr('settings.add', 'Add')}
            </Button>
          </>
        }
      >
        <Field required>
          <FieldLabel>{tr('settings.name', 'Name')}</FieldLabel>
          <Input
            value={draft.name}
            placeholder="Q1 2027"
            onChange={(e) => {
              setDraft({ ...draft, name: e.target.value });
            }}
          />
        </Field>
        <Field required>
          <FieldLabel>{tr('settings.from', 'From')}</FieldLabel>
          <FieldControl>
            <DatePicker
              label={tr('settings.from', 'From')}
              value={draft.from === '' ? null : draft.from}
              onChange={(d) => {
                setDraft({ ...draft, from: d ?? '' });
              }}
            />
          </FieldControl>
        </Field>
        <Field required>
          <FieldLabel>{tr('settings.to', 'To')}</FieldLabel>
          <FieldControl>
            <DatePicker
              label={tr('settings.to', 'To')}
              value={draft.to === '' ? null : draft.to}
              onChange={(d) => {
                setDraft({ ...draft, to: d ?? '' });
              }}
            />
          </FieldControl>
        </Field>
        <Choose
          label={tr('settings.check_ins', 'Check-ins')}
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
      title={tr('settings.hr_to_performance', 'HR to Performance')}
      description={tr(
        'settings.they_run_cycles_and_calibration_and',
        'They run cycles and calibration and read every review, beyond the company’s administrators, who always can.',
      )}
    >
      {ids.length === 0 ? (
        <p className="text-sm text-fg-muted">
          {tr('settings.only_the_companys_administrators', 'Only the company’s administrators.')}
        </p>
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
                    aria-label={
                      named[id] === undefined
                        ? tr('settings.remove_this_person', 'Remove this person')
                        : tr('settings.remove_2', 'Remove {{value}}', { value: named[id] })
                    }
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
              {named[id] ?? tr('settings.someone_who_left', 'Someone who left')}
            </ListItem>
          ))}
        </List>
      )}
      {ui.off ? null : (
        <PersonPicker
          act={act}
          label={tr('settings.add_someone', 'Add someone')}
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
            label={tr('settings.value', 'Value')}
            value={o.value}
            disabled={disabled}
            onChange={(v) => {
              if (v !== null) change(i, { value: v });
            }}
          />
          <Field>
            <FieldLabel>{tr('settings.label', 'Label')}</FieldLabel>
            <Input
              value={o.label}
              disabled={disabled}
              onChange={(e) => {
                change(i, { label: e.target.value });
              }}
            />
          </Field>
          <Field>
            <FieldLabel>{tr('settings.what_it_means', 'What it means')}</FieldLabel>
            <Input
              value={o.description ?? ''}
              placeholder={tr('settings.optional', 'Optional')}
              disabled={disabled}
              onChange={(e) => {
                change(i, { description: e.target.value === '' ? null : e.target.value });
              }}
            />
          </Field>
          <Button
            variant="ghost"
            aria-label={
              o.label === ''
                ? tr('settings.remove_this_level', 'Remove this level')
                : tr('settings.remove_2', 'Remove {{value}}', { value: o.label })
            }
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
          {tr('settings.add_a_level', 'Add a level')}
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
    <Loaded load={props.load} what={tr('settings.the_ai_log', 'the AI log')}>
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title={tr('settings.ai_log', 'AI log')}
            description={tr(
              'settings.each_time_ai_wrote_suggested_or',
              'Each time AI wrote, suggested or checked something: the feature, for whom, the prompt version and what became of it.',
            )}
          />
          <Card>
            <CardContent className="overflow-x-auto">
              {data.rows.length === 0 ? (
                <EmptyState
                  icon={<icons.assistant aria-hidden />}
                  title={tr('settings.no_ai_output_yet', 'No AI output yet')}
                  description={tr(
                    'settings.summaries_suggestions_and_checks_are_logged',
                    'Summaries, suggestions and checks are logged here.',
                  )}
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tr('settings.when', 'When')}</TableHead>
                      <TableHead>{tr('settings.feature', 'Feature')}</TableHead>
                      <TableHead>{tr('settings.for', 'For')}</TableHead>
                      <TableHead>{tr('settings.on', 'On')}</TableHead>
                      <TableHead>{tr('settings.prompt', 'Prompt')}</TableHead>
                      <TableHead>{tr('settings.outcome', 'Outcome')}</TableHead>
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
    /** Whether it can be linked here yet. */
    readonly available?: boolean;
    /** Who they are in it, once linked. */
    readonly account?: string | null;
    /** Where the company installs its app first. */
    readonly install?: string | null;
  }[];
  readonly reads: readonly {
    readonly source: string;
    readonly at: string;
    readonly purpose: string;
  }[];
}

const SOURCE: Readonly<Record<string, string>> = {
  slack: tr('settings.slack', 'Slack'),
  teams: tr('settings.microsoft_teams', 'Microsoft Teams'),
  gchat: tr('settings.google_chat', 'Google Chat'),
  meet: tr('settings.google_meet', 'Google Meet'),
  github: 'GitHub',
  gitlab: 'GitLab',
  linear: tr('settings.linear', 'Linear'),
  jira: tr('settings.jira', 'Jira'),
  confluence: tr('settings.confluence', 'Confluence'),
};

/** S12: what I let Kithena read of my own work, each on or off, and every read. */
export function ConnectedTools(props: ScreenProps<ConnectedToolsData>): JSX.Element {
  const act = useAct(props);
  const [going, setGoing] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const linked = props.search?.['linked'];
  const notLinked = props.search?.['notLinked'];
  // On with nothing linked goes to the tool to approve it; Kithena comes back here.
  const turn = (source: string, on: boolean): void => {
    setRefused(null);
    if (!on) {
      act.run('SetPerformanceGrant', { source, input: { on } });
      return;
    }
    setGoing(source);
    void act
      .call('SetPerformanceGrant', { source, input: { on, origin: window.location.origin } })
      .then((d) => {
        const link = d.ok ? (d.data as { link?: string }).link : undefined;
        if (link !== undefined) {
          window.location.assign(link);
          return;
        }
        setGoing(null);
        if (d.ok) props.onRefresh?.();
        else setRefused(d.message);
      });
  };
  return (
    <Loaded load={props.load} what={tr('settings.your_connected_tools', 'your connected tools')}>
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title={tr('settings.my_connected_tools', 'My connected tools')}
            description={tr(
              'settings.what_kithena_may_read_of_your',
              'What Kithena may read of your own work to suggest evidence for reviews about you and by you. Off stops it at once and drops what was read.',
            )}
          />
          <Refusal error={refused ?? act.error} />
          {linked === undefined ? null : (
            <Alert
              tone="success"
              title={tr('settings.is_linked', '{{linked}} is linked', { linked })}
            >
              {tr(
                'settings.kithenas_ai_may_now_read_what',
                "Kithena's AI may now read what you can see in {{linked}} when it drafts a review with you.",
                { linked },
              )}
            </Alert>
          )}
          {notLinked === undefined ? null : <Alert tone="warning" title={notLinked} />}
          <FormSections>
            <FormSection
              title={tr('settings.tools', 'Tools')}
              description={tr(
                'settings.each_is_read_only_for_reviews',
                "Each is read only for reviews about you or by you, only for the review's period, and nothing read is kept.",
              )}
            >
              <List>
                {data.sources.map((s) => {
                  const name = SOURCE[s.source] ?? s.source;
                  const available = s.available !== false;
                  return (
                    <ListItem
                      key={s.source}
                      description={
                        !available
                          ? tr('settings.not_available_yet', 'Not available yet')
                          : [
                              s.account === null || s.account === undefined
                                ? s.on
                                  ? null
                                  : tr(
                                      'settings.turning_it_on_asks_you_to',
                                      'Turning it on asks you to approve it there',
                                    )
                                : tr('settings.linked_as', 'Linked as {{account}}', {
                                    account: s.account,
                                  }),
                              s.at === null
                                ? null
                                : s.on
                                  ? tr('settings.on_since', 'On since {{at}}', { at: when(s.at) })
                                  : tr('settings.off_since', 'Off since {{at}}', {
                                      at: when(s.at),
                                    }),
                            ]
                              .filter((x) => x !== null)
                              .join(' · ')
                      }
                      trailing={
                        <span className="flex items-center gap-2">
                          {s.install === null || s.install === undefined || s.on ? null : (
                            <Button asChild size="sm" variant="ghost">
                              <a href={s.install} target="_blank" rel="noreferrer">
                                {tr(
                                  'settings.install_for_your_company',
                                  'Install for your company',
                                )}
                              </a>
                            </Button>
                          )}
                          <Switch
                            aria-label={name}
                            checked={s.on}
                            disabled={!available || act.pending || going !== null}
                            onCheckedChange={(on) => {
                              turn(s.source, on);
                            }}
                          />
                        </span>
                      }
                    >
                      {name}
                    </ListItem>
                  );
                })}
              </List>
            </FormSection>
            <FormSection
              title={tr('settings.recent_reads', 'Recent reads')}
              description={tr(
                'settings.every_time_kithena_read_something',
                'Every time Kithena read something.',
              )}
            >
              {data.reads.length === 0 ? (
                <p className="text-sm text-fg-muted">
                  {tr('settings.nothing_has_been_read', 'Nothing has been read.')}
                </p>
              ) : (
                <List>
                  {data.reads.map((r) => (
                    <ListItem key={`${r.source}-${r.at}`} description={r.purpose} meta={when(r.at)}>
                      {SOURCE[r.source] ?? r.source}
                    </ListItem>
                  ))}
                </List>
              )}
            </FormSection>
          </FormSections>
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
        title={tr('settings.retention', 'Retention')}
        description={tr(
          'settings.how_long_each_kind_of_record_2',
          'How long each kind of record is kept after someone leaves. Nothing is deleted until HR confirms, and a legal hold keeps everything of the person it names.',
        )}
      />
      <Refusal error={act.error} />
      <Card>
        <CardHeader>
          <CardTitle level={2}>
            {tr('settings.after_someone_leaves', 'After someone leaves')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-4">
            {data.kinds.map((k) => {
              const key = YEARS_OF[k.kind] ?? k.kind;
              return (
                <NumberField
                  key={k.kind}
                  label={k.label}
                  suffix={tr('settings.years', 'years')}
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
            {tr(
              'settings.a_leavers_own_notes_go_30',
              'A leaver’s own notes go 30 days after their last day, whatever is set here.',
            )}
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
          <CardTitle level={2}>{tr('settings.due_to_go', 'Due to go')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 overflow-x-auto">
          {data.due.length === 0 ? (
            <EmptyState
              icon={<icons.archive aria-hidden />}
              title={tr('settings.nothing_is_due', 'Nothing is due')}
              description={tr(
                'settings.records_appear_here_once_their_time',
                'Records appear here once their time after someone leaves has passed.',
              )}
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <span className="sr-only">{tr('settings.choose', 'Choose')}</span>
                    </TableHead>
                    <TableHead>{tr('settings.person', 'Person')}</TableHead>
                    <TableHead>{tr('settings.left', 'Left')}</TableHead>
                    <TableHead>{tr('settings.what_goes', 'What goes')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.due.map((d) => (
                    <TableRow key={d.personId}>
                      <TableCell>
                        <Checkbox
                          aria-label={tr(
                            'settings.delete_s_due_records',
                            'Delete {{name}}’s due records',
                            { name: d.name },
                          )}
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
                        {d.what
                          .map((w) =>
                            tr('settings.text', '{{label}}: {{count}}', {
                              label: w.label,
                              count: String(w.count),
                            }),
                          )
                          .join(' · ')}
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
                  ? tr('settings.delete', 'Delete')
                  : tr('settings.delete_records', 'Delete {{length}} records', {
                      length: tr(
                        'settings.count_peoples',
                        { one: '{{count}} person’s', other: '{{count}} people’s' },
                        { count: chosen.length },
                      ),
                    })}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle level={2}>{tr('settings.legal_holds', 'Legal holds')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {data.holds.length === 0 ? (
            <p className="text-sm text-fg-muted">
              {tr('settings.no_ones_records_are_held', 'No one’s records are held.')}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr('settings.person', 'Person')}</TableHead>
                  <TableHead>{tr('settings.why', 'Why')}</TableHead>
                  <TableHead>{tr('settings.since_2', 'Since')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{tr('settings.lift', 'Lift')}</span>
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
                        {tr('settings.lift', 'Lift')}
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
            {tr('settings.place_a_hold', 'Place a hold')}
          </Button>
        </CardContent>
      </Card>

      {data.upcoming.length === 0 ? null : (
        <Card>
          <CardHeader>
            <CardTitle level={2}>{tr('settings.coming_up', 'Coming up')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr('settings.person', 'Person')}</TableHead>
                  <TableHead>{tr('settings.left', 'Left')}</TableHead>
                  <TableHead>{tr('settings.next_due', 'Next due')}</TableHead>
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
          <CardTitle level={2}>{tr('settings.a_persons_data', 'A person’s data')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-fg-muted">
            {tr(
              'settings.for_a_request_to_see_or',
              'For a request to see or take their data: everything about them in Performance, without the private questions about them or the names of anyone who wrote in confidence.',
            )}
          </p>
          <PersonPicker
            act={act}
            label={tr('settings.whose_data', 'Whose data')}
            value={whose}
            onChange={setWhose}
          />
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
            {tr('settings.export_their_data', 'Export their data')}
          </Button>
        </CardContent>
      </Card>

      <Modal
        open={confirming}
        onClose={() => {
          setConfirming(false);
        }}
        title={tr('settings.delete_these_records', 'Delete these records?')}
        description={tr(
          'settings.they_are_gone_for_good_reviews',
          'They are gone for good: reviews, feedback, notes, learning and AI output whose time has passed. The activity log keeps that you did it.',
        )}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirming(false);
              }}
            >
              {tr('settings.cancel', 'Cancel')}
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
              {tr('settings.delete', 'Delete')}
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
        title={tr('settings.place_a_legal_hold', 'Place a legal hold')}
        description={tr(
          'settings.nothing_of_this_persons_is_deleted',
          'Nothing of this person’s is deleted until the hold is lifted, whatever the retention periods say.',
        )}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setHolding(false);
              }}
            >
              {tr('settings.cancel', 'Cancel')}
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
              {tr('settings.place_the_hold', 'Place the hold')}
            </Button>
          </>
        }
      >
        <PersonPicker
          act={act}
          label={tr('settings.whose_records', 'Whose records')}
          value={holdFor}
          onChange={setHoldFor}
        />
        <Field required>
          <FieldLabel>{tr('settings.why', 'Why')}</FieldLabel>
          <Input
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
            placeholder={tr(
              'settings.a_tribunal_claim_an_investigation',
              'A tribunal claim, an investigation',
            )}
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
            title={tr('settings.webhooks', 'Webhooks')}
            description={tr(
              'settings.performances_events_sent_to_your_own',
              'Performance’s events sent to your own systems as they happen, in the order they happened, each signed so you can check it came from Kithena.',
            )}
            actions={
              data.available ? (
                <Button
                  startIcon={<icons.add aria-hidden />}
                  onClick={() => {
                    setAdding(true);
                  }}
                >
                  {tr('settings.add_an_endpoint', 'Add an endpoint')}
                </Button>
              ) : null
            }
          />
          <Refusal error={act.error} />
          {data.available ? null : (
            <Alert tone="info">
              {tr('settings.webhooks_arent_set_up_here_yet', 'Webhooks aren’t set up here yet.')}
            </Alert>
          )}
          {tested === null ? null : <Alert tone="info">{tested}</Alert>}
          <Card>
            <CardContent className="overflow-x-auto">
              {data.rows.length === 0 ? (
                <EmptyState
                  icon={<icons.link aria-hidden />}
                  title={tr('settings.no_endpoints', 'No endpoints')}
                  description={tr(
                    'settings.add_one_to_receive_reviews_released',
                    'Add one to receive reviews released, cycles launched, ratings finalised and the rest.',
                  )}
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tr('settings.endpoint', 'Endpoint')}</TableHead>
                      <TableHead>{tr('settings.events', 'Events')}</TableHead>
                      <TableHead>{tr('settings.status', 'Status')}</TableHead>
                      <TableHead>{tr('settings.last_delivery', 'Last delivery')}</TableHead>
                      <TableHead>
                        <span className="sr-only">{tr('settings.actions', 'Actions')}</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-sm">{r.url}</TableCell>
                        <TableCell className="text-sm">
                          {r.events.includes('*')
                            ? tr('settings.every_event', 'Every event')
                            : r.events.map(eventWords).join(', ')}
                        </TableCell>
                        <TableCell>
                          {r.disabled !== null ? (
                            <span className="flex flex-col gap-0.5">
                              <Badge size="sm" tone="danger">
                                {tr('settings.off', 'Off')}
                              </Badge>
                              <span className="text-xs text-fg-muted">{r.disabled.why}</span>
                            </span>
                          ) : r.failing !== null ? (
                            <Badge size="sm" tone="warning">
                              {tr('settings.failing_since', 'Failing since {{since}}', {
                                since: when(r.failing.since),
                              })}
                            </Badge>
                          ) : (
                            <Badge size="sm" tone="success">
                              {tr('settings.on', 'On')}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-fg-muted">
                          {r.last === null
                            ? tr('settings.none_yet', 'None yet')
                            : tr('settings.text_2', '{{at}} · {{value}}', {
                                at: when(r.last.at),
                                value:
                                  r.last.status === 0
                                    ? tr('settings.no_answer', 'no answer')
                                    : String(r.last.status),
                              })}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={tr('settings.actions_for', 'Actions for {{url}}', {
                                  url: r.url,
                                })}
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
                                          ? tr(
                                              'settings.the_test_reached',
                                              'The test reached {{url}} ({{status}}).',
                                              { url: r.url, status: String(status) },
                                            )
                                          : status === 0
                                            ? tr(
                                                'settings.the_test_did_not_reach_no_answer',
                                                'The test did not reach {{url}}: no answer.',
                                                { url: r.url },
                                              )
                                            : tr(
                                                'settings.the_test_did_not_reach_answered',
                                                'The test did not reach {{url}}: it answered {{status}}.',
                                                { url: r.url, status: String(status) },
                                              ),
                                      );
                                    },
                                  );
                                }}
                              >
                                {tr('settings.send_a_test', 'Send a test')}
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
                                {tr('settings.new_secret', 'New secret')}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => {
                                  act.run('ChangePerformanceWebhook', {
                                    id: r.id,
                                    input: { on: r.disabled !== null },
                                  });
                                }}
                              >
                                {r.disabled === null
                                  ? tr('settings.turn_off', 'Turn off')
                                  : tr('settings.turn_on', 'Turn on')}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => {
                                  act.run('RemovePerformanceWebhook', { id: r.id });
                                }}
                              >
                                {tr('settings.remove_3', 'Remove')}
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
            title={tr('settings.add_an_endpoint', 'Add an endpoint')}
            description={tr(
              'settings.an_https_address_on_the_public',
              'An https address on the public internet. It is sent only what is written from now on.',
            )}
            footer={
              <>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setAdding(false);
                  }}
                >
                  {tr('settings.cancel', 'Cancel')}
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
                  {tr('settings.add', 'Add')}
                </Button>
              </>
            }
          >
            <Refusal error={act.error} />
            <Field required>
              <FieldLabel>{tr('settings.address', 'Address')}</FieldLabel>
              <Input
                type="url"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                }}
                placeholder="https://hooks.example.com/kithena"
              />
            </Field>
            <RadioGroup
              aria-label={tr('settings.which_events', 'Which events')}
              value={which}
              onValueChange={setWhich}
            >
              <RadioCard value="every">{tr('settings.every_event', 'Every event')}</RadioCard>
              <RadioCard value="choose">{tr('settings.only_these', 'Only these')}</RadioCard>
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
            title={tr('settings.the_endpoints_secret', 'The endpoint’s secret')}
            description={tr(
              'settings.shown_this_once_every_delivery_carries',
              'Shown this once. Every delivery carries kithena-signature: v1=<hex>, the HMAC-SHA256 of the body with this secret. After a new secret, the old one also signs for a day.',
            )}
            footer={
              <Button
                onClick={() => {
                  setSecret(null);
                }}
              >
                {tr('settings.done', 'Done')}
              </Button>
            }
          >
            <CopyField
              value={secret ?? ''}
              label={tr('settings.copy_the_secret', 'Copy the secret')}
            />
          </Modal>
        </div>
      )}
    </Loaded>
  );
}
