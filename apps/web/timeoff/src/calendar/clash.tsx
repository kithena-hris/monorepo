import { Alert, AssistantCard, Badge, Button, RadioCard, RadioGroup, icons } from '@reach/ui';
import { useState, useTransition, type JSX } from 'react';

import type { Outcome } from '../load';
import type { Alternative, DecisionData } from '../approvals/decision';
import { AiTag, impactOf, swapWords } from '../approvals/words';
import { dayCount, dayName, firstName, shortDate, spanLabel, type Range } from '../approvals/words';
import { t } from '../i18n';

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
      run(
        () => onSuggest(id, [{ spans: option.spans }]),
        t('calendar.clash.sent_to', 'Sent to {{who}}', { who }),
      );
    }
  };
  const approve = (): void => {
    if (onDecide !== undefined)
      run(() => onDecide(id, 'approve'), t('calendar.clash.approved', 'Approved'));
  };
  return (
    <AssistantCard
      title={t('calendar.clash.is_below_the_team_minimum', '{{date}} is below the team minimum', {
        date: shortDate(worst.date),
      })}
      action={data.clash?.ai === true ? <AiTag /> : undefined}
      note={t(
        'calendar.clash.approved_time_off_is_never_moved',
        'Approved time off is never moved without the person agreeing.',
      )}
    >
      {data.clash === null ? null : <p className="text-sm text-fg-muted">{data.clash.text}</p>}
      <RadioGroup
        aria-label={t('calendar.clash.ways_to_solve_it', 'Ways to solve it')}
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
                      {t('calendar.clash.suggested', 'Suggested')}
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
          title={said.ok ? said.text : t('calendar.clash.nothing_changed', 'Nothing changed')}
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
              ? t('calendar.clash.suggest_the_swap_to', 'Suggest the swap to {{who}}', { who })
              : t('calendar.clash.suggest_these_dates_to', 'Suggest these dates to {{who}}', {
                  who,
                })}
          </Button>
        ) : null}
        {picked?.affects === 'teammate' && picked.teammate !== null ? (
          <p className="text-sm text-fg-muted">
            {t(
              'calendar.clash.ask_yourself_kithena_never_moves_approved',
              'Ask {{firstName}} yourself. Kithena never moves approved time off.',
              { firstName: firstName(picked.teammate.displayName) },
            )}
          </p>
        ) : null}
        <Button
          variant={picked?.affects === 'nobody' ? 'primary' : 'secondary'}
          disabled={onDecide === undefined || pending}
          onClick={approve}
        >
          {picked?.affects === 'nobody'
            ? t('calendar.clash.approve_as_asked', 'Approve as asked')
            : t('calendar.clash.approve_anyway', 'Approve anyway')}
        </Button>
      </div>
    </AssistantCard>
  );
}

function titleOf(option: Alternative, who: string): string {
  switch (option.kind) {
    case 'swap_days':
      return option.swapped === null
        ? t('calendar.clash.ask_to_move_a_day', 'Ask {{who}} to move a day', { who })
        : t('calendar.clash.ask_to_swap', 'Ask {{who}} to swap {{swapWords}}', {
            who,
            swapWords: swapWords(option.swapped),
          });
    case 'next_clean_week':
      return t('calendar.clash.ask_to_take', 'Ask {{who}} to take {{spanLabel}}', {
        who,
        spanLabel: spanLabel(option.dates[0] ?? '', option.dates.at(-1) ?? ''),
      });
    case 'approve_as_asked':
      return t('calendar.clash.approve_as_asked', 'Approve as asked');
    case 'ask_teammate':
      return option.absence === null
        ? t(
            'calendar.clash.ask_to_move_their_time_off',
            'Ask {{firstName}} to move their time off',
            {
              firstName: firstName(
                option.teammate?.displayName ?? t('calendar.clash.a_teammate', 'a teammate'),
              ),
            },
          )
        : t('calendar.clash.ask_to_move', 'Ask {{firstName}} to move {{value}}', {
            firstName: firstName(
              option.teammate?.displayName ?? t('calendar.clash.a_teammate', 'a teammate'),
            ),
            value: spanLabel(option.absence.from, option.absence.to),
          });
  }
}

function describe(option: Alternative, who: string): string {
  switch (option.kind) {
    case 'swap_days':
      return t('calendar.clash.keeps', '{{who}} keeps {{dayCount}}.', {
        who,
        dayCount: dayCount(String(option.dates.length)),
      });
    case 'next_clean_week':
      return t(
        'calendar.clash.a_clean_week_with_nobody_else',
        'A clean week, with nobody else short.',
      );
    case 'approve_as_asked': {
      const short = option.coverage.filter((c) => c.below);
      return short.length === 0
        ? t('calendar.clash.nobody_falls_short', 'Nobody falls short.')
        : t(
            'calendar.clash.fine_if_people_can_cover_on',
            'Fine if {{value}} people can cover on {{dayName}}.',
            { value: String(short[0]?.in ?? 0), dayName: dayName(short[0]?.date ?? '') },
          );
    }
    case 'ask_teammate':
      return t(
        'calendar.clash.their_time_off_was_approved_first',
        'Their time off was approved first, so this only works if they offer.',
      );
  }
}

function impact(option: Alternative, who: string): string {
  switch (option.kind) {
    case 'swap_days':
    case 'next_clean_week':
      return t('calendar.clash.fixes_it_decides', 'Fixes it · {{who}} decides', { who });
    case 'approve_as_asked':
      return impactOf(option.coverage);
    case 'ask_teammate':
      return t('calendar.clash.fixes_it_asks_someone_else', 'Fixes it · asks someone else');
  }
}
