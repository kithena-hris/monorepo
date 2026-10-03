import {
  Alert,
  Badge,
  Button,
  CopyButton,
  DatePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  RadioCard,
  RadioGroup,
  Textarea,
  icons,
} from '@reach/ui';
import { useState, useTransition, type JSX } from 'react';

import type { Outcome } from '../load';
import { AiTag, swapWords, type Alternative, type DecisionData } from './decision';
import { daysLabel, firstName, listOf, spanLabel, type CoverageDay, type Range } from './words';

/**
 * Suggesting other dates (T18, §9.5): instead of declining, the approver
 * offers dates the domain worked out, the same days with the clash swapped
 * or the next clean week, each with the coverage it keeps, or picks their
 * own. The message for the domain's dates is Time Off's (TOF-088), the
 * model's or its template; for dates picked by hand it is drafted here. It
 * is editable either way. The member accepts in one tap and is approved as
 * they do.
 */
export function SuggestDates({
  data,
  onClose,
  onSend,
}: {
  readonly data: DecisionData;
  readonly onClose: () => void;
  readonly onSend?:
    ((proposals: readonly { readonly spans: readonly Range[] }[]) => Promise<Outcome>) | undefined;
}): JSX.Element {
  const who = firstName(data.member.displayName);
  const options = data.alternatives.filter((a) => a.affects === 'requester');
  const [choice, setChoice] = useState<string>(options.length > 0 ? '0' : 'own');
  const [own, setOwn] = useState<{ from: string; to: string } | null>(null);
  const picked = choice === 'own' ? null : (options[Number(choice)] ?? null);
  const drafted = picked?.message?.text ?? draft(who, data, picked, own);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  const spans: readonly Range[] = picked?.spans ?? (own === null ? [] : [own]);
  const send = (): void => {
    if (onSend === undefined || spans.length === 0) return;
    setFailed(null);
    start(async () => {
      const outcome = await onSend([{ spans }]);
      if (!outcome.ok) setFailed(outcome.message);
    });
  };
  const text = message ?? drafted;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-190">
        <DialogHeader>
          <DialogTitle>{`Suggest other dates to ${who}`}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <RadioGroup
            aria-label="Dates to suggest"
            value={choice}
            onValueChange={(value) => {
              setChoice(value);
              setMessage(null);
            }}
            className="flex flex-col gap-2"
          >
            {options.map((option, index) => (
              <RadioCard
                key={option.kind}
                value={String(index)}
                description={describe(option)}
                impact={impactOf(option.coverage)}
                {...(index === 0
                  ? {
                      badge: (
                        <Badge tone="assistant" size="sm">
                          Suggested
                        </Badge>
                      ),
                    }
                  : {})}
              >
                {option.kind === 'swap_days'
                  ? daysLabel(option.dates)
                  : spanLabel(option.dates[0] ?? '', option.dates.at(-1) ?? '')}
              </RadioCard>
            ))}
            <RadioCard value="own" description="Choose them on the calendar.">
              Pick other dates
            </RadioCard>
          </RadioGroup>
          {choice === 'own' ? (
            <DatePicker
              mode="range"
              label="Other dates"
              value={own === null ? null : { start: own.from, end: own.to }}
              onChange={(range) => {
                setOwn(
                  range.start === null || range.end === null
                    ? null
                    : { from: range.start, to: range.end },
                );
                setMessage(null);
              }}
            />
          ) : null}
          <Field>
            <FieldLabel>Message</FieldLabel>
            <FieldControl>
              <Textarea
                autoResize
                rows={3}
                value={text}
                onChange={(event) => {
                  setMessage(event.target.value);
                }}
              />
            </FieldControl>
            <FieldDescription>
              {`Written by Kithena from your choice. Time Off sends ${who} the dates, not the message yet: copy it to ${who} if you want to say more.`}
            </FieldDescription>
          </Field>
          <div className="flex items-center justify-end gap-2">
            {message === null && picked?.message?.ai === true ? <AiTag /> : null}
            <CopyButton value={text} label="Copy the message" />
          </div>
          <Alert tone="info" title={`${who} can accept in one tap`}>
            If they accept, it is approved with no second step. If not, the original request comes
            back to you.
          </Alert>
          {failed === null ? null : (
            <Alert tone="danger" title="The suggestion was not sent">
              {failed}
            </Alert>
          )}
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            startIcon={<icons.send aria-hidden />}
            disabled={onSend === undefined || pending || spans.length === 0}
            loading={pending}
            onClick={send}
          >
            Send suggestion
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function describe(option: Alternative): string {
  if (option.kind === 'swap_days' && option.swapped !== null) {
    const n = option.dates.length;
    return `The same ${String(n)} ${n === 1 ? 'day' : 'days'}, swapping ${swapWords(option.swapped)}.`;
  }
  return 'A clean week, with nobody else short.';
}

/** "Keeps 5 of 7 in every day", from the coverage the domain worked out. */
export function impactOf(coverage: readonly CoverageDay[]): string {
  const counted = coverage.filter((c) => c.checked);
  const worst = counted.toSorted((a, b) => a.in - b.in)[0];
  if (worst === undefined) return 'No team minimum on these days';
  const short = counted.filter((c) => c.below).length;
  return short === 0
    ? `Keeps ${String(worst.in)} of ${String(worst.of)} in every day`
    : `${String(worst.in)} of ${String(worst.of)} in on ${String(short)} ${short === 1 ? 'day' : 'days'}`;
}

/** The message for dates Time Off sent none for: what changes, and why. */
function draft(
  who: string,
  data: DecisionData,
  picked: Alternative | null,
  own: Range | null,
): string {
  const clash = data.belowMinimum[0];
  const off =
    clash === undefined
      ? []
      : data.othersOff
          .filter((o) => o.span.from <= clash.date && clash.date <= o.span.to)
          .map((o) => firstName(o.displayName));
  const why =
    off.length === 0
      ? ''
      : ` ${listOf(off)} ${off.length === 1 ? 'is' : 'are'} out on the day you asked.`;
  if (picked?.swapped != null) {
    return `Hi ${who}, could you swap ${swapWords(picked.swapped)}?${why} Happy to approve straight away if that works.`;
  }
  if (picked !== null) {
    const first = picked.dates[0] ?? '';
    const last = picked.dates.at(-1) ?? first;
    return `Hi ${who}, could you take ${spanLabel(first, last)} instead?${why} Happy to approve straight away if that works.`;
  }
  return own === null
    ? `Hi ${who}, could you pick other dates?${why}`
    : `Hi ${who}, could you take ${spanLabel(own.from, own.to)} instead?${why} Happy to approve straight away if that works.`;
}
