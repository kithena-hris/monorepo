import {
  Alert,
  AssistantComposer,
  AssistantLabel,
  Badge,
  Button,
  Chip,
  ChipRow,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldLabel,
  RadioCard,
  RadioGroup,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import type { Loadable } from '../load';
import { Overview, OverviewSkeleton, type OverviewData } from '../overview/overview';
import { amount, longSpan, monthName, shortDate, spanLabel } from '../words';
import { t as tr } from '../i18n';

/**
 * Describe it, get the best dates (T4, MT8, PRD §14.2): a sentence, what it
 * was understood as, and the dates Time Off found for it.
 *
 * Nothing here reads the sentence or picks a date. The host asks Time Off,
 * which reads the sentence into five choices (by TypeSafe when it has a key,
 * by its own rules otherwise), generates and ranks the dates, and writes a
 * line for each. The choices are chips the person can change, and every
 * change is the address (`onAsk`), so Time Off is asked again. Nothing is
 * sent: choosing dates opens the ordinary request panel with them.
 *
 * At a desk it is a dialog over the overview; under a finger, a sheet.
 */

export interface DateOption {
  readonly from: string;
  readonly to: string;
  readonly used: number;
  readonly away: { readonly from: string; readonly to: string; readonly days: number };
  readonly holidays: readonly { readonly date: string; readonly name: string }[];
  readonly short: readonly {
    readonly date: string;
    readonly in: number;
    readonly of: number;
    readonly required: number;
  }[];
  readonly fewest: { readonly in: number; readonly of: number } | null;
  readonly fits: boolean;
  /** What the balance would be after it, as Time Off counts it. */
  readonly leftAfter: string | null;
  /** `ai` when a model wrote it. */
  readonly line: { readonly text: string; readonly ai: boolean };
}

export interface DescribeData {
  /** The page behind the dialog at a desk; null when Time Off did not send it. */
  readonly overview: OverviewData | null;
  readonly sentence: string | null;
  readonly understood: {
    readonly leaveTypeKey: string | null;
    readonly leaveTypeName: string | null;
    readonly days: number;
    /** `2026-10`, or null for the next three months. */
    readonly month: string | null;
    readonly nextToHoliday: boolean;
    readonly avoidShort: boolean;
    /** A model read the sentence. */
    readonly ai: boolean;
  };
  readonly leaveTypes: readonly { readonly key: string; readonly name: string }[];
  readonly left: string | null;
  readonly options: readonly DateOption[];
  readonly today: string;
}

/** What may change in the address: a value, or null to drop it. */
export type DescribeAsk = Partial<
  Record<'q' | 'type' | 'days' | 'month' | 'holiday' | 'team', string | null>
>;

export interface DescribeProps {
  readonly load: Loadable<DescribeData>;
  readonly onAsk?: ((patch: DescribeAsk, mode: 'push' | 'replace') => void) | undefined;
  readonly onNavigate?: ((href: string) => void) | undefined;
}

const CLOSE = '/time-off/overview';
const LENGTHS = [1, 2, 3, 4, 5, 10, 15];

export function DescribeRequest({ load, onAsk, onNavigate }: DescribeProps): JSX.Element {
  const behind =
    load.status === 'ready' && load.data.overview !== null ? (
      <Overview load={{ status: 'ready', data: load.data.overview }} />
    ) : (
      <OverviewSkeleton />
    );
  return (
    <>
      {behind}
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onNavigate?.(CLOSE);
        }}
      >
        <DialogContent sheetOnTouch className="max-w-190">
          <DialogHeader className="flex flex-row flex-wrap items-center gap-3">
            <DialogTitle className="flex-1">
              {tr('request.describe.request_time_off', 'Request time off')}
            </DialogTitle>
            <SegmentedControl
              size="sm"
              aria-label={tr('request.describe.how_to_ask', 'How to ask')}
              value="describe"
              onValueChange={(value) => {
                if (value === 'pick') onNavigate?.('/time-off/request');
              }}
            >
              <SegmentedControlItem value="describe">
                {tr('request.describe.describe_it', 'Describe it')}
              </SegmentedControlItem>
              <SegmentedControlItem value="pick">
                {tr('request.describe.pick_dates', 'Pick dates')}
              </SegmentedControlItem>
            </SegmentedControl>
          </DialogHeader>
          {load.status === 'ready' ? (
            <Described data={load.data} onAsk={onAsk} />
          ) : load.status === 'error' ? (
            <DialogBody>
              <Alert
                tone="danger"
                title={tr('request.describe.could_not_find_dates', 'Could not find dates')}
                action={
                  load.retry === undefined ? undefined : (
                    <Button size="sm" onClick={load.retry}>
                      {tr('request.describe.try_again', 'Try again')}
                    </Button>
                  )
                }
              >
                {load.message}
              </Alert>
            </DialogBody>
          ) : (
            <DialogBody className="flex flex-col gap-3" role="status">
              <span className="sr-only">
                {tr('request.describe.finding_dates', 'Finding dates')}
              </span>
              <Skeleton className="h-20 rounded-lg" />
              <Skeleton className="h-8 rounded-full" />
              {[0, 1, 2].map((n) => (
                <Skeleton key={n} className="h-24 rounded-lg" />
              ))}
            </DialogBody>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Described({
  data,
  onAsk,
}: {
  readonly data: DescribeData;
  readonly onAsk: DescribeProps['onAsk'];
}): JSX.Element {
  const [text, setText] = useState(data.sentence ?? '');
  const [adjusting, setAdjusting] = useState(false);
  const [choice, setChoice] = useState('0');
  const u = data.understood;
  const ask = (patch: DescribeAsk): void => {
    setChoice('0');
    onAsk?.(patch, 'replace');
  };
  const picked = data.options[Number(choice)];
  const months = Array.from({ length: 12 }, (_, i) => monthAfter(data.today, i));
  return (
    <>
      <DialogBody className="@container/describe flex flex-col gap-4">
        <AssistantComposer
          value={text}
          onValueChange={setText}
          onSubmit={(value) => {
            setChoice('0');
            onAsk?.(
              { q: value.trim(), type: null, days: null, month: null, holiday: null, team: null },
              'push',
            );
          }}
          placeholder={tr(
            'request.describe.describe_the_time_off_you_want',
            'Describe the time off you want',
          )}
          disclaimer="Nothing is sent until you pick dates and send them."
          className="px-0 pt-0 pb-0"
        />
        {data.sentence === null ? null : (
          <ChipRow
            label={
              <AssistantLabel>
                {tr('request.describe.understood_as', 'Understood as')}
              </AssistantLabel>
            }
            action={
              <Button
                variant="ghost"
                size="xs"
                aria-expanded={adjusting}
                onClick={() => {
                  setAdjusting((was) => !was);
                }}
              >
                {adjusting
                  ? tr('request.describe.done', 'Done')
                  : tr('request.describe.change', 'Change')}
              </Button>
            }
          >
            <Chip field="Type">
              {u.leaveTypeName ?? tr('request.describe.time_off', 'Time off')}
            </Chip>
            <Chip field="Length">
              {tr(
                'request.describe.about',
                { one: 'About {{count}} day', other: 'About {{count}} days' },
                { count: u.days },
              )}
            </Chip>
            {u.month === null ? null : (
              <Chip
                field="When"
                onRemove={() => {
                  ask({ month: 'none' });
                }}
              >
                {monthName(`${u.month}-01`)}
              </Chip>
            )}
            {u.nextToHoliday ? (
              <Chip
                field="Prefer"
                onRemove={() => {
                  ask({ holiday: '0' });
                }}
              >
                {tr('request.describe.next_to_a_holiday', 'Next to a holiday')}
              </Chip>
            ) : null}
            {u.avoidShort ? (
              <Chip
                field="Avoid"
                onRemove={() => {
                  ask({ team: '0' });
                }}
              >
                {tr('request.describe.below_team_minimum', 'Below team minimum')}
              </Chip>
            ) : null}
            {u.ai ? (
              <Badge tone="assistant" size="sm">
                {tr('request.describe.ai', 'AI')}
              </Badge>
            ) : null}
          </ChipRow>
        )}
        {data.sentence === null || !adjusting ? null : (
          <div className="grid gap-3 @lg/describe:grid-cols-3">
            <Field>
              <FieldLabel>{tr('request.describe.type', 'Type')}</FieldLabel>
              <Select
                value={u.leaveTypeKey ?? ''}
                onValueChange={(type) => {
                  ask({ type });
                }}
              >
                <FieldControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent>
                  {data.leaveTypes.map((t) => (
                    <SelectItem key={t.key} value={t.key}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>{tr('request.describe.length', 'Length')}</FieldLabel>
              <Select
                value={String(u.days)}
                onValueChange={(days) => {
                  ask({ days });
                }}
              >
                <FieldControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent>
                  {[...new Set([...LENGTHS, u.days])]
                    .toSorted((a, b) => a - b)
                    .map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {tr(
                          'request.describe.about_2',
                          { one: 'About {{count}} day', other: 'About {{count}} days' },
                          { count: n },
                        )}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>{tr('request.describe.when', 'When')}</FieldLabel>
              <Select
                value={u.month ?? 'none'}
                onValueChange={(month) => {
                  ask({ month });
                }}
              >
                <FieldControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent>
                  <SelectItem value="none">
                    {tr('request.describe.the_next_three_months', 'The next three months')}
                  </SelectItem>
                  {months.map((m) => (
                    <SelectItem key={m} value={m}>
                      {tr('request.describe.text', '{{monthName}} {{slice}}', {
                        monthName: monthName(`${m}-01`),
                        slice: m.slice(0, 4),
                      })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field orientation="horizontal">
              <FieldLabel className="flex-1">
                {tr('request.describe.next_to_a_holiday', 'Next to a holiday')}
              </FieldLabel>
              <FieldControl>
                <Switch
                  checked={u.nextToHoliday}
                  onCheckedChange={(on) => {
                    ask({ holiday: on ? '1' : '0' });
                  }}
                />
              </FieldControl>
            </Field>
            <Field orientation="horizontal">
              <FieldLabel className="flex-1">
                {tr('request.describe.not_when_the_team_is_short', 'Not when the team is short')}
              </FieldLabel>
              <FieldControl>
                <Switch
                  checked={u.avoidShort}
                  onCheckedChange={(on) => {
                    ask({ team: on ? '1' : '0' });
                  }}
                />
              </FieldControl>
            </Field>
          </div>
        )}
        {data.options.length === 0 ? (
          <p className="text-sm text-fg-muted">
            {tr(
              'request.describe.no_dates_fit_that_try_another',
              'No dates fit that. Try another month or a different length.',
            )}
          </p>
        ) : (
          <RadioGroup
            aria-label={tr('request.describe.dates_to_ask_for', 'Dates to ask for')}
            value={choice}
            onValueChange={setChoice}
            className="flex flex-col gap-2"
          >
            {data.options.map((o, index) => (
              <RadioCard
                key={`${o.from}:${o.to}`}
                value={String(index)}
                description={o.line.text}
                impact={impact(o)}
                badge={
                  <span className="inline-flex gap-1.5">
                    {index === 0 ? (
                      <Badge tone="accent" size="sm">
                        {tr('request.describe.best_value', 'Best value')}
                      </Badge>
                    ) : null}
                    {o.line.ai ? (
                      <Badge tone="assistant" size="sm">
                        {tr('request.describe.ai', 'AI')}
                      </Badge>
                    ) : null}
                  </span>
                }
              >
                {longSpan(o.from, o.to)}
              </RadioCard>
            ))}
          </RadioGroup>
        )}
        {picked?.leftAfter == null ? null : (
          <p className="text-sm text-fg-muted">
            {picked.fits
              ? tr(
                  'request.describe.after_days',
                  {
                    one: '{{value}} after {{spanLabel}}: {{count}} day',
                    other: '{{value}} after {{spanLabel}}: {{count}} days',
                  },
                  {
                    value: u.leaveTypeName ?? tr('request.describe.balance', 'Balance'),
                    spanLabel: spanLabel(picked.from, picked.to),
                    count: Number(amount(picked.leftAfter)),
                  },
                )
              : tr(
                  'request.describe.after_days_below_zero',
                  {
                    one: '{{value}} after {{spanLabel}}: {{count}} day, below zero',
                    other: '{{value}} after {{spanLabel}}: {{count}} days, below zero',
                  },
                  {
                    value: u.leaveTypeName ?? tr('request.describe.balance', 'Balance'),
                    spanLabel: spanLabel(picked.from, picked.to),
                    count: Number(amount(picked.leftAfter)),
                  },
                )}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        {picked === undefined || u.leaveTypeKey === null ? null : (
          <Button variant="primary" startIcon={<icons.send aria-hidden />} asChild>
            <a
              href={`/time-off/request?type=${u.leaveTypeKey}&from=${picked.from}&to=${picked.to}`}
            >
              {tr('request.describe.request', 'Request {{spanLabel}}', {
                spanLabel: spanLabel(picked.from, picked.to),
              })}
            </a>
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

/** "Uses 4 · away 9 · 5 of 7 in every day", or the day the team falls short. */
function impact(o: DateOption): string {
  const cost = tr('request.describe.uses_away', 'Uses {{used}} · away {{days}}', {
    used: String(o.used),
    days: String(o.away.days),
  });
  const first = o.short[0];
  if (first !== undefined) {
    return tr(
      'request.describe.of_in_below_minimum',
      '{{cost}} · {{date}}: {{in}} of {{of}} in, below minimum',
      { cost, date: shortDate(first.date), in: String(first.in), of: String(first.of) },
    );
  }
  return o.fewest === null
    ? cost
    : tr('request.describe.of_in_every_day', '{{cost}} · {{in}} of {{of}} in every day', {
        cost,
        in: String(o.fewest.in),
        of: String(o.fewest.of),
      });
}

/** `2026-10` and the months after it. */
function monthAfter(today: string, n: number): string {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1 + n;
  return `${String(year + Math.floor(month / 12))}-${String((month % 12) + 1).padStart(2, '0')}`;
}
