import type { TenantId } from '@kithena/contracts';

import type { RightNowView } from '../screens/views.js';
import type { Writer } from './ports.js';
import { written, type Written } from './written.js';
import { clock, dayName, listOf } from './words.js';

/**
 * Today, in a sentence (TOF-091, T22, §11.6): what is normal on the board, so
 * a manager does not chase a non-issue. From the board's own facts — how many
 * are in, on a break, not in yet and away, the latest start today and whether
 * it was inside the team's hours, the fixes and overtime waiting — written by
 * the model with every person a placeholder, or by a template. Why anyone is
 * away is never said, nor sent.
 */

type Person = RightNowView['people'][number];
type Need = RightNowView['needsYou'][number];

const first = (name: string): string => name.split(' ')[0] ?? name;
const started = (p: Person): number | undefined =>
  p.today.segments.find((s) => s.kind === 'worked' || s.kind === 'live' || s.kind === 'overtime')
    ?.from;

export async function writeToday(
  writer: Writer | undefined,
  tenantId: TenantId,
  people: readonly Person[],
  needsYou: readonly Need[],
  away: ReadonlySet<string>,
): Promise<Written> {
  const present = people.filter((p) => !away.has(p.personId));
  const count = {
    in: present.filter((p) => p.state === 'in').length,
    onBreak: present.filter((p) => p.state === 'on_break').length,
    notInYet: present.filter((p) => p.state === 'out' && p.today.status !== 'complete').length,
    away: people.length - present.length,
  };
  const latest = present
    .filter((p) => started(p) !== undefined)
    .toSorted((a, b) => (started(b) ?? 0) - (started(a) ?? 0))[0];
  const fixes = needsYou.filter((n) => n.kind === 'correction');
  const overtime = needsYou.filter((n) => n.kind === 'overtime');

  const names = new Map<string, string>();
  const fill: Record<string, string> = {};
  const key = (personId: string, name: string): string => {
    const found = [...names].find(([, id]) => id === personId)?.[0];
    if (found !== undefined) return found;
    const k = `p${String(names.size)}`;
    names.set(k, personId);
    fill[k] = first(name);
    return k;
  };
  const lateKey = latest === undefined ? null : key(latest.personId, latest.displayName);
  const fixKeys = fixes.map((n) => ({ who: key(n.personId, n.displayName), on: dayName(n.date) }));
  const otKeys = overtime.map((n) => ({
    who: key(n.personId, n.displayName),
    minutes: n.minutes ?? 0,
  }));

  const lateStart = latest === undefined ? undefined : started(latest);
  const late =
    latest === undefined || lateStart === undefined
      ? ''
      : ` ${first(latest.displayName)} started at ${clock(lateStart)}${
          latest.today.flags.includes('core_hours_missed')
            ? ', after core hours began.'
            : ', inside the team’s hours.'
        }`;
  const head =
    count.notInYet === 0
      ? 'Everyone expected is in.'
      : `${String(count.in)} in, ${String(count.notInYet)} not in yet.`;
  const open =
    fixes.length === 0
      ? ''
      : ` ${listOf(fixes.map((n) => `${first(n.displayName)} has an open fix from ${dayName(n.date)}`))}.`;
  const template = people.length === 0 ? 'Nobody reports to you yet.' : `${head}${late}${open}`;

  const out = await written(
    writer,
    tenantId,
    {
      instruction:
        'A manager is looking at their team’s attendance board. Say in one or two calm sentences ' +
        'what is normal today and what, if anything, needs them.',
      facts: {
        in: count.in,
        onBreak: count.onBreak,
        notInYet: count.notInYet,
        away: count.away,
        latestStart:
          lateKey === null || lateStart === undefined
            ? null
            : {
                who: `{${lateKey}}`,
                at: clock(lateStart),
                insideHours: !latest?.today.flags.includes('core_hours_missed'),
              },
        openFixes: fixKeys.map((f) => ({ who: `{${f.who}}`, from: f.on })),
        overtimeWaiting: otKeys.map((o) => ({ who: `{${o.who}}`, minutes: o.minutes })),
      },
    },
    { sentence: { about: 'The line, at most two short sentences.', template } },
    people.length === 0 ? {} : fill,
  );
  return people.length === 0 ? { text: template, ai: false } : out.sentence;
}
