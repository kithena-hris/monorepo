import {
  Badge,
  Button,
  Field,
  FieldControl,
  FieldLabel,
  List,
  ListItem,
  NumberField,
  PageHeader,
  PageSection,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  icons,
} from '@reach/ui';
import type { JSX } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';
import { chartTone, leaveIcon } from '../overview/overview';
import { AddLeaveType, type NewLeaveType } from './add-leave-type';
import {
  PackNotice,
  appliesToLabel,
  approversLabel,
  ruleFor,
  useSaved,
  type ApprovalRule,
  type LeaveTypeRow,
  type Pack,
} from './shared';

/**
 * Leave types (T29, TOF-078): every kind of time off people can ask for, one
 * row each saying how it is paid, who it reaches and who approves it, each
 * opening its policy. Statutory types came from a country pack; a pack nobody
 * has reviewed says so above the list.
 *
 * One list at every width: a row is a place to go, so it is the same row
 * under a finger, its second line wrapping where a desk has room for it.
 */

/** The company's own parental weeks (T8), booked as one leave type; 0 weeks for none. */
export interface ParentalCompany {
  readonly extraWeeks: number;
  readonly afterServiceYears: number;
  readonly leaveTypeKey: string;
}

export interface LeaveTypesData {
  readonly leaveTypes: readonly LeaveTypeRow[];
  readonly packs: readonly Pack[];
  /** The approval rules (§9.1), for who approves each type. */
  readonly rules: readonly ApprovalRule[];
  readonly parentalCompany?: ParentalCompany | null;
  /** The add dialog open (`?add=1`). */
  readonly adding?: boolean;
}

export interface LeaveTypesProps {
  readonly load: Loadable<LeaveTypesData>;
  /** Another state in the address: the add dialog open or closed. */
  readonly onAsk?: (patch: Readonly<Record<string, string | null>>) => void;
  readonly onAdd?: (
    definition: NewLeaveType,
  ) => Promise<
    { readonly ok: true; readonly key: string } | { readonly ok: false; readonly message: string }
  >;
  readonly onNavigate?: (href: string) => void;
  readonly onSaveParentalCompany?: (weeks: ParentalCompany) => Promise<Outcome>;
}

const TITLE = 'Leave types';
const DESCRIPTION =
  'The kinds of time off people can request, and how each one is paid and approved.';

export function LeaveTypes(props: LeaveTypesProps): JSX.Element {
  const { load, onAdd, onAsk, onNavigate } = props;
  if (load.status === 'loading') return <LeaveTypesSkeleton />;
  return (
    <div className="@container/types flex flex-col gap-6">
      <PageHeader
        title={TITLE}
        description={DESCRIPTION}
        actions={
          onAdd === undefined ? undefined : (
            <Button asChild variant="primary" startIcon={<icons.add aria-hidden />}>
              <a href="/settings/time-off/leave-types?add=1">Add leave type</a>
            </Button>
          )
        }
      />
      <Loaded load={load} what="the leave types">
        {(data) => (
          <>
            <Ready data={data} />
            <CompanyWeeks data={data} onSave={props.onSaveParentalCompany} />
            {data.adding === true && onAdd !== undefined ? (
              <AddLeaveType
                onClose={() => onAsk?.({ add: null })}
                onAdd={async (definition) => {
                  const added = await onAdd(definition);
                  if (added.ok) onNavigate?.(`/settings/time-off/leave-types/${added.key}`);
                  return added;
                }}
              />
            ) : null}
          </>
        )}
      </Loaded>
    </div>
  );
}

/**
 * The company's own parental weeks (T8: "Acme adds 2 paid weeks after a
 * year", TOF-099a): how many, after how many years of service, booked as
 * which leave type. A plan already answered keeps what it was answered with.
 */
