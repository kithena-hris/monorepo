import { ok, type Result } from '@kithena/domain-kit';
import { CalendarDate } from '@kithena/contracts';

import type { Caller, Deps } from '../ports.js';
import { forbidden, isHrAdmin, notFound, transact } from '../shared.js';
import type { HolidayDraftView } from '../screens/views.js';
import type { Judgment } from './ports.js';
import { written } from './written.js';

/**
 * A draft of a year's holidays from data HR supplies (TOF-112, T36, §10.2):
 * the official bulletin or a list, pasted. The code reads each line's date
 * and name; TypeSafe, when there is a key, says whether each line is a
 * confirmed holiday, one still to be confirmed, or not a holiday at all,
 * and Time Off's own words ("provisional", "to be confirmed", "?") say it
 * otherwise. Nothing is saved: the draft goes back to HR, who saves the
 * confirmed days to the layer themselves, and the unconfirmed ones stay with
 * HR. A model never publishes a calendar.
 */

const MONTH_NAMES: readonly (readonly string[])[] = [
  ['january', 'jan', 'enero'],
  ['february', 'feb', 'febrero'],
  ['march', 'mar', 'marzo'],
  ['april', 'apr', 'abril'],
  ['may', 'mayo'],
  ['june', 'jun', 'junio'],
  ['july', 'jul', 'julio'],
  ['august', 'aug', 'agosto'],
  ['september', 'sept', 'sep', 'septiembre'],
  ['october', 'oct', 'octubre'],
  ['november', 'nov', 'noviembre'],
  ['december', 'dec', 'diciembre'],
];
const MONTH = MONTH_NAMES.flat().join('|');
const monthOf = (word: string): number =>
  MONTH_NAMES.findIndex((names) => names.includes(word.toLowerCase())) + 1;
const PROVISIONAL =
  /provisional|pending|to be confirmed|\btbc\b|unconfirmed|not confirmed|por confirmar|pendiente|\?/iu;

export interface DraftLine {
  readonly line: string;
  readonly date: CalendarDate | null;
  readonly name: string;
  readonly provisional: boolean;
}

function dateOf(y: number, m: number, d: number): CalendarDate | null {
  const at = new Date(Date.UTC(y, m - 1, d));
  if (at.getUTCMonth() !== m - 1 || at.getUTCDate() !== d) return null;
  return CalendarDate.parse(at.toISOString().slice(0, 10));
}

