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
            <DialogTitle className="flex-1">Request time off</DialogTitle>
            <SegmentedControl
              size="sm"
              aria-label="How to ask"
              value="describe"
              onValueChange={(value) => {
                if (value === 'pick') onNavigate?.('/time-off/request');
              }}
            >
              <SegmentedControlItem value="describe">Describe it</SegmentedControlItem>
              <SegmentedControlItem value="pick">Pick dates</SegmentedControlItem>
            </SegmentedControl>
          </DialogHeader>
          {load.status === 'ready' ? (
            <Described data={load.data} onAsk={onAsk} />
          ) : load.status === 'error' ? (
            <DialogBody>
              <Alert
                tone="danger"
                title="Could not find dates"
                action={
                  load.retry === undefined ? undefined : (
                    <Button size="sm" onClick={load.retry}>
                      Try again
                    </Button>
                  )
                }
              >
                {load.message}
              </Alert>
            </DialogBody>
          ) : (
            <DialogBody className="flex flex-col gap-3" role="status">
              <span className="sr-only">Finding dates</span>
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
          placeholder="Describe the time off you want"
          disclaimer="Nothing is sent until you pick dates and send them."
          className="px-0 pt-0 pb-0"
        />
        {data.sentence === null ? null : (
          <ChipRow
            label={<AssistantLabel>Understood as</AssistantLabel>}
            action={
              <Button
                variant="ghost"
                size="xs"
                aria-expanded={adjusting}
                onClick={() => {
                  setAdjusting((was) => !was);
                }}
              >
                {adjusting ? 'Done' : 'Change'}
              </Button>
            }
          >
            <Chip field="Type">{u.leaveTypeName ?? 'Time off'}</Chip>
            <Chip field="Length">{`About ${String(u.days)} ${u.days === 1 ? 'day' : 'days'}`}</Chip>
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
                Next to a holiday
              </Chip>
            ) : null}
            {u.avoidShort ? (
              <Chip
                field="Avoid"
                onRemove={() => {
                  ask({ team: '0' });
                }}
              >
                Below team minimum
              </Chip>
            ) : null}
            {u.ai ? (
              <Badge tone="assistant" size="sm">
                AI
              </Badge>
            ) : null}
          </ChipRow>
        )}
        {data.sentence === null || !adjusting ? null : (
          <div className="grid gap-3 @lg/describe:grid-cols-3">
            <Field>
              <FieldLabel>Type</FieldLabel>
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
              <FieldLabel>Length</FieldLabel>
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
                        {`About ${String(n)} ${n === 1 ? 'day' : 'days'}`}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>When</FieldLabel>
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
                  <SelectItem value="none">The next three months</SelectItem>
                  {months.map((m) => (
                    <SelectItem key={m} value={m}>
                      {`${monthName(`${m}-01`)} ${m.slice(0, 4)}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field orientation="horizontal">
              <FieldLabel className="flex-1">Next to a holiday</FieldLabel>
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
              <FieldLabel className="flex-1">Not when the team is short</FieldLabel>
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
            No dates fit that. Try another month or a different length.
          </p>
        ) : (
          <RadioGroup
            aria-label="Dates to ask for"
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
                        Best value
                      </Badge>
                    ) : null}
                    {o.line.ai ? (
                      <Badge tone="assistant" size="sm">
                        AI
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
            {`${u.leaveTypeName ?? 'Balance'} after ${spanLabel(picked.from, picked.to)}: ${amount(
              picked.leftAfter,
            )} days${picked.fits ? '' : ', below zero'}`}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        {picked === undefined || u.leaveTypeKey === null ? null : (
          <Button variant="primary" startIcon={<icons.send aria-hidden />} asChild>
            <a
              href={`/time-off/request?type=${u.leaveTypeKey}&from=${picked.from}&to=${picked.to}`}
            >
              {`Request ${spanLabel(picked.from, picked.to)}`}
            </a>
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

/** "Uses 4 · away 9 · 5 of 7 in every day", or the day the team falls short. */
function impact(o: DateOption): string {
  const cost = `Uses ${String(o.used)} · away ${String(o.away.days)}`;
  const first = o.short[0];
  if (first !== undefined) {
    return `${cost} · ${shortDate(first.date)}: ${String(first.in)} of ${String(first.of)} in, below minimum`;
  }
  return o.fewest === null
    ? cost
    : `${cost} · ${String(o.fewest.in)} of ${String(o.fewest.of)} in every day`;
}

/** `2026-10` and the months after it. */
function monthAfter(today: string, n: number): string {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1 + n;
  return `${String(year + Math.floor(month / 12))}-${String((month % 12) + 1).padStart(2, '0')}`;
}
