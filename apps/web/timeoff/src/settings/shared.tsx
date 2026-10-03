import {
  Alert,
  Checkbox,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  FormSaveBar,
  NumberField,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
} from '@reach/ui';
import { useState, type JSX, type ReactNode } from 'react';

import type { Outcome } from '../load';

/**
 * What Time Off's settings pages share (TOF-078 to TOF-083): the shapes Time
 * Off sends, the words for its codes, the country pack notice, the save bar
 * and the loading state. Each page is HR's; anybody else gets Time Off's
 * refusal as the page's error.
 */

/* -------------------------------------------------------------- shapes -- */

export interface Predicate {
  readonly combine: 'all' | 'any';
  readonly clauses: readonly {
    readonly operand: 'country' | 'legalEntity' | 'employmentType' | 'location';
    readonly in: readonly string[];
  }[];
}

export interface LeaveTypeDefinition {
  readonly key: string;
  readonly name: { readonly default: string };
  readonly category: string;
  readonly colorToken: string;
  readonly icon: string;
  readonly unit: 'day' | 'hour';
  readonly tracked: boolean;
  readonly paid: 'paid' | 'unpaid' | 'statutory';
  readonly visibility: 'type' | 'off_only';
  readonly requiresNote: { readonly afterDays: number } | null;
  readonly appliesTo: Predicate | null;
  readonly statutory: boolean;
}

export interface LeaveTypeRow {
  readonly definition: LeaveTypeDefinition;
  readonly hidden: boolean;
  readonly deleted: boolean;
  readonly policyIds: readonly string[];
}

export interface Pack {
  readonly country: string;
  readonly version: number;
  readonly reviewed: boolean;
}

export type Approver = 'manager' | 'hr';

export interface ApprovalRule {
  readonly subject: 'request' | 'plan' | 'timesheet';
  readonly leaveTypes: readonly string[] | null;
  readonly when: 'always' | 'below_zero' | 'unpaid';
  readonly approvers: readonly Approver[];
}

/* --------------------------------------------------------------- words -- */

const region = new Intl.DisplayNames('en', { type: 'region' });
const country = (code: string): string => region.of(code) ?? code;
/** "madrid" as "Madrid": a location's key is all Time Off knows of its name. */
export const placeName = (key: string): string =>
  key
    .split(/[_-]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
const EMPLOYMENT: Record<string, string> = {
  permanent: 'permanent',
  fixed_term: 'fixed-term',
  temporary: 'temporary',
  contractor: 'contractors',
  intern: 'interns',
  part_time: 'part-time',
};

/** Who a leave type or policy reaches, as a phrase: "Everyone", "Spain", "Spain and permanent". */
export function appliesToLabel(predicate: Predicate | null): string {
  if (predicate === null) return 'Everyone';
  const parts = predicate.clauses.map((c) => {
    if (c.operand === 'country') return c.in.map(country).join(', ');
    if (c.operand === 'location') return c.in.map(placeName).join(', ');
    if (c.operand === 'employmentType')
      return c.in.map((e) => EMPLOYMENT[e] ?? e.replaceAll('_', ' ')).join(', ');
    return `${String(c.in.length)} legal ${c.in.length === 1 ? 'entity' : 'entities'}`;
  });
  return parts.join(predicate.combine === 'all' ? ' and ' : ' or ');
}

/** Each clause on its own, for chips: [operand's name, values]. */
export function appliesToParts(
  predicate: Predicate | null,
): readonly (readonly [string, string])[] {
  if (predicate === null) return [['Who', 'Everyone']];
  return predicate.clauses.map((c) => [
    { country: 'Country', location: 'Location', employmentType: 'Contract', legalEntity: 'Entity' }[
      c.operand
    ],
    appliesToLabel({ combine: 'all', clauses: [c] }),
  ]);
}

/** A chain of approvers as it reads: "Manager, then HR". */
export function approversLabel(approvers: readonly Approver[]): string {
  const names = approvers.map((a) => (a === 'hr' ? 'HR' : 'Manager'));
  return names.join(', then ');
}

/** The rule that decides a leave type's requests: its own first, then the one for every type. */
export function ruleFor(rules: readonly ApprovalRule[], key: string): ApprovalRule | undefined {
  const requests = rules.filter((r) => r.subject === 'request' && r.when === 'always');
  return (
    requests.find((r) => r.leaveTypes?.includes(key)) ?? requests.find((r) => r.leaveTypes === null)
  );
}

export const MONTHS = [
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
] as const;

/** A month and day with no year: "1 January". */
export const monthDay = (md: { readonly month: number; readonly day: number }): string =>
  `${String(md.day)} ${MONTHS[md.month - 1] ?? ''}`;

const asDate = (date: string): Date => new Date(`${date}T00:00:00Z`);
/** A calendar date as people read it: "Thu 1 Jan". Dates are dates: UTC, so no zone moves them. */
export const shortDate = (date: string): string =>
  new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(asDate(date));
/** "1 January 2026". */
export const longDate = (date: string): string =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(asDate(date));

/** "1 day", "2.5 days". */
export const daysLabel = (n: string): string => `${n} ${n === '1' ? 'day' : 'days'}`;

/* ----------------------------------------------------------- the pack -- */

/**
 * A country pack nobody who knows that country's law has signed off yet
 * (`reviewed: false`): said on every page whose rules came from it.
 */
export function PackNotice({ packs }: { readonly packs: readonly Pack[] }): JSX.Element | null {
  const unreviewed = packs.filter((p) => !p.reviewed);
  if (unreviewed.length === 0) return null;
  const names = unreviewed.map((p) => country(p.country)).join(' and ');
  return (
    <Alert tone="warning" title={`${names}’s rules are not reviewed yet`}>
      The statutory leave types and public holidays for {names} come from a country pack that an
      employment lawyer has not signed off. Check them against your own advice before you rely on
      them.
    </Alert>
  );
}

/* ------------------------------------------------------------- fields -- */

/** A switch or a checkbox whose row is its label, with a line on what "off" means. */
export function Toggle({
  label,
  description,
  checked,
  onChange,
  kind = 'switch',
  disabled = false,
}: {
  readonly label: string;
  readonly description?: string;
  readonly checked: boolean;
  readonly onChange: (next: boolean) => void;
  readonly kind?: 'switch' | 'checkbox';
  readonly disabled?: boolean;
}): JSX.Element {
  const control =
    kind === 'switch' ? (
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    ) : (
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(on) => {
          onChange(on === true);
        }}
      />
    );
  const text = (
    <div className="min-w-0 flex-1">
      <FieldLabel>{label}</FieldLabel>
      {description === undefined ? null : <FieldDescription>{description}</FieldDescription>}
    </div>
  );
  return (
    <Field orientation="horizontal" disabled={disabled}>
      {kind === 'switch' ? text : <FieldControl>{control}</FieldControl>}
      {kind === 'switch' ? <FieldControl>{control}</FieldControl> : text}
    </Field>
  );
}