/** Each non-empty line's date, if it has one, and its name. */
export function readLines(source: string, year: number): DraftLine[] {
  const patterns: readonly [RegExp, (m: RegExpMatchArray) => CalendarDate | null][] = [
    [/\b(\d{4})-(\d{2})-(\d{2})\b/u, (m) => dateOf(Number(m[1]), Number(m[2]), Number(m[3]))],
    [
      /\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/u,
      (m) => dateOf(Number(m[3]), Number(m[2]), Number(m[1])),
    ],
    [
      new RegExp(
        `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:de\\s+)?(${MONTH})\\.?(?:,?\\s+(?:de\\s+)?(\\d{4}))?\\b`,
        'iu',
      ),
      (m) => dateOf(Number(m[3] ?? year), monthOf(m[2] ?? ''), Number(m[1])),
    ],
    [
      new RegExp(`\\b(${MONTH})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'iu'),
      (m) => dateOf(Number(m[3] ?? year), monthOf(m[1] ?? ''), Number(m[2])),
    ],
  ];
  return source
    .split(/\r?\n/u)
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .map((line) => {
      for (const [pattern, read] of patterns) {
        const m = line.match(pattern);
        const date = m === null ? null : read(m);
        if (m !== null && date !== null) {
          const name = line
            .replace(m[0], ' ')
            .replace(/\((?:[^)]*)\)/gu, (p) => (PROVISIONAL.test(p) ? ' ' : p))
            .replaceAll(new RegExp(PROVISIONAL.source, 'giu'), ' ')
            .replace(/^[\s,;:|\-–—•*]+|[\s,;:|\-–—•*]+$/gu, '')
            .replace(/\s{2,}/gu, ' ')
            .trim();
          return { line, date, name, provisional: PROVISIONAL.test(line) };
        }
      }
      return { line, date: null, name: line, provisional: false };
    });
}

export const holidayDraft =
  (deps: Pick<Deps, 'uow' | 'authz' | 'judge' | 'writer'>) =>
  async (
    caller: Caller,
    query: { readonly year: number; readonly layerKey: string; readonly source: string },
  ): Promise<Result<HolidayDraftView>> => {
    if (!(await isHrAdmin(deps, caller))) return forbidden();
    const found = await transact(deps, caller.tenantId, async (tx) => {
      const layer = (await tx.holidays.layers()).find((l) => l.key === query.layerKey);
      return layer === undefined ? notFound('Holiday calendar') : ok(layer);
    });
    if (!found.ok) return found;
    const layer = found.value;
    const lines = readLines(query.source, query.year);
    const dated = lines.filter(
      (l): l is DraftLine & { date: CalendarDate } =>
        l.date !== null && l.date.startsWith(`${String(query.year)}-`),
    );
    const answers =
      deps.judge === undefined || dated.length === 0
        ? new Map<string, Judgment>()
        : await deps.judge.choose(caller.tenantId, {
            state: { lines: dated.map((l) => l.line) },
            questions: Object.fromEntries(
              dated.map((_, i) => [
                `line_${String(i)}`,
                {
                  instructions: `HR pasted an official list of public holidays. Is \`lines[${String(i)}]\` a confirmed public holiday, one still to be confirmed, or not a holiday?`,
                  options: {
                    confirmed: 'A confirmed public holiday',
                    provisional: 'A holiday not confirmed yet',
                    not_a_holiday: 'Not a public holiday: a heading, a note or something else',
                  },
                },
              ]),
            ),
          });
    const ai = answers.size > 0;
    const known = new Set(layer.holidays.map((h) => h.date));
    const days = dated
      .map((l, i) => {
        const judged = answers.get(`line_${String(i)}`);
        const kind =
          judged !== undefined && judged.confidence >= 0.5
            ? (judged.choice as 'confirmed' | 'provisional' | 'not_a_holiday')
            : l.provisional
              ? 'provisional'
              : 'confirmed';
        return { ...l, kind };
      })
      .filter((l) => l.kind !== 'not_a_holiday' && l.name !== '')
      .filter((l, i, all) => all.findIndex((o) => o.date === l.date) === i)
      .toSorted((a, b) => a.date.localeCompare(b.date))
      .map((l) => ({
        date: l.date,
        name: l.name,
        confirmed: l.kind === 'confirmed',
        known: known.has(l.date),
      }));
    const skipped = lines
      .filter((l) => !dated.includes(l as DraftLine & { date: CalendarDate }))
      .map((l) => l.line);
    const toConfirm = days.filter((d) => !d.confirmed).length;
    const template = `Read ${String(days.length)} ${days.length === 1 ? 'day' : 'days'} for ${layer.name} in ${String(query.year)} from the list you supplied${
      toConfirm === 0
        ? ', all confirmed.'
        : `; ${String(toConfirm)} ${toConfirm === 1 ? 'is not confirmed yet and stays' : 'are not confirmed yet and stay'} with you.`
    }`;
    const summary = (
      await written(
        deps.writer,
        caller.tenantId,
        {
          instruction:
            'HR supplied an official list of public holidays and the system drafted next year’s ' +
            'calendar from it. Say in one sentence what was drafted, and that the unconfirmed days ' +
            'are left for HR. Nothing has been published.',
          facts: {
            calendar: layer.name,
            year: query.year,
            days: days.length,
            notConfirmed: toConfirm,
            linesNotRead: skipped.length,
          },
        },
        { summary: { about: 'The summary line.', template } },
      )
    ).summary;
    return ok({
      layerKey: layer.key,
      layerName: layer.name,
      year: query.year,
      days,
      skipped,
      summary,
      ai,
    });
  };
