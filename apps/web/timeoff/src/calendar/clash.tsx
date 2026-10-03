import { Alert, AssistantCard, Badge, Button, RadioCard, RadioGroup, icons } from '@reach/ui';
import { useState, useTransition, type JSX } from 'react';

import type { Outcome } from '../load';
import { AiTag, swapWords, type Alternative, type DecisionData } from '../approvals/decision';
import { impactOf } from '../approvals/suggest';
import { dayCount, dayName, firstName, shortDate, spanLabel, type Range } from '../approvals/words';

/**
 * A clash, and how to solve it (T15, §9.6): a request that would take the
 * team below its minimum, and the fixes the domain ranked by whom they
 * inconvenience: the requester changing their own dates, then approving as
 * asked (said honestly when that is fine), then asking a teammate whose
 * time off was approved first, which only works if they offer. Why it
 * matters is Time Off's line (TOF-088); the order is never the screen's.
 */
export function ClashCard({
  data,
  onSuggest,
  onDecide,
}: {
  readonly data: DecisionData;
  readonly onSuggest?:
    | ((
        requestId: string,
        proposals: readonly { readonly spans: readonly Range[] }[],
      ) => Promise<Outcome>)
    | undefined;
  readonly onDecide?:
    ((requestId: string, decision: 'approve' | 'decline') => Promise<Outcome>) | undefined;
}): JSX.Element | null {
  const options = data.alternatives;
  const [choice, setChoice] = useState('0');
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const worst = data.belowMinimum.toSorted((a, b) => a.in - b.in)[0];
  if (worst === undefined || options.length === 0) return null;
  const who = firstName(data.member.displayName);
  const picked = options[Number(choice)];
  const id = data.request.requestId;
  const run = (action: () => Promise<Outcome>, done: string): void => {
    setSaid(null);
    start(async () => {
      const outcome = await action();
      setSaid(outcome.ok ? { ok: true, text: done } : { ok: false, text: outcome.message });
    });
  };
  const suggest = (option: Alternative): void => {
    if (onSuggest !== undefined) {
      run(() => onSuggest(id, [{ spans: option.spans }]), `Sent to ${who}`);
    }
  };
  const approve = (): void => {
    if (onDecide !== undefined) run(() => onDecide(id, 'approve'), 'Approved');
  };
  return (
    <AssistantCard
      title={`${shortDate(worst.date)} is below the team minimum`}
      action={data.clash?.ai === true ? <AiTag /> : undefined}
      note="Approved time off is never moved without the person agreeing."
    >
      {data.clash === null ? null : <p className="text-sm text-fg-muted">{data.clash.text}</p>}
      <RadioGroup
        aria-label="Ways to solve it"
        value={choice}
        onValueChange={(value) => {
          setChoice(value);
          setSaid(null);
        }}
        className="flex flex-col gap-2"
      >
        {options.map((option, index) => (
          <RadioCard
            key={`${option.kind}:${option.teammate?.personId ?? ''}`}
            value={String(index)}
            description={describe(option, who)}
            impact={impact(option, who)}
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
            {titleOf(option, who)}
          </RadioCard>
        ))}
      </RadioGroup>
      {said === null ? null : (
        <Alert
          tone={said.ok ? 'success' : 'danger'}
          title={said.ok ? said.text : 'Nothing changed'}
        >
          {said.ok ? undefined : said.text}
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        {picked?.affects === 'requester' ? (
          <Button
            variant="primary"
            startIcon={<icons.send aria-hidden />}
            disabled={onSuggest === undefined || pending}
            onClick={() => {
              suggest(picked);
            }}
          >
            {picked.kind === 'swap_days'
              ? `Suggest the swap to ${who}`
              : `Suggest these dates to ${who}`}
          </Button>
        ) : null}
        {picked?.affects === 'teammate' && picked.teammate !== null ? (
          <p className="text-sm text-fg-muted">
            {`Ask ${firstName(picked.teammate.displayName)} yourself. Kithena never moves approved time off.`}
          </p>
        ) : null}
        <Button
          variant={picked?.affects === 'nobody' ? 'primary' : 'secondary'}
          disabled={onDecide === undefined || pending}
          onClick={approve}
        >
          {picked?.affects === 'nobody' ? 'Approve as asked' : 'Approve anyway'}
        </Button>
      </div>
    </AssistantCard>
  );
}

function titleOf(option: Alternative, who: string): string {
  switch (option.kind) {
    case 'swap_days':
      return option.swapped === null
        ? `Ask ${who} to move a day`
        : `Ask ${who} to swap ${swapWords(option.swapped)}`;
    case 'next_clean_week':
      return `Ask ${who} to take ${spanLabel(option.dates[0] ?? '', option.dates.at(-1) ?? '')}`;
    case 'approve_as_asked':
      return 'Approve as asked';
    case 'ask_teammate':
      return `Ask ${firstName(option.teammate?.displayName ?? 'a teammate')} to move ${
        option.absence === null
          ? 'their time off'
          : spanLabel(option.absence.from, option.absence.to)
      }`;
  }
}

function describe(option: Alternative, who: string): string {
  switch (option.kind) {
    case 'swap_days':
      return `${who} keeps ${dayCount(String(option.dates.length))}.`;
    case 'next_clean_week':
      return 'A clean week, with nobody else short.';
    case 'approve_as_asked': {
      const short = option.coverage.filter((c) => c.below);
      return short.length === 0
        ? 'Nobody falls short.'
        : `Fine if ${String(short[0]?.in ?? 0)} people can cover on ${dayName(short[0]?.date ?? '')}.`;
    }
    case 'ask_teammate':
      return 'Their time off was approved first, so this only works if they offer.';
  }
}

function impact(option: Alternative, who: string): string {
  switch (option.kind) {
    case 'swap_days':
    case 'next_clean_week':
      return `Fixes it · ${who} decides`;
    case 'approve_as_asked':
      return impactOf(option.coverage);
    case 'ask_teammate':
      return 'Fixes it · asks someone else';
  }
}