/** A month and a day with no year, as two controls under one legend. */
export function MonthDayField({
  legend,
  value,
  onChange,
}: {
  readonly legend: string;
  readonly value: { readonly month: number; readonly day: number };
  readonly onChange: (next: { month: number; day: number }) => void;
}): JSX.Element {
  // A non-leap year's last day of the month: the contract refuses 29 February.
  const last = new Date(Date.UTC(2001, value.month, 0)).getUTCDate();
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">{legend}</legend>
      <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3">
        <NumberField
          label="Day"
          value={value.day}
          min={1}
          max={last}
          step={1}
          onChange={(day) => {
            onChange({ ...value, day: Math.min(day ?? 1, last) });
          }}
        />
        <Field>
          <FieldLabel>Month</FieldLabel>
          <Select
            value={String(value.month)}
            onValueChange={(m) => {
              const month = Number(m);
              const end = new Date(Date.UTC(2001, month, 0)).getUTCDate();
              onChange({ month, day: Math.min(value.day, end) });
            }}
          >
            <FieldControl>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
            </FieldControl>
            <SelectContent>
              {MONTHS.map((name, i) => (
                <SelectItem key={name} value={String(i + 1)}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
    </fieldset>
  );
}

/* ------------------------------------------------------------- saving -- */

/**
 * A form's edits, the save that sends them and what Time Off said: the save
 * bar rises with the first change and leaves with the save, and a refusal
 * stays on the page with Time Off's reason. A save that goes through comes
 * back as the page drawn again, with the saved values as the new start.
 */
export function useSaved<T>(saved: T): {
  readonly draft: T;
  readonly set: (next: T) => void;
  readonly dirty: boolean;
  readonly bar: (save: (draft: T) => Promise<Outcome>, label?: string) => ReactNode;
  readonly refusal: ReactNode;
} {
  const savedKey = JSON.stringify(saved);
  const [draft, setDraft] = useState(saved);
  const [base, setBase] = useState(savedKey);
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  // The page drawn again after a save: its values are the new start.
  if (savedKey !== base) {
    setBase(savedKey);
    setDraft(saved);
  }
  const dirty = JSON.stringify(draft) !== savedKey;
  return {
    draft,
    set: (next) => {
      setRefused(null);
      setDraft(next);
    },
    dirty,
    bar: (save, label) => (
      <FormSaveBar
        open={dirty}
        saving={saving}
        {...(label === undefined ? {} : { saveLabel: label })}
        onDiscard={() => {
          setRefused(null);
          setDraft(saved);
        }}
        onSave={() => {
          setSaving(true);
          void save(draft).then((outcome) => {
            setSaving(false);
            if (!outcome.ok) setRefused(outcome.message);
          });
        }}
      />
    ),
    refusal:
      refused === null ? null : (
        <Alert tone="danger" title="Not saved">
          {refused}
        </Alert>
      ),
  };
}

/* ------------------------------------------------------------ loading -- */

/** A settings page's header over its body's columns, each block the height of what it holds. */
export function SettingsSkeleton({
  title,
  description,
  container,
  columns,
  main,
  side,
}: {
  readonly title: string;
  readonly description: string;
  /** The page's container name, so the columns break where the page's do. */
  readonly container: string;
  /** The columns' classes, the page's own. */
  readonly columns: string;
  /** Heights of the main column's blocks, as classes. */
  readonly main: readonly string[];
  readonly side: readonly string[];
}): JSX.Element {
  return (
    <div className={`${container} flex flex-col gap-6`}>
      <PageHeader title={title} description={description} />
      <div role="status" className={columns}>
        <span className="sr-only">Loading {title.toLowerCase()}</span>
        {[main, side].map((blocks, i) => (
          <div key={i} className="flex min-w-0 flex-col gap-5">
            {blocks.map((h, j) => (
              <Skeleton key={j} className={`${h} rounded-lg`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