function CompanyWeeks({
  data,
  onSave,
}: {
  readonly data: LeaveTypesData;
  readonly onSave: LeaveTypesProps['onSaveParentalCompany'];
}): JSX.Element {
  const types = data.leaveTypes.filter((t) => !t.deleted);
  const fallback = types.find((t) => t.definition.category === 'parental_leave') ?? types[0];
  const saved: ParentalCompany = data.parentalCompany ?? {
    extraWeeks: 0,
    afterServiceYears: 0,
    leaveTypeKey: fallback?.definition.key ?? '',
  };
  const form = useSaved(saved);
  const w = form.draft;
  return (
    <PageSection
      title="Your own parental weeks"
      description="Weeks the company adds to what the law gives, after some years of service."
      surface
    >
      <div className="flex flex-col gap-4">
        {form.refusal}
        <div className="grid grid-cols-1 gap-3 @min-[36rem]/types:grid-cols-2">
          <NumberField
            label="Extra weeks"
            hint="0 for none"
            value={w.extraWeeks}
            min={0}
            max={52}
            step={1}
            onChange={(n) => {
              form.set({ ...w, extraWeeks: n ?? 0 });
            }}
          />
          <NumberField
            label="After (years of service)"
            value={w.afterServiceYears}
            min={0}
            max={50}
            step={1}
            onChange={(n) => {
              form.set({ ...w, afterServiceYears: n ?? 0 });
            }}
          />
        </div>
        <Field>
          <FieldLabel>Booked as</FieldLabel>
          <Select
            value={w.leaveTypeKey}
            onValueChange={(leaveTypeKey) => {
              form.set({ ...w, leaveTypeKey });
            }}
          >
            <FieldControl>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
            </FieldControl>
            <SelectContent>
              {types.map((t) => (
                <SelectItem key={t.definition.key} value={t.definition.key}>
                  {t.definition.name.default}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      {onSave === undefined ? null : form.bar((next) => onSave(next))}
    </PageSection>
  );
}

const PAID: Record<LeaveTypeRow['definition']['paid'], string> = {
  paid: 'Paid',
  unpaid: 'Not paid',
  statutory: 'Paid by Social Security',
};

/** "Paid · tracked balance · note after 3 days". */
function terms(t: LeaveTypeRow['definition']): string {
  return [
    PAID[t.paid],
    t.tracked ? `tracked in ${t.unit === 'hour' ? 'hours' : 'days'}` : 'no balance',
    t.requiresNote === null ? null : `note after ${String(t.requiresNote.afterDays)} days`,
    t.visibility === 'off_only' ? 'teammates see “Off”' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function Ready({ data }: { readonly data: LeaveTypesData }): JSX.Element {
  return (
    <>
      <PackNotice packs={data.packs} />
      <List navigable aria-label="Leave types">
        {data.leaveTypes.map(({ definition: t, hidden }) => {
          const rule = ruleFor(data.rules, t.key);
          return (
            <ListItem
              key={t.key}
              asChild
              icon={leaveIcon(t.icon)}
              iconTone={chartTone(t.colorToken)}
              description={terms(t)}
              supporting={`${appliesToLabel(t.appliesTo)} · ${
                rule === undefined
                  ? 'No approval rule'
                  : `${approversLabel(rule.approvers)} approves`
              }`}
              trailing={
                hidden ? (
                  <Badge size="sm" variant="outline">
                    Hidden
                  </Badge>
                ) : t.statutory ? (
                  <Badge size="sm">Statutory</Badge>
                ) : undefined
              }
              chevron
            >
              <a href={`/settings/time-off/leave-types/${t.key}`}>{t.name.default}</a>
            </ListItem>
          );
        })}
      </List>
    </>
  );
}

/** The page while it loads: the header, then the list's rows at their height. */
export function LeaveTypesSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={TITLE} description={DESCRIPTION} />
      <div role="status" className="flex flex-col gap-px overflow-hidden rounded-[1.125rem]">
        <span className="sr-only">Loading the leave types</span>
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-[5.25rem] rounded-none" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-lg" />
    </div>
  );
}
