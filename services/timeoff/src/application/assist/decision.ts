import type { TenantId } from '@kithena/contracts';

import { days } from '../../domain/days.js';
import type { DecisionView, View } from '../screens/views.js';
import type { Writer } from './ports.js';
import { written, type Line, type Written } from './written.js';
import { dayName, listOf, shortDate, spanLabel } from './words.js';

/**
 * The words on deciding one request (T15, T17, T18, MT16): the closing line
 * of "What to know" (TOF-087), why a clash matters and what fixing it costs,
 * and the message to send with each of the domain's other dates (TOF-088).
 *
 * Every figure is the decision's own: the team's worst day, the balance
 * after, the last break, the days each option swaps. The model sees none of
 * the people: the requester is `{who}`, the teammates off are a count, and the
 * request's note is never shown to it. Sick leave is never shown to it at all.
 */

type Decision = Omit<View<typeof DecisionView>, 'whatToKnow' | 'clash'>;
type Alternative = Decision['alternatives'][number];

export interface DecisionWords {
  readonly whatToKnow: Written;
  /** `null` when nothing clashes or nothing can be done about it. */
  readonly clash: Written | null;
  /** By the alternative's index: the message to send with it, for the requester's own options. */
  readonly messages: ReadonlyMap<number, Written>;
}

const worstOf = (d: Decision) => d.belowMinimum.toSorted((a, b) => a.in - b.in)[0];

/** The teammates off on a day, by first name, for the templates only. */
function offOn(d: Decision, date: string): string[] {
  return d.othersOff
    .filter((o) => o.span.from <= date && date <= o.span.to)
    .map((o) => o.displayName.split(' ')[0] ?? o.displayName);
}

function knowTemplate(d: Decision): string {
  const worst = worstOf(d);
  if (worst !== undefined) {
    return `This might be fine if ${String(worst.in)} people can cover on ${dayName(worst.date)}.`;
  }
  if (d.balance !== null && days(d.balance.after).lt(0)) {
    return `The team is covered; going below zero needs HR after you.`;
  }
  return 'This looks fine: the team stays at its minimum and the balance covers it.';
}

function clashTemplate(d: Decision, who: string): string | null {
  const worst = worstOf(d);
  if (worst === undefined || d.alternatives.length === 0) return null;
  const fixes = d.alternatives.filter((a) => a.kind !== 'approve_as_asked').length;
  return `${who}’s request would leave ${String(worst.in)} of ${String(worst.of)} in. ${
    fixes === 0
      ? 'Nothing keeps the minimum without changing it.'
      : `Here ${fixes === 1 ? 'is one way' : `are ${String(fixes)} ways`} to keep ${String(worst.required)}, with what each one costs.`
  }`;
}

/** "Wed 21 for Mon 26". */
const swapWords = (s: NonNullable<Alternative['swapped']>): string =>
  `${listOf(s.out.map(dayName))} for ${listOf(s.in.map(dayName))}`;

function messageTemplate(d: Decision, a: Alternative, who: string): string {
  const worst = worstOf(d);
  const off = worst === undefined ? [] : offOn(d, worst.date);
  const why =
    off.length === 0
      ? ''
      : ` ${listOf(off)} ${off.length === 1 ? 'is' : 'are'} out on the day you asked.`;
  const first = a.dates[0] ?? '';
  const ask =
    a.swapped !== null
      ? `could you swap ${swapWords(a.swapped)}?`
      : `could you take ${spanLabel(first, a.dates.at(-1) ?? first)} instead?`;
  return `Hi ${who}, ${ask}${why} Happy to approve straight away if that works.`;
}

export async function writeDecision(
  writer: Writer | undefined,
  tenantId: TenantId,
  d: Decision,
): Promise<DecisionWords> {
  const who = d.member.firstName;
  const sick = d.request.category === 'sick_leave';
  const worst = worstOf(d);
  const clash = clashTemplate(d, who);
  const options = d.alternatives
    .map((a, index) => ({ a, index }))
    .filter(({ a }) => a.affects === 'requester');

  const lines: Record<string, Line> = {
    know: {
      about:
        'The closing line of a note to the manager: whether this might be fine, and on what it ' +
        'depends. Never decide for them.',
      template: knowTemplate(d),
    },
    ...(clash === null
      ? {}
      : {
          clash: {
            about:
              'Two short sentences: how far below the minimum the request leaves the team, and ' +
              'that the options below keep it, with what each costs.',
            template: clash,
          },
        }),
    ...Object.fromEntries(
      options.map(({ a, index }) => [
        `m${String(index)}`,
        {
          about:
            'A short, friendly message from the manager to {who} asking them to take these ' +
            'dates instead, saying why, and that it will be approved straight away if they agree.',
          template: messageTemplate(d, a, who),
        },
      ]),
    ),
  };
  const out = await written(
    sick ? undefined : writer,
    tenantId,
    {
      instruction:
        'A manager is deciding one time-off request from {who}. Every figure was computed by the ' +
        'system; you only put it into words.',
      facts: {
        daysAsked: days(d.request.workingDays).toString(),
        dates: spanLabel(d.request.span.from, d.request.span.to),
        balanceAfter: d.balance === null ? null : days(d.balance.after).toString(),
        lastBreak: d.lastTaken === null ? null : spanLabel(d.lastTaken.from, d.lastTaken.to),
        worstDay:
          worst === undefined
            ? null
            : {
                on: shortDate(worst.date),
                in: worst.in,
                of: worst.of,
                needs: worst.required,
                othersOff: offOn(d, worst.date).length,
              },
        options: options.map(({ a, index }) => ({
          line: `m${String(index)}`,
          kind: a.kind,
          swapOut: a.swapped?.out.map(dayName) ?? [],
          swapIn: a.swapped?.in.map(dayName) ?? [],
          from: a.dates[0] === undefined ? null : shortDate(a.dates[0]),
          to: a.dates.at(-1) === undefined ? null : shortDate(a.dates.at(-1) ?? ''),
          fewestIn: Math.min(...a.coverage.filter((c) => c.checked).map((c) => c.in)),
        })),
        fixes: d.alternatives.filter((a) => a.kind !== 'approve_as_asked').length,
      },
    },
    lines,
    { who },
  );
  return {
    whatToKnow: out['know'] ?? { text: knowTemplate(d), ai: false },
    clash: clash === null ? null : (out['clash'] ?? { text: clash, ai: false }),
    messages: new Map(
      options.map(({ a, index }) => [
        index,
        out[`m${String(index)}`] ?? { text: messageTemplate(d, a, who), ai: false },
      ]),
    ),
  };
}
