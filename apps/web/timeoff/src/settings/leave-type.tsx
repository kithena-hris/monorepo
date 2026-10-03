import {
  Alert,
  Badge,
  Button,
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
  appliesToParts,
  daysLabel,
  longDate,
  monthDay,
  useSaved,
  type LeaveTypeRow,
  type Predicate,
} from './shared';

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
}

export interface LeaveTypeProps {
  readonly load: Loadable<LeaveTypeData>;
  readonly onSaveDraft?: (policyId: string, definition: PolicyDefinition) => Promise<Outcome>;
  readonly onPublish?: (policyId: string, effectiveFrom: string) => Promise<Outcome>;
  /** Another of the type's policies. */
  readonly onPolicy?: (policyId: string) => void;
  /** Show the draft as this member sees it. */
  readonly onPreviewAs?: (personId: string) => void;
}

const page = '@container/policy flex flex-col gap-6';
const columns =
  'flex flex-col gap-6 @min-[64rem]/policy:grid @min-[64rem]/policy:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] @min-[64rem]/policy:items-start';

export function LeaveType(props: LeaveTypeProps): JSX.Element {
  const { load } = props;
  if (load.status === 'loading') return <LeaveTypeSkeleton />;
  return (
    <div className={page}>
      {load.status === 'error' ? <PageHeader title="Leave type" /> : null}
      <Loaded load={load} what="the leave type">
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
}: LeaveTypeProps & { readonly data: LeaveTypeData }): JSX.Element {
  const type = data.leaveType.definition;
  const policy = data.policies.find((p) => p.id === data.policyId);
  const latest = policy?.versions.at(-1);
  if (policy === undefined || latest === undefined) {
    return (
      <>
        <PageHeader title={type.name.default} description={appliesToLabel(type.appliesTo)} />
        <Alert tone="info" title="No policy to edit">
          {type.tracked
            ? `${type.name.default} has no policy yet, so nobody earns any.`
            : `${type.name.default} draws no balance, so there is no allowance to set.`}
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
      {...{ onSaveDraft, onPublish, onPolicy, onPreviewAs }}
    />
  );
}

function Editor({
  data,
  policyId,
  versions,
  onSaveDraft,
  onPublish,
  onPolicy,
  onPreviewAs,
}: {
  readonly [K in Exclude<keyof LeaveTypeProps, 'load'>]: LeaveTypeProps[K] | undefined;
} & {
  readonly data: LeaveTypeData;
  readonly policyId: string;
  readonly versions: LeaveTypeData['policies'][number]['versions'];
}): JSX.Element {
  const type = data.leaveType.definition;
  const latest = versions.at(-1);
  const inEffect = versions.findLast((v) => v.status === 'published');
  const saved = latest?.definition ?? (inEffect?.definition as PolicyDefinition);
  const form = useSaved<PolicyDefinition>(saved);
  const draft = latest?.status === 'draft' ? latest : null;
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<Outcome | null>(null);
  const preview = data.preview;
  const unit = type.unit === 'hour' ? 'hours' : 'days';

  const description = [
    inEffect === undefined
      ? 'Never published'
      : `Version ${String(inEffect.version)} in effect from ${longDate(inEffect.effectiveFrom ?? '')}`,
    draft === null ? null : `version ${String(draft.version)} is a draft`,
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
        loadingLabel="Publishing"
        onClick={() => {
          setPublishing(true);
          setPublished(null);
          void onPublish(policyId, preview.effectiveFrom).then((outcome) => {
            setPublishing(false);
            setPublished(outcome);
          });
        }}
      >
        Publish changes
      </Button>
    );

  return (
    <>
      <PageHeader
        title={`${type.name.default} · ${appliesToLabel(saved.appliesTo)}`}
        description={description}
        actions={publish}
      />
      {data.policies.length > 1 && onPolicy !== undefined ? (
        <Field className="max-w-sm">
          <FieldLabel>Policy</FieldLabel>
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
        <Alert tone="danger" title="Not published">
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
          <PageSection title="Applies to" surface>
            <div className="flex flex-wrap gap-2">
              {appliesToParts(saved.appliesTo).map(([what, value]) => (
                <Badge key={`${what} ${value}`} variant="outline">
                  {`${what}: ${value}`}
                </Badge>
              ))}
            </div>
          </PageSection>
        </div>
      </div>
      {onSaveDraft === undefined
        ? null
        : form.bar((definition) => onSaveDraft(policyId, definition), 'Save draft')}
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
        title="Allowance"
        description={`A year’s ${unit}, by years of service. Each band starts on the anniversary.`}
      >
        <ul aria-label="Allowance by years of service" className="flex flex-col gap-3">
          {bands.map((band, i) => (
            <li
              key={i}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-3"
            >
              <NumberField
                label="From year"
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
                label={`${unit.charAt(0).toUpperCase()}${unit.slice(1)} a year`}
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
                aria-label={`Remove the band from year ${String(band.fromYears)}`}
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
            Add a band
          </Button>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium" id="earned">
            Earned
          </span>
          <SegmentedControl
            aria-labelledby="earned"
            value={value.earning}
            onValueChange={(earning) => {
              if (earning === 'upfront' || earning === 'monthly') set({ earning });
            }}
          >
            <SegmentedControlItem value="upfront">All on the first day</SegmentedControlItem>
            <SegmentedControlItem value="monthly">Monthly</SegmentedControlItem>
          </SegmentedControl>
          <p className="text-sm text-fg-muted">
            {value.earning === 'monthly'
              ? `${monthly} ${unit} on the 1st of each month, in the first band.`
              : `The year’s ${unit} on the first day of the leave year.`}
          </p>
        </div>
        <MonthDayField
          legend="The leave year starts on"
          value={value.year}
          onChange={(year) => {
            set({ year });
          }}
        />
        <Toggle
          kind="checkbox"
          label="Pro-rata for joiners and leavers"
          description="Rounded up to the nearest half day"
          checked={value.proRata}
          onChange={(proRata) => {
            set({ proRata });
          }}
        />
        <Toggle
          kind="checkbox"
          label="Keep earning during parental leave"
          description="Spanish law requires it"
          checked={value.keepEarningOnParental}
          onChange={(keepEarningOnParental) => {
            set({ keepEarningOnParental });
          }}
        />
        <NumberField
          label="Can book after (months)"
          hint="Counted from the first day, and back-dated to it"
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
        title="Carry-over"
        description="What moves into next year, and until when it can be used."
      >
        <Toggle
          label="Carry days into next year"
          checked={carry !== null}
          onChange={(on) => {
            set({ carryOver: on ? { maxDays: '5.000', useBy: { month: 3, day: 31 } } : null });
          }}
        />
        {carry === null ? (
          <p className="text-sm text-fg-muted">Anything left is lost at the end of the year.</p>
        ) : (
          <>
            <NumberField
              label={`Up to (${unit})`}
              value={Number(carry.maxDays)}
              min={0}
              step={0.5}
              precision={1}
              onChange={(n) => {
                set({ carryOver: { ...carry, maxDays: asAmount(n) } });
              }}
            />
            <MonthDayField
              legend="Use carried days by"
              value={carry.useBy}
              onChange={(useBy) => {
                set({ carryOver: { ...carry, useBy } });
              }}
            />
            <p className="text-sm text-fg-muted">
              {`Anything above ${daysLabel(amount(carry.maxDays))} is lost at the end of the year, and carried days still unused on ${monthDay(carry.useBy)} are lost then.`}
            </p>
          </>
        )}
      </FormSection>
      <FormSection title="Requests" description="What people can ask for, and what they see first.">
        <Toggle
          label="Half days allowed"
          checked={value.requests.halfDays}
          onChange={(halfDays) => {
            set({ requests: { ...value.requests, halfDays } });
          }}
        />
        <Toggle
          label="Show who else is off before sending"
          checked={value.requests.showWhoIsOff}
          onChange={(showWhoIsOff) => {
            set({ requests: { ...value.requests, showWhoIsOff } });
          }}
        />
        <Toggle
          label="Block requests below the team minimum"
          description="Off: show a warning and let the manager decide"
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

/** "1 more day", "1 to 3 more days". */
function range(deltas: readonly number[], more: string, unit: string): string {
  const low = fromMilli(Math.min(...deltas));
  const high = fromMilli(Math.max(...deltas));
  const n = low === high ? low : `${low} to ${high}`;
  return `${n} ${more} ${high === '1' ? unit.replace(/s$/, '') : unit}`;
}

const people = (n: number): string => (n === 1 ? '1 person' : `${String(n)} people`);

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
          Save the draft to see who these changes would reach.
        </p>
      );
    if (!hasDraft || preview === null)
      return (
        <p className="text-sm text-fg-muted">
          Nothing is drafted. Change a rule and save the draft to see who it would reach before
          anything is published.
        </p>
      );
    const delta = (c: Change): number => milli(c.draft) - milli(c.current);
    const gain = preview.members.filter((m) => delta(m.allowance) > 0);
    const loss = preview.members.filter((m) => delta(m.allowance) < 0);
    const lose = preview.members.filter((m) => delta(m.lostAtYearEnd) > 0);
    if (gain.length + loss.length + lose.length === 0)
      return <p className="text-sm text-fg-muted">Nobody’s balance changes.</p>;
    return (
      <IconList>
        {gain.length === 0 ? null : (
          <IconListItem
            icon={<icons.people aria-hidden />}
            tone="success"
            description={`From ${longDate(preview.effectiveFrom)}, for this leave year.`}
          >
            {`${people(gain.length)} ${gain.length === 1 ? 'gets' : 'get'} ${range(
              gain.map((m) => delta(m.allowance)),
              'more',
              unit,
            )}`}
          </IconListItem>
        )}
        {loss.length === 0 ? null : (
          <IconListItem
            icon={<icons.people aria-hidden />}
            tone="danger"
            description={`From ${longDate(preview.effectiveFrom)}, for this leave year.`}
          >
            {`${people(loss.length)} ${loss.length === 1 ? 'gets' : 'get'} ${range(
              loss.map((m) => -delta(m.allowance)),
              'fewer',
              unit,
            )}`}
          </IconListItem>
        )}
        {lose.length === 0 ? null : (
          <IconListItem
            icon={<icons.pending aria-hidden />}
            tone="warning"
            description={`Above the carry-over limit, if they book nothing more: ${range(
              lose.map((m) => delta(m.lostAtYearEnd)),
              'more',
              unit,
            )} each.`}
          >
            {`${people(lose.length)} would lose ${unit} on ${longDate(preview.yearEnd)}`}
          </IconListItem>
        )}
      </IconList>
    );
  })();
  return (
    <PageSection
      title="Change preview"
      description={
        preview !== null && hasDraft && !dirty
          ? `If you publish version ${String(preview.draftVersion)}, worked out on ${people(preview.members.length)}’s balances.`
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
      title={`What ${who.displayName} would see`}
      actions={<Badge size="sm">Preview</Badge>}
      surface
    >
      <div className="flex flex-col gap-4">
        {onPreviewAs === undefined ? null : (
          <Field>
            <FieldLabel>Preview as</FieldLabel>
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
          {stat(`${typeName} this year`, who.allowance)}
          {stat('Left at the year end', who.left, 'If nothing more is booked')}
        </div>
        {milli(who.lostAtYearEnd.draft) > 0 ? (
          <p className="text-sm">
            {`${amount(who.lostAtYearEnd.draft)} of them would be lost on ${longDate(preview.yearEnd)}, above what carries over.`}
          </p>
        ) : null}
      </div>
    </PageSection>
  );
}

/* ------------------------------------------------------------ skeleton -- */

/** The editor while it loads: the header, the rules' sections and the preview beside them. */
export function LeaveTypeSkeleton(): JSX.Element {
  return (
    <SettingsSkeleton
      title="Leave type"
      description=" "
      container="@container/policy"
      columns={columns}
      main={['h-[38rem]', 'h-64', 'h-56']}
      side={['h-48', 'h-64', 'h-28']}
    />
  );
}
