import {
  Alert,
  Button,
  Calendar,
  Card,
  ChipGroup,
  ChipGroupItem,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
  Text,
  type DateRange,
} from '@reach/ui-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { useAct } from '../people/act';
import { keptAnswer, read, useSigned } from '../people/api';
import { amount, longSpan } from './words';

interface LeaveType {
  readonly key: string;
  readonly name: string;
  readonly category: string;
  readonly left: string | null;
  readonly unit: 'day' | 'hour';
}

export interface Preview {
  readonly approver: { readonly displayName: string; readonly personId: string } | null;
  readonly approvers: readonly string[];
  readonly balance: { readonly before: string; readonly after: string } | null;
  readonly belowMinimum: readonly { date: string; in: number; of: number; required: number }[];
  readonly blocked: boolean;
  readonly daysAway: { readonly days: string; readonly from: string; readonly to: string };
  readonly negative: { readonly kind: 'fits' | 'borrow' | 'refused' };
  readonly span: {
    readonly from: string;
    readonly to: string;
    readonly endsHalfDay: boolean;
    readonly workingDays: string;
  };
}

/** "Marco", "Marco and HR": who a request goes to, by first name. */
export function approversOf(preview: Preview | null): string | null {
  if (preview === null) return null;
  const names = preview.approvers.map((r) =>
    r === 'manager' && preview.approver !== null
      ? (preview.approver.displayName.split(' ')[0] ?? preview.approver.displayName)
      : r === 'hr'
        ? 'HR'
        : 'your manager',
  );
  return names.length === 0 ? null : names.join(' and ');
}

/**
 * Requesting time off with a calendar (design v3 T3), for people who would
 * rather tap: the type, the dates and what they cost, in one centred modal.
 * Weekends and holidays are not counted; Time Off says how many days are.
 */
export function RequestDialog({
  initial,
  onClose,
  onSent,
}: {
  initial?: { leaveTypeKey?: string; from?: string; to?: string };
  onClose: () => void;
  onSent: (requestId: string) => void;
}): React.JSX.Element {
  const signed = useSigned();
  const { act, busy } = useAct('timeoff');
  const [types, setTypes] = useState<readonly LeaveType[] | null>(
    () =>
      keptAnswer<{ leaveTypes: LeaveType[] }>(signed, 'TimeOffRequestPanel', {}, 'timeoff')?.data
        .leaveTypes ?? null,
  );
  const [type, setType] = useState<string | null>(initial?.leaveTypeKey ?? null);
  const [range, setRange] = useState<DateRange>({
    start: initial?.from ?? null,
    end: initial?.to ?? initial?.from ?? null,
  });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const dated = type !== null && range.start !== null && range.end !== null;

  useEffect(() => {
    let live = true;
    setPreview(null);
    setProblem(null);
    void read<{ leaveTypes: LeaveType[]; preview: Preview | null }>(
      signed,
      'TimeOffRequestPanel',
      dated ? { leaveTypeKey: type, from: range.start, to: range.end, endsHalfDay: false } : {},
      'timeoff',
    ).then((answer) => {
      if (!live) return;
      if (!answer.ok) {
        setProblem(answer.message);
        return;
      }
      setTypes(answer.data.leaveTypes);
      setPreview(answer.data.preview);
      // The first type, Vacation as a rule, is chosen until somebody picks another.
      setType((was) => was ?? answer.data.leaveTypes.find((t) => t.category !== 'parental_leave')?.key ?? null);
    });
    return () => {
      live = false;
    };
  }, [signed, type, range.start, range.end]);

  const offered = (types ?? []).filter((t) => t.category !== 'parental_leave');
  const to = approversOf(preview);
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request time off</DialogTitle>
          {to === null ? null : <DialogDescription>{`${to} approves.`}</DialogDescription>}
        </DialogHeader>
        <DialogBody>
          {types === null ? (
            <Spinner label="Loading your leave types" />
          ) : (
            <>
              <View>
                <ChipGroup
                  type="single"
                  value={type ?? ''}
                  onValueChange={setType}
                  accessibilityLabel="Type"
                  scroll
                >
                  {offered.map((t) => (
                    <ChipGroupItem key={t.key} value={t.key}>
                      {t.name}
                    </ChipGroupItem>
                  ))}
                </ChipGroup>
              </View>
              <Calendar mode="range" label="Dates" selected={range} onSelect={setRange} />
              {problem === null ? null : <Alert tone="danger">{problem}</Alert>}
              {preview === null ? null : (
                <Card variant="fill">
                  <View className="flex-row items-center gap-3">
                    <View className="flex-1 gap-0.5">
                      <Text weight="semibold">{`${amount(preview.span.workingDays)} working ${preview.span.workingDays === '1' ? 'day' : 'days'}`}</Text>
                      <Text variant="footnote" tone="muted">
                        {longSpan(preview.span.from, preview.span.to)}
                      </Text>
                    </View>
                    {preview.balance === null ? null : (
                      <Text
                        weight="semibold"
                        tone={Number(preview.balance.after) < 0 ? 'danger' : 'default'}
                      >{`${amount(preview.balance.after)} left after`}</Text>
                    )}
                  </View>
                  {preview.belowMinimum.length === 0 ? null : (
                    <Text variant="footnote" tone="warning">
                      {`The team would be short on ${String(preview.belowMinimum.length)} ${preview.belowMinimum.length === 1 ? 'day' : 'days'}.`}
                    </Text>
                  )}
                </Card>
              )}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            disabled={preview === null || preview.blocked || preview.negative.kind === 'refused' || type === null}
            loading={busy === 'RequestTimeOff'}
            onPress={() => {
              if (preview === null || type === null) return;
              void act<{ requestId: string }>(
                'RequestTimeOff',
                {
                  input: {
                    leaveTypeKey: type,
                    span: {
                      from: preview.span.from,
                      to: preview.span.to,
                      startsHalfDay: false,
                      endsHalfDay: false,
                    },
                    note: null,
                  },
                },
                'Sent',
              ).then((sent) => {
                if (sent !== null) onSent(sent.requestId);
              });
            }}
          >
            {to === null ? 'Send' : `Send to ${to}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
