import { ok, type Result } from '@kithena/domain-kit';
import { PolicyDefinition, type LeaveTypeKey, type NegativeBalanceRule } from '@kithena/contracts';

import { amount, days } from '../../domain/days.js';
import { workingFromCalendarDays } from '../../domain/policy/calendar-days.js';
import type { Caller, Deps } from '../ports.js';
import { forbidden, isHrAdmin, transact } from '../shared.js';
import type { PolicyReadView } from '../screens/views.js';
import { written } from './written.js';
import { dayCount } from './words.js';

/**
 * Write a policy in plain words (TOF-094, T32, PRD §6.4).
 *
 * HR writes the handbook's paragraph; Time Off reads it into the ordinary
 * policy form. The code finds every figure in the text (a number of days or
 * months, a month name) and TypeSafe, when there is a key, says what each one
 * sets, choosing among the rules the form has; Time Off's own rules read it
 * otherwise. HR can change any rule it understood, and is asked the one
 * question the text cannot answer. Nothing is created here: "Create draft"
 * sends the definition to the ordinary draft route, which the domain
 * validates, and the draft is tested on real people on T30 before it is
 * published.
 *
 * Configuration, not anybody's record: the prompt carries the text HR wrote
 * and the form's choices, and nothing about a person.
 */

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const;
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS_IN = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export type Role = 'allowance' | 'carry_over' | 'negative' | 'probation' | 'none';
type Approvers = NegativeBalanceRule['approvers'];

/** A figure in the text: a number of days or months, and the sentence it sits in. */
export interface Figure {
  readonly value: string;
  readonly unit: 'days' | 'months' | 'weeks';
  readonly sentence: string;
}

export interface Reading {
  readonly allowance: string | null;
  readonly dayKind: 'working' | 'calendar' | null;
  readonly earning: 'upfront' | 'monthly' | null;
  readonly probationMonths: number | null;
  readonly carryOver: {
    readonly maxDays: string;
    readonly useBy: { month: number; day: number } | null;
  } | null;
  readonly negative: { readonly limit: string; readonly approvers: Approvers } | null;
}

export interface ProseQuery {
  readonly text?: string | undefined;
  readonly leaveTypeKey?: LeaveTypeKey | undefined;
  readonly dayKind?: 'working' | 'calendar' | undefined;
  readonly earning?: 'upfront' | 'monthly' | undefined;
  readonly allowance?: string | undefined;
  readonly carryOver?: string | undefined;
  readonly negative?: string | undefined;
  readonly probationMonths?: number | undefined;
}

const sentencesOf = (text: string): string[] =>
  text
    .split(/(?<=[.;!?])\s+|\n+/u)
    .map((s) => s.trim())
    .filter((s) => s !== '');

/** Every number of days, weeks or months in the text, with its sentence. */
export function figuresIn(text: string): Figure[] {
  return sentencesOf(text).flatMap((sentence) =>
    [
      ...sentence.matchAll(
        /(\d+(?:\.\d+)?)\s*(?:working |business |calendar )?(days?|weeks?|months?)\b/giu,
      ),
    ].map((m) => ({
      value: m[1] ?? '0',
      unit: (m[2] ?? 'days').toLowerCase().startsWith('month')
        ? ('months' as const)
        : (m[2] ?? '').toLowerCase().startsWith('week')
          ? ('weeks' as const)
          : ('days' as const),
      sentence,
    })),
  );
}

/** What a figure sets, by the words around it. */
export function roleByRule(f: Figure): Role {
  const s = f.sentence.toLowerCase();
  if (f.unit === 'months')
    return /probation|wait|after|once|before they can|can book/u.test(s) ? 'probation' : 'none';
  if (/carr(y|ied)|roll(ed)? over|into (the )?next year|bring forward/u.test(s))
    return 'carry_over';
  if (/negative|below zero|borrow|in advance|overdraw|minus/u.test(s)) return 'negative';
  if (/year|annual|entitle|allowance|gets?\b|get \d/u.test(s)) return 'allowance';
  return 'none';
}

