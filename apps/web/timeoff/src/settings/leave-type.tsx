import {
  Alert,
  Avatar,
  Badge,
  Button,
  List,
  ListItem,
  Field,
  FieldControl,
  FieldLabel,
  FormSection,
  FormSections,
  IconList,
  IconListItem,
  NumberField,
  PageHeader,
  PageSection,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stat,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';
import { amount } from '../overview/overview';
import {
  MonthDayField,
  SettingsSkeleton,
  Toggle,
  appliesToLabel,
  daysLabel,
  longDate,
  monthDay,
  placeName,
  useSaved,
  type LeaveTypeRow,
  type Predicate,
} from './shared';
import { t } from '../i18n';

/**
 * Editing a policy (T30, TOF-079): a leave type's allowance by years of
 * service, how it is earned, what carries into next year and the rules for
 * asking, saved as a draft and published from the start of the leave year.
 *
 * Beside the rules, what publishing the draft would do, member by member, as
 * Time Off folds it: who gets more days, who fewer, and who would lose days
 * at the year end, with the employee's own view of it for one person. The
 * numbers are Time Off's, never this screen's; edits not yet saved say so
 * rather than show a preview of something else.
 *
 * Two columns at a desk, one under 64rem of the page's own width: the rules,
 * then the preview.
 */

type Band = { readonly fromYears: number; readonly days: string };
type MonthDay = { readonly month: number; readonly day: number };

export interface PolicyDefinition {
  readonly leaveTypeKey: string;
  readonly allowance: readonly Band[];
  readonly year: MonthDay;
  readonly earning: 'upfront' | 'monthly';
  readonly proRata: boolean;
  readonly keepEarningOnParental: boolean;
  readonly probationMonths: number;
  readonly carryOver: { readonly maxDays: string; readonly useBy: MonthDay } | null;
  readonly requests: {
    readonly halfDays: boolean;
    readonly showWhoIsOff: boolean;
    readonly blockBelowMinimum: boolean;
  };
  readonly negativeBalance: unknown;
  readonly appliesTo: Predicate | null;
}

interface Change {
  readonly current: string;
  readonly draft: string;
}

export interface PolicyPreview {
  readonly draftVersion: number | null;
  /** The leave year's first day: what the draft is published from. */
  readonly effectiveFrom: string;
  readonly yearEnd: string;
  readonly members: readonly {
    readonly personId: string;
    readonly displayName: string;
    readonly allowance: Change;
    readonly left: Change;
    readonly lostAtYearEnd: Change;
  }[];
  /** The draft running beside the version in effect (TOF-093); `null` when none was started. */
  readonly shadow: {
    readonly from: string;
    readonly to: string;
    /** Today, or the run's last day once it is over. */
    readonly asOf: string;
    readonly members: readonly {
      readonly personId: string;
      readonly displayName: string;
      readonly credited: Change;
      readonly balance: Change;
    }[];
  } | null;
}

export interface LeaveTypeData {
  readonly leaveType: LeaveTypeRow;
  readonly policies: readonly {
    readonly id: string;
    readonly versions: readonly {
      readonly version: number;
      readonly status: 'draft' | 'published';
      readonly effectiveFrom: string | null;
      readonly definition: PolicyDefinition;
    }[];
  }[];
  /** The policy on the page: the address's, else the type's first. */
  readonly policyId: string | null;
  /** What publishing its draft would do; `null` without a draft. */
  readonly preview: PolicyPreview | null;
  /** Whose view of the draft to show (`?as=`). */
  readonly as: string | null;
  /** The countries and work locations members are in: what a policy can reach. */
  readonly places?: {
    readonly countries: readonly string[];
    readonly locations: readonly string[];
  };
}

export interface LeaveTypeProps {
  readonly load: Loadable<LeaveTypeData>;
  readonly onSaveDraft?: (policyId: string, definition: PolicyDefinition) => Promise<Outcome>;
  readonly onPublish?: (policyId: string, effectiveFrom: string) => Promise<Outcome>;
  /** Another of the type's policies. */
  readonly onPolicy?: (policyId: string) => void;
  /** Show the draft as this member sees it. */
  readonly onPreviewAs?: (personId: string) => void;
  /** Start (`true`) or stop the draft's month beside the version in effect. */
  readonly onShadow?: (policyId: string, run: boolean) => Promise<Outcome>;
  /** A first policy for a tracked type that has none (TOF-099a). */
  readonly onStartPolicy?: (leaveTypeKey: string) => Promise<Outcome>;
}

/** "Start a policy", saying Time Off's refusal where it is pressed. */
function StartPolicy({ onStart }: { readonly onStart: () => Promise<Outcome> }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  return (
    <span className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="primary"
        loading={busy}
        loadingLabel={t('settings.leave-type.starting', 'Starting')}
        onClick={() => {
          setBusy(true);
          setRefused(null);
          void onStart().then((outcome) => {
            setBusy(false);
            if (!outcome.ok) setRefused(outcome.message);
          });
        }}
      >
        {t('settings.leave-type.start_a_policy', 'Start a policy')}
      </Button>
      {refused === null ? null : <span className="text-sm text-danger-fg">{refused}</span>}
    </span>
  );
}

const page = '@container/policy flex flex-col gap-6';
const columns =
  'flex flex-col gap-6 @min-[64rem]/policy:grid @min-[64rem]/policy:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] @min-[64rem]/policy:items-start';

export function LeaveType(props: LeaveTypeProps): JSX.Element {
  const { load } = props;
  if (load.status === 'loading') return <LeaveTypeSkeleton />;
  return (
    <div className={page}>
      {load.status === 'error' ? (
        <PageHeader title={t('settings.leave-type.leave_type', 'Leave type')} />
      ) : null}
      <Loaded load={load} what={t('settings.leave-type.the_leave_type', 'the leave type')}>
        {(data) => <Ready {...props} data={data} />}
      </Loaded>
    </div>
  );
}

/* ---------------------------------------------------------------- page -- */

function Ready({
  data,
  onSaveDraft,
  onPublish,
  onPolicy,
  onPreviewAs,
  onShadow,
  onStartPolicy,
}: LeaveTypeProps & { readonly data: LeaveTypeData }): JSX.Element {
  const type = data.leaveType.definition;
  const policy = data.policies.find((p) => p.id === data.policyId);
  const latest = policy?.versions.at(-1);
  if (policy === undefined || latest === undefined) {
    return (
      <>
        <PageHeader title={type.name.default} description={appliesToLabel(type.appliesTo)} />
        <Alert
          tone="info"
          title={t('settings.leave-type.no_policy_to_edit', 'No policy to edit')}
          action={
            type.tracked && onStartPolicy !== undefined ? (
              <StartPolicy onStart={() => onStartPolicy(type.key)} />
            ) : undefined
          }
        >
          {type.tracked
            ? t(
                'settings.leave-type.has_no_policy_yet_so_nobody',
                '{{default}} has no policy yet, so nobody earns any.',
                { default: type.name.default },
              )
            : t(
                'settings.leave-type.draws_no_balance_so_there_is',
                '{{default}} draws no balance, so there is no allowance to set.',
                { default: type.name.default },
              )}
        </Alert>
      </>
    );
  }
  return (
    <Editor
      key={`${policy.id} ${String(latest.version)}`}
      data={data}
      policyId={policy.id}
      versions={policy.versions}
      latest={latest}
      {...{ onSaveDraft, onPublish, onPolicy, onPreviewAs, onShadow }}
    />
  );
}

function Editor({
  data,
  policyId,
  versions,
  latest,
  onSaveDraft,
  onPublish,
  onPolicy,
  onPreviewAs,
  onShadow,
}: {
  readonly [K in Exclude<keyof LeaveTypeProps, 'load' | 'onStartPolicy'>]:
    LeaveTypeProps[K] | undefined;
} & {
  readonly data: LeaveTypeData;
  readonly policyId: string;
  readonly versions: LeaveTypeData['policies'][number]['versions'];
  readonly latest: LeaveTypeData['policies'][number]['versions'][number];
}): JSX.Element {
  const type = data.leaveType.definition;
  const inEffect = versions.findLast((v) => v.status === 'published');
  const saved = latest.definition;
  const form = useSaved<PolicyDefinition>(saved);
  const draft = latest.status === 'draft' ? latest : null;
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<Outcome | null>(null);
  const preview = data.preview;
  const unit = type.unit === 'hour' ? 'hours' : 'days';

  const description = [
    inEffect === undefined
      ? t('settings.leave-type.never_published', 'Never published')
      : t(
          'settings.leave-type.version_in_effect_from',
          'Version {{version}} in effect from {{longDate}}',
          { version: String(inEffect.version), longDate: longDate(inEffect.effectiveFrom ?? '') },
        ),
    draft === null
      ? null
      : t('settings.leave-type.version_is_a_draft', 'version {{version}} is a draft', {
          version: String(draft.version),
        }),
  ]
    .filter(Boolean)
    .join(' · ');

  const publish =
    onPublish === undefined || draft === null || preview === null ? undefined : (
      <Button
        variant="primary"
        startIcon={<icons.confirm aria-hidden />}
        disabled={form.dirty}
        loading={publishing}
        loadingLabel={t('settings.leave-type.publishing', 'Publishing')}
        onClick={() => {
          setPublishing(true);
          setPublished(null);
          void onPublish(policyId, preview.effectiveFrom).then((outcome) => {
            setPublishing(false);
            setPublished(outcome);
          });
        }}
      >
        {t('settings.leave-type.publish_changes', 'Publish changes')}
      </Button>
    );

  return (
    <>
      <PageHeader
        title={t('settings.leave-type.text', '{{default}} · {{appliesToLabel}}', {
          default: type.name.default,
          appliesToLabel: appliesToLabel(saved.appliesTo),
        })}
        description={description}
        actions={publish}
      />
      {data.policies.length > 1 && onPolicy !== undefined ? (
        <Field className="max-w-sm">
          <FieldLabel>{t('settings.leave-type.policy', 'Policy')}</FieldLabel>
          <Select value={policyId} onValueChange={onPolicy}>
            <FieldControl>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
            </FieldControl>
            <SelectContent>
              {data.policies.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {appliesToLabel(p.versions.at(-1)?.definition.appliesTo ?? null)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}
      {published?.ok === false ? (
        <Alert tone="danger" title={t('settings.leave-type.not_published', 'Not published')}>
          {published.message}
        </Alert>
      ) : null}
      {form.refusal}
      <div className={columns}>
        <Rules value={form.draft} onChange={form.set} unit={unit} />
        <div className="flex min-w-0 flex-col gap-6">
          <ChangePreview
            preview={preview}
            dirty={form.dirty}
            hasDraft={draft !== null}
            unit={unit}
          />
          {preview === null || preview.members.length === 0 || form.dirty ? null : (
            <PreviewAs
              preview={preview}
              as={data.as}
              typeName={type.name.default}
              unit={unit}
              onPreviewAs={onPreviewAs}
            />
          )}
          {preview === null || draft === null || form.dirty ? null : (
            <ShadowRun
              shadow={preview.shadow}
              unit={unit}
              onShadow={onShadow === undefined ? undefined : (run) => onShadow(policyId, run)}
            />
          )}
          <AppliesTo
            value={form.draft.appliesTo}
            places={data.places}
            onChange={(appliesTo) => {
              form.set({ ...form.draft, appliesTo });
            }}
          />
        </div>
      </div>
      {onSaveDraft === undefined
        ? null
        : form.bar(
            (definition) => onSaveDraft(policyId, definition),
            t('settings.leave-type.save_draft', 'Save draft'),
          )}
    </>
  );
}

/* --------------------------------------------------------------- rules -- */

/** A decimal string for a typed number: "25.000". */
const asAmount = (n: number | null): string => (n ?? 0).toFixed(3);

function Rules({
  value,
  onChange,
  unit,
}: {
  readonly value: PolicyDefinition;
  readonly onChange: (next: PolicyDefinition) => void;
  readonly unit: string;
}): JSX.Element {
  const set = (patch: Partial<PolicyDefinition>): void => {
    onChange({ ...value, ...patch });
  };
  const bands = value.allowance;
  const first = bands[0]?.days ?? '0.000';
  // Display only: the credit Time Off posts is its own, rounded cumulatively.
  const monthly = (Math.round((Number(first) * 1000) / 12) / 1000).toFixed(2);
  const carry = value.carryOver;
  return (
    <FormSections>
      <FormSection
        title={t('settings.leave-type.allowance', 'Allowance')}
        description={t(
          'settings.leave-type.a_years_by_years_of_service',
          'A year’s {{unit}}, by years of service. Each band starts on the anniversary.',
          { unit },
        )}
      >
        <ul
          aria-label={t(
            'settings.leave-type.allowance_by_years_of_service',
            'Allowance by years of service',
          )}
          className="flex flex-col gap-3"
        >
          {bands.map((band, i) => (
            <li
              key={i}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-3"
            >
              <NumberField
                label={t('settings.leave-type.from_year', 'From year')}
                value={band.fromYears}
                min={i === 0 ? 0 : (bands[i - 1]?.fromYears ?? 0) + 1}
                step={1}
                readOnly={i === 0}
                onChange={(fromYears) => {
                  set({
                    allowance: bands.map((b, j) =>
                      j === i ? { ...b, fromYears: fromYears ?? 0 } : b,
                    ),
                  });
                }}
              />
              <NumberField
                label={t('settings.leave-type.a_year', '{{charAt}}{{slice}} a year', {
                  charAt: unit.charAt(0).toUpperCase(),
                  slice: unit.slice(1),
                })}
                value={Number(band.days)}
                min={0}
                step={0.5}
                precision={1}
                onChange={(days) => {
                  set({
                    allowance: bands.map((b, j) => (j === i ? { ...b, days: asAmount(days) } : b)),
                  });
                }}
              />
              <Button
                variant="ghost"
                aria-label={t(
                  'settings.leave-type.remove_the_band_from_year',
                  'Remove the band from year {{fromYears}}',
                  { fromYears: String(band.fromYears) },
                )}
                disabled={i === 0}
                startIcon={<icons.delete aria-hidden />}
                onClick={() => {
                  set({ allowance: bands.filter((_, j) => j !== i) });
                }}
              />
            </li>
          ))}
        </ul>
        <div>
          <Button
            size="sm"
            variant="ghost"
            startIcon={<icons.add aria-hidden />}
            onClick={() => {
              const last = bands.at(-1) ?? { fromYears: 0, days: first };
              set({ allowance: [...bands, { fromYears: last.fromYears + 1, days: last.days }] });
            }}
          >
            {t('settings.leave-type.add_a_band', 'Add a band')}
          </Button>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium" id="earned">
            {t('settings.leave-type.earned', 'Earned')}
          </span>
          <SegmentedControl
            aria-labelledby="earned"
            value={value.earning}
            onValueChange={(earning) => {
              if (earning === 'upfront' || earning === 'monthly') set({ earning });
            }}
          >
            <SegmentedControlItem value="upfront">
              {t('settings.leave-type.all_on_the_first_day', 'All on the first day')}
            </SegmentedControlItem>
            <SegmentedControlItem value="monthly">
              {t('settings.leave-type.monthly', 'Monthly')}
            </SegmentedControlItem>
          </SegmentedControl>
          <p className="text-sm text-fg-muted">
            {value.earning === 'monthly'
              ? t(
                  'settings.leave-type.on_the_1st_of_each_month',
                  '{{monthly}} {{unit}} on the 1st of each month, in the first band.',
                  { monthly, unit },
                )
              : t(
                  'settings.leave-type.the_years_on_the_first_day',
                  'The year’s {{unit}} on the first day of the leave year.',
                  { unit },
                )}
          </p>
        </div>
        <MonthDayField
          legend={t('settings.leave-type.the_leave_year_starts_on', 'The leave year starts on')}
          value={value.year}
          onChange={(year) => {
            set({ year });
          }}
        />
        <Toggle
          kind="checkbox"
          label={t(
            'settings.leave-type.pro_rata_for_joiners_and_leavers',
            'Pro-rata for joiners and leavers',
          )}
          description={t(
            'settings.leave-type.rounded_up_to_the_nearest_half',
            'Rounded up to the nearest half day',
          )}
          checked={value.proRata}
          onChange={(proRata) => {
            set({ proRata });
          }}
        />
        <Toggle
          kind="checkbox"
          label={t(
            'settings.leave-type.keep_earning_during_parental_leave',
            'Keep earning during parental leave',
          )}
          description={t('settings.leave-type.spanish_law_requires_it', 'Spanish law requires it')}
          checked={value.keepEarningOnParental}
          onChange={(keepEarningOnParental) => {
            set({ keepEarningOnParental });
          }}
        />
        <NumberField
          label={t('settings.leave-type.can_book_after_months', 'Can book after (months)')}
          hint={t(
            'settings.leave-type.counted_from_the_first_day_and',
            'Counted from the first day, and back-dated to it',
          )}
          value={value.probationMonths}
          min={0}
          max={24}
          step={1}
          onChange={(months) => {
            set({ probationMonths: months ?? 0 });
          }}
        />
      </FormSection>
      <FormSection
        title={t('settings.leave-type.carry_over', 'Carry-over')}
        description={t(
          'settings.leave-type.what_moves_into_next_year_and',
          'What moves into next year, and until when it can be used.',
        )}
      >
        <Toggle
          label={t('settings.leave-type.carry_days_into_next_year', 'Carry days into next year')}
          checked={carry !== null}
          onChange={(on) => {
            set({ carryOver: on ? { maxDays: '5.000', useBy: { month: 3, day: 31 } } : null });
          }}
        />
        {carry === null ? (
          <p className="text-sm text-fg-muted">
            {t(
              'settings.leave-type.anything_left_is_lost_at_the',
              'Anything left is lost at the end of the year.',
            )}
          </p>
        ) : (
          <>
            <NumberField
              label={t('settings.leave-type.up_to', 'Up to ({{unit}})', { unit })}
              value={Number(carry.maxDays)}
              min={0}
              step={0.5}
              precision={1}
              onChange={(n) => {
                set({ carryOver: { ...carry, maxDays: asAmount(n) } });
              }}
            />
            <MonthDayField
              legend={t('settings.leave-type.use_carried_days_by', 'Use carried days by')}
              value={carry.useBy}
              onChange={(useBy) => {
                set({ carryOver: { ...carry, useBy } });
              }}
            />
            <p className="text-sm text-fg-muted">
              {t(
                'settings.leave-type.anything_above_is_lost_at_the',
                'Anything above {{daysLabel}} is lost at the end of the year, and carried days still unused on {{monthDay}} are lost then.',
                { daysLabel: daysLabel(amount(carry.maxDays)), monthDay: monthDay(carry.useBy) },
              )}
            </p>
          </>
        )}
      </FormSection>
      <FormSection
        title={t('settings.leave-type.requests', 'Requests')}
        description={t(
          'settings.leave-type.what_people_can_ask_for_and',
          'What people can ask for, and what they see first.',
        )}
      >
        <Toggle
          label={t('settings.leave-type.half_days_allowed', 'Half days allowed')}
          checked={value.requests.halfDays}
          onChange={(halfDays) => {
            set({ requests: { ...value.requests, halfDays } });
          }}
        />
        <Toggle
          label={t(
            'settings.leave-type.show_who_else_is_off_before',
            'Show who else is off before sending',
          )}
          checked={value.requests.showWhoIsOff}
          onChange={(showWhoIsOff) => {
            set({ requests: { ...value.requests, showWhoIsOff } });
          }}
        />
        <Toggle
          label={t(
            'settings.leave-type.block_requests_below_the_team_minimum',
            'Block requests below the team minimum',
          )}
          description={t(
            'settings.leave-type.off_show_a_warning_and_let',
            'Off: show a warning and let the manager decide',
          )}
          checked={value.requests.blockBelowMinimum}
          onChange={(blockBelowMinimum) => {
            set({ requests: { ...value.requests, blockBelowMinimum } });
          }}
        />
      </FormSection>
    </FormSections>
  );
}

/* ------------------------------------------------------------- preview -- */

/** Thousandths, for comparing Time Off's decimal strings without a float's error. */
const milli = (s: string): number => Math.round(Number(s) * 1000);
const fromMilli = (n: number): string => amount((n / 1000).toFixed(3));

/** "1 more day", "1 to 3 more days": a whole phrase per direction and unit, so each language words it. */
function range(deltas: readonly number[], more: 'more' | 'fewer', unit: string): string {
  const low = Number(fromMilli(Math.min(...deltas)));
  const high = Number(fromMilli(Math.max(...deltas)));
  const hours = unit === 'hours';
  const vars = { count: high, low, high };
  if (low === high) {
    if (more === 'more')
      return hours
        ? t(
            'settings.leave-type.count_more_hours',
            { one: '{{count}} more hour', other: '{{count}} more hours' },
            vars,
          )
        : t(
            'settings.leave-type.count_more_days',
            { one: '{{count}} more day', other: '{{count}} more days' },
            vars,
          );
    return hours
      ? t(
          'settings.leave-type.count_fewer_hours',
          { one: '{{count}} fewer hour', other: '{{count}} fewer hours' },
          vars,
        )
      : t(
          'settings.leave-type.count_fewer_days',
          { one: '{{count}} fewer day', other: '{{count}} fewer days' },
          vars,
        );
  }
  if (more === 'more')
    return hours
      ? t(
          'settings.leave-type.range_more_hours',
          { one: '{{low}} to {{high}} more hour', other: '{{low}} to {{high}} more hours' },
          vars,
        )
      : t(
          'settings.leave-type.range_more_days',
          { one: '{{low}} to {{high}} more day', other: '{{low}} to {{high}} more days' },
          vars,
        );
  return hours
    ? t(
        'settings.leave-type.range_fewer_hours',
        { one: '{{low}} to {{high}} fewer hour', other: '{{low}} to {{high}} fewer hours' },
        vars,
      )
    : t(
        'settings.leave-type.range_fewer_days',
        { one: '{{low}} to {{high}} fewer day', other: '{{low}} to {{high}} fewer days' },
        vars,
      );
}

const people = (count: number): string =>
  t(
    'settings.leave-type.count_people',
    { one: '{{count}} person', other: '{{count}} people' },
    { count },
  );

/** Thousandths as "1 day", "2.5 days". */
const counted = (thousandths: number, unit: string): string => {
  const count = Number(fromMilli(thousandths));
  return unit === 'hours'
    ? t(
        'settings.leave-type.count_hours',
        { one: '{{count}} hour', other: '{{count}} hours' },
        { count },
      )
    : t(
        'settings.leave-type.count_days',
        { one: '{{count}} day', other: '{{count}} days' },
        { count },
      );
};

function ChangePreview({
  preview,
  dirty,
  hasDraft,
  unit,
}: {
  readonly preview: PolicyPreview | null;
  readonly dirty: boolean;
  readonly hasDraft: boolean;
  readonly unit: string;
}): JSX.Element {
  const body = ((): JSX.Element => {
    if (dirty)
      return (
        <p className="text-sm text-fg-muted">
          {t(
            'settings.leave-type.save_the_draft_to_see_who',
            'Save the draft to see who these changes would reach.',
          )}
        </p>
      );
    if (!hasDraft || preview === null)
      return (
        <p className="text-sm text-fg-muted">
          {t(
            'settings.leave-type.nothing_is_drafted_change_a_rule',
            'Nothing is drafted. Change a rule and save the draft to see who it would reach before anything is published.',
          )}
        </p>
      );
    const delta = (c: Change): number => milli(c.draft) - milli(c.current);
    const gain = preview.members.filter((m) => delta(m.allowance) > 0);
    const loss = preview.members.filter((m) => delta(m.allowance) < 0);
    const lose = preview.members.filter((m) => delta(m.lostAtYearEnd) > 0);
    if (gain.length + loss.length + lose.length === 0)
      return (
        <p className="text-sm text-fg-muted">
          {t('settings.leave-type.nobodys_balance_changes', 'Nobody’s balance changes.')}
        </p>
      );
    return (
      <IconList>
        {gain.length === 0 ? null : (
          <IconListItem
            icon={<icons.people aria-hidden />}
            tone="success"
            description={t(
              'settings.leave-type.from_for_this_leave_year',
              'From {{longDate}}, for this leave year.',
              { longDate: longDate(preview.effectiveFrom) },
            )}
          >
            {t(
              'settings.leave-type.text_4',
              { one: '{{people}} gets {{range}}', other: '{{people}} get {{range}}' },
              {
                count: gain.length,
                people: people(gain.length),
                range: range(
                  gain.map((m) => delta(m.allowance)),
                  'more',
                  unit,
                ),
              },
            )}
          </IconListItem>
        )}
        {loss.length === 0 ? null : (
          <IconListItem
            icon={<icons.people aria-hidden />}
            tone="danger"
            description={t(
              'settings.leave-type.from_for_this_leave_year',
              'From {{longDate}}, for this leave year.',
              { longDate: longDate(preview.effectiveFrom) },
            )}
          >
            {t(
              'settings.leave-type.text_4',
              { one: '{{people}} gets {{range}}', other: '{{people}} get {{range}}' },
              {
                count: loss.length,
                people: people(loss.length),
                range: range(
                  loss.map((m) => -delta(m.allowance)),
                  'fewer',
                  unit,
                ),
              },
            )}
          </IconListItem>
        )}
        {lose.length === 0 ? null : (
          <IconListItem
            icon={<icons.pending aria-hidden />}
            tone="warning"
            description={t(
              'settings.leave-type.above_the_carry_over_limit_if',
              'Above the carry-over limit, if they book nothing more: {{range}} each.',
              {
                range: range(
                  lose.map((m) => delta(m.lostAtYearEnd)),
                  'more',
                  unit,
                ),
              },
            )}
          >
            {t(
              'settings.leave-type.would_lose_on',
              '{{people}} would lose {{unit}} on {{longDate}}',
              { people: people(lose.length), unit, longDate: longDate(preview.yearEnd) },
            )}
          </IconListItem>
        )}
      </IconList>
    );
  })();
  return (
    <PageSection
      title={t('settings.leave-type.change_preview', 'Change preview')}
      description={
        preview !== null && hasDraft && !dirty
          ? t(
              'settings.leave-type.if_you_publish_version_worked_out',
              'If you publish version {{draftVersion}}, worked out on {{people}}’s balances.',
              {
                draftVersion: String(preview.draftVersion),
                people: people(preview.members.length),
              },
            )
          : undefined
      }
      surface
    >
      {body}
    </PageSection>
  );
}

function PreviewAs({
  preview,
  as,
  typeName,
  unit,
  onPreviewAs,
}: {
  readonly preview: PolicyPreview;
  readonly as: string | null;
  readonly typeName: string;
  readonly unit: string;
  readonly onPreviewAs: LeaveTypeProps['onPreviewAs'];
}): JSX.Element {
  // Whoever the draft changes comes first, so the first pick is worth looking at.
  const changed = (m: PolicyPreview['members'][number]): boolean =>
    m.allowance.current !== m.allowance.draft || m.lostAtYearEnd.current !== m.lostAtYearEnd.draft;
  const order = [...preview.members.filter(changed), ...preview.members.filter((m) => !changed(m))];
  const who = preview.members.find((m) => m.personId === as) ?? order[0];
  if (who === undefined) return <></>;
  const stat = (label: string, c: Change, description?: string): JSX.Element => (
    <Stat
      inset
      label={label}
      value={amount(c.draft)}
      unit={unit}
      {...(c.current === c.draft ? {} : { from: amount(c.current) })}
      {...(description === undefined ? {} : { description })}
    />
  );
  return (
    <PageSection
      title={t('settings.leave-type.what_would_see', 'What {{displayName}} would see', {
        displayName: who.displayName,
      })}
      actions={<Badge size="sm">{t('settings.leave-type.preview', 'Preview')}</Badge>}
      surface
    >
      <div className="flex flex-col gap-4">
        {onPreviewAs === undefined ? null : (
          <Field>
            <FieldLabel>{t('settings.leave-type.preview_as', 'Preview as')}</FieldLabel>
            <Select value={who.personId} onValueChange={onPreviewAs}>
              <FieldControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                {order.map((m) => (
                  <SelectItem key={m.personId} value={m.personId}>
                    {m.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-1 gap-3 @min-[30rem]/policy:grid-cols-2">
          {stat(
            t('settings.leave-type.this_year', '{{typeName}} this year', { typeName }),
            who.allowance,
          )}
          {stat(
            t('settings.leave-type.left_at_the_year_end', 'Left at the year end'),
            who.left,
            t('settings.leave-type.if_nothing_more_is_booked', 'If nothing more is booked'),
          )}
        </div>
        {milli(who.lostAtYearEnd.draft) > 0 ? (
          <p className="text-sm">
            {t(
              'settings.leave-type.of_them_would_be_lost_on',
              '{{draft}} of them would be lost on {{longDate}}, above what carries over.',
              { draft: amount(who.lostAtYearEnd.draft), longDate: longDate(preview.yearEnd) },
            )}
          </p>
        ) : null}
      </div>
    </PageSection>
  );
}

/* ---------------------------------------------------------- applies to -- */

type Place = 'country' | 'location';
const region = new Intl.DisplayNames('en', { type: 'region' });

/**
 * Who the policy reaches (§6.2, TOF-099a): the countries and work locations
 * members are in, ticked; none ticked is everyone. Saved with the draft, so
 * the preview says who it would reach before anything is published. A
 * clause on what Time Off does not hold (contract, legal entity) is kept as
 * it was.
 */
function AppliesTo({
  value,
  places,
  onChange,
}: {
  readonly value: Predicate | null;
  readonly places: LeaveTypeData['places'];
  readonly onChange: (next: Predicate | null) => void;
}): JSX.Element {
  const picked = (operand: Place): readonly string[] =>
    value?.clauses.find((c) => c.operand === operand)?.in ?? [];
  const toggle = (operand: Place, place: string, on: boolean): void => {
    const now = picked(operand);
    const next = on ? [...now, place] : now.filter((p) => p !== place);
    const others = (value?.clauses ?? []).filter((c) => c.operand !== operand);
    const clauses = next.length === 0 ? others : [...others, { operand, in: next }];
    onChange(clauses.length === 0 ? null : { combine: 'all', clauses });
  };
  const group = (operand: Place, legend: string, items: readonly string[]): JSX.Element | null =>
    items.length === 0 ? null : (
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{legend}</legend>
        {items.map((place) => (
          <Toggle
            key={place}
            kind="checkbox"
            label={operand === 'country' ? (region.of(place) ?? place) : placeName(place)}
            checked={picked(operand).includes(place)}
            onChange={(on) => {
              toggle(operand, place, on);
            }}
          />
        ))}
      </fieldset>
    );
  return (
    <PageSection
      title={t('settings.leave-type.applies_to', 'Applies to')}
      description={appliesToLabel(value)}
      surface
    >
      <div className="flex flex-col gap-4">
        {group('country', t('settings.leave-type.countries', 'Countries'), places?.countries ?? [])}
        {group(
          'location',
          t('settings.leave-type.work_locations', 'Work locations'),
          places?.locations ?? [],
        )}
        <p className="text-sm text-fg-muted">
          {t(
            'settings.leave-type.nothing_ticked_is_everyone_a_change',
            'Nothing ticked is everyone. A change is part of the draft until it is published.',
          )}
        </p>
      </div>
    </PageSection>
  );
}

/* ---------------------------------------------------------- shadow run -- */

/**
 * The draft beside the version in effect for a month (PRD §6.3): each
 * member's balance under both, folded by Time Off to the same day. HR's
 * alone; nobody's own balance ever shows it.
 */
function ShadowRun({
  shadow,
  unit,
  onShadow,
}: {
  readonly shadow: PolicyPreview['shadow'];
  readonly unit: string;
  readonly onShadow: ((run: boolean) => Promise<Outcome>) | undefined;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const press = (run: boolean): void => {
    if (onShadow === undefined) return;
    setBusy(true);
    setRefused(null);
    void onShadow(run).then((outcome) => {
      setBusy(false);
      if (!outcome.ok) setRefused(outcome.message);
    });
  };
  const delta = (c: Change): number => milli(c.draft) - milli(c.current);
  const differ = shadow?.members.filter((m) => delta(m.balance) !== 0) ?? [];
  const over = shadow !== null && shadow.asOf === shadow.to;
  return (
    <PageSection
      title={t('settings.leave-type.shadow_run', 'Shadow run')}
      description={
        shadow === null
          ? t(
              'settings.leave-type.run_the_draft_beside_the_policy',
              'Run the draft beside the policy in effect for a month, and compare balances before anyone sees them.',
            )
          : over
            ? t(
                'settings.leave-type.ran_balances_as_of_only_hr',
                'Ran {{longDate}} to {{longDate2}} · balances as of {{longDate3}}. Only HR sees this.',
                {
                  longDate: longDate(shadow.from),
                  longDate2: longDate(shadow.to),
                  longDate3: longDate(shadow.asOf),
                },
              )
            : t(
                'settings.leave-type.running_balances_as_of_only_hr',
                'Running {{longDate}} to {{longDate2}} · balances as of {{longDate3}}. Only HR sees this.',
                {
                  longDate: longDate(shadow.from),
                  longDate2: longDate(shadow.to),
                  longDate3: longDate(shadow.asOf),
                },
              )
      }
      actions={
        onShadow === undefined ? undefined : (
          <Button
            size="sm"
            variant="secondary"
            loading={busy}
            loadingLabel={
              shadow === null
                ? t('settings.leave-type.starting', 'Starting')
                : t('settings.leave-type.stopping', 'Stopping')
            }
            onClick={() => {
              press(shadow === null);
            }}
          >
            {shadow === null
              ? t('settings.leave-type.run_for_a_month', 'Run for a month')
              : t('settings.leave-type.stop', 'Stop')}
          </Button>
        )
      }
      surface
    >
      {refused === null ? null : (
        <Alert tone="danger" title={t('settings.leave-type.not_changed', 'Not changed')}>
          {refused}
        </Alert>
      )}
      {shadow === null ? null : differ.length === 0 ? (
        <p className="text-sm text-fg-muted">
          {t(
            'settings.leave-type.every_balance_is_the_same_under',
            'Every balance is the same under both, {{people}} compared.',
            { people: people(shadow.members.length) },
          )}
        </p>
      ) : (
        <List
          aria-label={t('settings.leave-type.balances_under_the_draft', 'Balances under the draft')}
        >
          {differ.map((m) => (
            <ListItem
              key={m.personId}
              leading={<Avatar name={m.displayName} size="sm" />}
              description={t(
                'settings.leave-type.now_under_the_draft',
                '{{current}} now, {{draft}} under the draft',
                { current: amount(m.balance.current), draft: amount(m.balance.draft) },
              )}
              trailing={
                <Badge size="sm" tone={delta(m.balance) > 0 ? 'success' : 'danger'}>
                  {`${delta(m.balance) > 0 ? '+' : '−'}${counted(Math.abs(delta(m.balance)), unit)}`}
                </Badge>
              }
            >
              {m.displayName}
            </ListItem>
          ))}
        </List>
      )}
      {shadow === null || differ.length === 0 ? null : (
        <p className="text-sm text-fg-muted">
          {t('settings.leave-type.the_same_under_both', '{{people}} the same under both.', {
            people: people(shadow.members.length - differ.length),
          })}
        </p>
      )}
    </PageSection>
  );
}

/* ------------------------------------------------------------ skeleton -- */

/** The editor while it loads: the header, the rules' sections and the preview beside them. */
export function LeaveTypeSkeleton(): JSX.Element {
  return (
    <SettingsSkeleton
      title={t('settings.leave-type.leave_type', 'Leave type')}
      description=" "
      container="@container/policy"
      columns={columns}
      main={['h-[38rem]', 'h-64', 'h-56']}
      side={['h-48', 'h-64', 'h-28']}
    />
  );
}