const approversIn = (sentence: string): Approvers => {
  const s = sentence.toLowerCase();
  const manager = /manager/u.test(s);
  const hr = /\bhr\b|human resources|people team/u.test(s);
  return manager && !hr ? 'manager' : hr && !manager ? 'hr' : 'manager_then_hr';
};

/** "before April" is the last day of March; "by 31 March" or "until March" is that day or its last. */
function useByIn(sentence: string): { month: number; day: number } | null {
  const s = sentence.toLowerCase();
  const m =
    /\b(before|by|until|till|end of)\s+(?:the\s+)?(?:(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?)?([a-z]+)/u.exec(
      s,
    );
  const month = m === null ? -1 : MONTHS.indexOf((m[3] ?? '') as (typeof MONTHS)[number]);
  if (m === null || month < 0) return null;
  if (m[1] === 'before' && m[2] === undefined) {
    const previous = (month + 11) % 12;
    return { month: previous + 1, day: DAYS_IN[previous] ?? 31 };
  }
  return { month: month + 1, day: m[2] === undefined ? (DAYS_IN[month] ?? 31) : Number(m[2]) };
}

/** Time Off's own reading, with the roles given (by rule, or by TypeSafe). */
export function readWith(
  text: string,
  roles: readonly Role[],
  over: Partial<Pick<Reading, 'earning' | 'dayKind'>> & { approvers?: Approvers } = {},
): Reading {
  const figures = figuresIn(text);
  const lower = text.toLowerCase();
  const find = (role: Role) => figures.find((_, i) => roles[i] === role);
  const allowance =
    find('allowance') ?? figures.find((f, i) => f.unit === 'days' && roles[i] === 'none');
  const carry = find('carry_over');
  const negative = find('negative');
  const probation = find('probation');
  const asDays = (f: Figure) => amount(f.unit === 'weeks' ? days(f.value).times(5) : days(f.value));
  return {
    allowance: allowance === undefined ? null : asDays(allowance),
    dayKind:
      over.dayKind ??
      (/working days|business days|workdays/u.test(lower)
        ? 'working'
        : /calendar days/u.test(lower)
          ? 'calendar'
          : null),
    earning:
      over.earning ??
      (/monthly|each month|per month|accru|earned over/u.test(lower)
        ? 'monthly'
        : /up ?front|at the start of the year|all at once/u.test(lower)
          ? 'upfront'
          : null),
    probationMonths: probation === undefined ? null : Math.round(Number(probation.value)),
    carryOver:
      carry === undefined ? null : { maxDays: asDays(carry), useBy: useByIn(carry.sentence) },
    negative:
      negative === undefined
        ? null
        : { limit: asDays(negative), approvers: over.approvers ?? approversIn(negative.sentence) },
  };
}

const ROLE_OPTIONS: Record<Role, string> = {
  allowance: 'How many days a year people get',
  carry_over: 'How many unused days can be carried into the next year',
  negative: 'How far below zero a balance may go',
  probation: 'How many months before a new joiner can book',
  none: 'None of these: something else',
};

async function readByModel(
  judge: NonNullable<Deps['judge']>,
  tenantId: string,
  text: string,
  figures: readonly Figure[],
): Promise<{ roles: Role[]; over: Parameters<typeof readWith>[2] } | null> {
  const answers = await judge.choose(tenantId, {
    state: {
      policy: text,
      figures: figures.map((f) => `${f.value} ${f.unit}, in “${f.sentence}”`),
    },
    questions: {
      ...Object.fromEntries(
        figures.map((_, i) => [
          `figure_${String(i)}`,
          {
            instructions: `In the leave policy \`policy\`, what does \`figures[${String(i)}]\` set?`,
            options: ROLE_OPTIONS,
          },
        ]),
      ),
      earning: {
        instructions:
          'Does `policy` give the year’s days up front, or are they earned month by month?',
        options: { upfront: 'Up front', monthly: 'Earned monthly', unstated: 'It does not say' },
      },
      day_kind: {
        instructions: 'Are the days in `policy` working days or calendar days?',
        options: {
          working: 'Working days',
          calendar: 'Calendar days',
          unstated: 'It does not say',
        },
      },
      approvers: {
        instructions: 'Who must agree before a balance goes below zero in `policy`?',
        options: {
          manager: 'The manager',
          manager_then_hr: 'The manager and HR',
          hr: 'HR',
          unstated: 'It does not say',
        },
      },
    },
  });
  if (answers.size === 0) return null;
  const sure = (id: string): string | undefined => {
    const a = answers.get(id);
    return a !== undefined && a.confidence >= 0.5 && a.choice !== 'unstated' ? a.choice : undefined;
  };
  const earning = sure('earning') as Reading['earning'] | undefined;
  const dayKind = sure('day_kind') as Reading['dayKind'] | undefined;
  const approvers = sure('approvers') as Approvers | undefined;
  return {
    roles: figures.map(
      (f, i) => (sure(`figure_${String(i)}`) as Role | undefined) ?? roleByRule(f),
    ),
    over: {
      ...(earning === undefined || earning === null ? {} : { earning }),
      ...(dayKind === undefined || dayKind === null ? {} : { dayKind }),
      ...(approvers === undefined ? {} : { approvers }),
    },
  };
}

const APPROVERS: Record<Approvers, string> = {
  manager: 'the manager',
  manager_then_hr: 'manager then HR',
  hr: 'HR',
};
const useByWords = (u: { month: number; day: number }): string =>
  `${String(u.day)} ${SHORT[u.month - 1] ?? ''}`;

export const readPolicyProse =
  (deps: Pick<Deps, 'uow' | 'authz' | 'clock' | 'judge' | 'writer'>) =>
  async (caller: Caller, query: ProseQuery): Promise<Result<PolicyReadView>> => {
    if (!(await isHrAdmin(deps, caller))) return forbidden();
    const types = await transact(deps, caller.tenantId, async (tx) =>
      ok(
        (await tx.leaveTypes.list())
          .filter((t) => t.definition.tracked && !t.deleted)
          .map((t) => ({
            key: t.definition.key,
            name: t.definition.name.default,
            category: t.definition.category,
          })),
      ),
    );
    if (!types.ok) return types;
    const type =
      types.value.find((t) => t.key === query.leaveTypeKey) ??
      types.value.find((t) => t.category === 'annual_leave') ??
      types.value[0];
    const text = (query.text ?? '').trim();
    const figures = figuresIn(text);
    const modelled =
      deps.judge !== undefined && text !== ''
        ? await readByModel(deps.judge, caller.tenantId, text, figures)
        : null;
    const read = readWith(text, modelled?.roles ?? figures.map(roleByRule), modelled?.over ?? {});
    const reading: Reading = {
      ...read,
      ...(query.dayKind === undefined ? {} : { dayKind: query.dayKind }),
      ...(query.earning === undefined ? {} : { earning: query.earning }),
      ...(query.allowance === undefined ? {} : { allowance: query.allowance }),
      ...(query.probationMonths === undefined ? {} : { probationMonths: query.probationMonths }),
      ...(query.carryOver === undefined
        ? {}
        : {
            carryOver:
              query.carryOver === '0'
                ? null
                : { maxDays: query.carryOver, useBy: read.carryOver?.useBy ?? null },
          }),
      ...(query.negative === undefined
        ? {}
        : {
            negative:
              query.negative === '0'
                ? null
                : {
                    limit: query.negative,
                    approvers: read.negative?.approvers ?? 'manager_then_hr',
                  },
          }),
    };

    const allowance =
      reading.allowance === null
        ? null
        : reading.dayKind === 'calendar'
          ? workingFromCalendarDays(reading.allowance)
          : amount(days(reading.allowance));
    const parsed =
      type === undefined || allowance === null
        ? null
        : PolicyDefinition.safeParse({
            leaveTypeKey: type.key,
            allowance: [{ fromYears: 0, days: allowance }],
            earning: reading.earning ?? 'upfront',
            probationMonths: reading.probationMonths ?? 0,
            carryOver:
              reading.carryOver === null
                ? null
                : {
                    maxDays: amount(days(reading.carryOver.maxDays)),
                    useBy: reading.carryOver.useBy ?? { month: 3, day: 31 },
                  },
            negativeBalance:
              reading.negative === null
                ? null
                : {
                    limit: amount(days(reading.negative.limit)),
                    approvers: reading.negative.approvers,
                  },
          });
    const problems =
      text === ''
        ? []
        : allowance === null
          ? [
              {
                path: 'allowance',
                message: 'The text does not say how many days a year people get.',
              },
            ]
          : parsed !== null && !parsed.success
            ? parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
            : [];

    const rules =
      text === '' || allowance === null
        ? []
        : [
            {
              key: 'allowance' as const,
              label: 'Allowance',
              value: `${dayCount(allowance)} a year, ${reading.earning === 'monthly' ? 'earned monthly' : 'given up front'}${
                reading.dayKind === 'calendar' && reading.allowance !== null
                  ? ` (${dayCount(amount(days(reading.allowance))).split(' ')[0] ?? ''} calendar days)`
                  : ''
              }`,
              amount: allowance,
            },
            {
              key: 'probation' as const,
              label: 'Starts',
              value:
                (reading.probationMonths ?? 0) > 0
                  ? `After ${String(reading.probationMonths)} ${reading.probationMonths === 1 ? 'month' : 'months'}, counted from day one`
                  : 'From the first day',
              amount: String(reading.probationMonths ?? 0),
            },
            {
              key: 'carry_over' as const,
              label: 'Carry-over',
              value:
                reading.carryOver === null
                  ? 'None'
                  : `Up to ${dayCount(amount(days(reading.carryOver.maxDays)))}, used by ${useByWords(
                      reading.carryOver.useBy ?? { month: 3, day: 31 },
                    )}`,
              amount: reading.carryOver === null ? '0' : amount(days(reading.carryOver.maxDays)),
            },
            {
              key: 'negative' as const,
              label: 'Negative',
              value:
                reading.negative === null
                  ? 'Not allowed'
                  : `Up to ${dayCount(amount(days(reading.negative.limit)))}, ${APPROVERS[reading.negative.approvers]}`,
              amount: reading.negative === null ? '0' : amount(days(reading.negative.limit)),
            },
          ];

    const question =
      allowance === null || reading.allowance === null
        ? null
        : reading.dayKind === null
          ? {
              key: 'day_kind' as const,
              title: `“${dayCount(amount(days(reading.allowance)))}”, but which days?`,
              template: `The text doesn’t say. I’ve assumed ${dayCount(amount(days(reading.allowance))).split(' ')[0] ?? ''} working days on a five-day week. Is that right?`,
              options: [
                { value: 'working', label: 'Yes, working days' },
                { value: 'calendar', label: 'Calendar days' },
              ],
            }
          : reading.earning === null
            ? {
                key: 'earning' as const,
                title: 'Given up front, or earned monthly?',
                template: `The text doesn’t say when the ${dayCount(allowance)} arrive. I’ve assumed all at once at the start of the year. Is that right?`,
                options: [
                  { value: 'upfront', label: 'Yes, up front' },
                  { value: 'monthly', label: 'Earned monthly' },
                ],
              }
            : null;
    const body =
      question === null
        ? null
        : (
            await written(
              deps.writer,
              caller.tenantId,
              {
                instruction:
                  'HR wrote a leave policy in plain words and the system read it into rules. Ask HR ' +
                  'the one thing the text leaves open, saying what was assumed, in one or two short sentences.',
                facts: {
                  openQuestion:
                    question.key === 'day_kind'
                      ? 'working or calendar days'
                      : 'up front or earned monthly',
                  assumed:
                    question.key === 'day_kind'
                      ? 'working days on a five-day week'
                      : 'all at once at the start of the year',
                  days: allowance,
                },
              },
              { body: { about: 'The question to HR.', template: question.template } },
            )
          ).body;

    return ok({
      text: text === '' ? null : text,
      leaveTypeKey: type?.key ?? null,
      leaveTypes: types.value.map((t) => ({ key: t.key, name: t.name })),
      ai: modelled !== null,
      rules,
      question:
        question === null || body === null
          ? null
          : { key: question.key, title: question.title, body, options: question.options },
      definition: parsed?.success === true ? parsed.data : null,
      problems,
    });
  };
