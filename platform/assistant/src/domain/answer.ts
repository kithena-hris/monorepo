import {
  SELF_NAME,
  type AssistantAnswer,
  type AssistantChannel,
  type CapabilityOutput,
  type CatalogueLeaveType,
  type ModuleKey,
  type PeopleResult,
  type PersonRow,
} from '@kithena/contracts';

import { longDate, resolve, type Today } from './dates.js';
import type { Executed, ExecutionFailure } from './execute.js';
import type { Refusal } from './mask.js';
import type { Offer, ValidPlan, ValidStep } from './plan.js';

/**
 * The answer, written from what the modules returned (assistant PRD §7, §11).
 * Pure.
 *
 * One template per answer kind and output kind, carrying People's sentences
 * from `application/assistant/ask.ts`, so a company with People alone reads
 * what it reads today. Every number is a module's total or a count of its
 * rows; the only model-written words are the plan's `say`, written before
 * anything was looked up, kept only with no number of its own.
 *
 * Never more than the asker may see (§11.3): nothing is added about a person,
 * nothing says a result was filtered or how many were hidden. In a chat app
 * (§11.4) a private leave type is never written beside a name, and a list
 * filtered by one is given as its count and a link to Time Off's calendar —
 * unless the company chose otherwise in Time Off (`namesPrivateLeave`).
 *
 * What a capability's `described` holds: a phrase that ends a sentence about
 * people — "whose department is Sales", "away on Tuesday 6 October" — except
 * `people.reports`, whose phrase is the manager's name ("Michael Scott"), as
 * People's own answer names them.
 */

type Plan = Extract<ValidPlan, { kind: 'plan' }>;

/** What an answer is written for, besides the plan and its results. */
export interface Setting {
  readonly today: Today;
  readonly channel: AssistantChannel;
  /** What was offered, for a group's label. */
  readonly offered: Offer;
  /** Time Off's leave types, for which are private. */
  readonly leaveTypes: readonly CatalogueLeaveType[];
  /** The company's own app origin, `https://acme.app.kithena.com`, for links; null where unknown. */
  readonly origin: string | null;
  /**
   * The company chose, in Time Off, to let chat answers name people on private
   * leave (§11.4, AST-029a). It lifts the two chat rules and nothing else: the
   * rows are Time Off's, written after its sight rule, so a type the asker may
   * not see is already "Away".
   */
  readonly namesPrivateLeave: boolean;
}

/* ------------------------------------------------------------ sentences -- */

export const UNAVAILABLE = 'The assistant isn’t available right now.';
export const UNCLEAR =
  'I’m not sure I followed that. I can help with questions about your people and their time off.';
export const NO_PROFILE = 'You don’t have a profile in People yet, so I can’t answer about you.';
/** The AI gateway refused the prompt: it named something no model may see (§7.6). */
export const NOT_ALLOWED =
  'That question touches information I’m not allowed to see, so I can’t help with it here. You’ll find it in People.';
export const TOO_SLOW = 'Sorry, that took too long. Try again in a moment.';
/** The model did not answer, or not within its time: People's sentence for it. */
export const NOT_NOW =
  'Sorry, I couldn’t take that question just now. Could you try again in a moment?';
export const WHO_ARE_YOU = 'Kithena couldn’t check who you are just now. Try again in a minute.';
export const NOT_IN_KITHENA =
  'I could not find you in Kithena. Ask your HR team to check that your Slack email is your work email there.';

/** Said whenever the asker sees part of the company: the rule, the same every day. */
const PART = 'You see your own team; HR sees everyone.';
/** Said whenever somebody who is not HR filtered by a private type: the rule, not the data. */
const PRIVATE_SIGHT = 'Teammates’ sick and parental leave shows to you only as Away.';
const UTC = 'Dates are in UTC: your account has no time zone.';

const MODULE_NAMES: Readonly<Record<ModuleKey, string>> = {
  people: 'People',
  timeoff: 'Time Off',
  performance: 'Performance',
  documents: 'Documents',
  onboarding: 'Onboarding',
  compensation: 'Compensation',
  recruiting: 'Recruiting',
  reporting: 'Reporting',
};
/** What a missing module would have shown: "I can’t see time off". */
const MISSING: Partial<Record<ModuleKey, string>> = {
  people: 'reporting lines here',
  timeoff: 'time off',
};
/** What a present module helps with. */
const HELPS: Partial<Record<ModuleKey, string>> = {
  people: 'your people — who is in a team, who reports to whom, how many people work where',
  timeoff: 'who is away and when',
};
/** What cannot be said while a module is unreachable. */
const CANNOT: Partial<Record<ModuleKey, string>> = { timeoff: 'say who is away' };
const CHANNEL_NAMES: Readonly<Record<AssistantChannel, string>> = {
  slack: 'Slack',
  teams: 'Teams',
  web: 'Kithena',
};

const said = (text: string, understood: string): AssistantAnswer => ({
  text,
  understood,
  people: [],
  answered: false,
});

/** The model did not follow, or its plan was refused: its own reply where it gave one. */
export const unclearAnswer = (reply?: string): AssistantAnswer =>
  said(reply ?? UNCLEAR, 'Not a question I can answer');

/** A module this company does not have (§7.4, §7.5), and what the ones it has can do. */
export function unavailableAnswer(
  module: ModuleKey,
  present: readonly ModuleKey[],
): AssistantAnswer {
  const name = MODULE_NAMES[module];
  const helps = present.flatMap((m) => (m === module ? [] : (HELPS[m] ?? [])));
  return said(
    [
      `I can’t see ${MISSING[module] ?? 'that'}: your company doesn’t use ${name} in Kithena.`,
      ...helps.map((h) => `I can help with ${h}.`),
    ].join(' '),
    `Not part of your company’s Kithena: ${name}`,
  );
}

/** Refused before the model: People's sentence, as it stands. */
export const refusedAnswer = (refusal: Refusal): AssistantAnswer =>
  said(refusal.text, 'Not something Kithena searches by');

export function failedAnswer(failure: ExecutionFailure): AssistantAnswer {
  switch (failure.code) {
    case 'UNREACHABLE':
      return said(
        `I couldn’t reach ${MODULE_NAMES[failure.module]} just now, so I can’t ${CANNOT[failure.module] ?? 'answer that'}. Try again in a minute.`,
        `${MODULE_NAMES[failure.module]} did not answer`,
      );
    case 'REFUSED':
      return said(failure.message, `${MODULE_NAMES[failure.module]} refused`);
    case 'TOO_BROAD':
      return said(
        'That covers too many people for me to join up. Could you narrow it — to a team or a place, say?',
        'Too broad to join',
      );
    case 'DATES':
      return said(
        'I couldn’t tell which dates you meant. Could you say them another way?',
        'Dates not understood',
      );
  }
}

/* -------------------------------------------------------------- helpers -- */

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);
const count = (n: number): string => `${String(n)} ${plural(n, 'person', 'people')}`;
const sentence = (...parts: readonly (string | null | undefined)[]): string =>
  parts.filter((p): p is string => typeof p === 'string' && p !== '').join(' ');

/*
 * A model's line made ready to show, or null when it does not hold up: copied
 * from Time Off's `accept()` (`services/timeoff/src/application/assist/written.ts`),
 * which a platform service cannot import. Given no facts, any number of its
 * own drops it; `{n}` is filled from the module's total.
 */
const MAX_LINE = 320;
const PLACEHOLDER = /\{([a-z][a-z0-9]{0,11})\}/gu;
const NUMBER = /\d+(?:[.,:]\d+)*/gu;
function accept(
  value: unknown,
  facts: Readonly<Record<string, unknown>>,
  fill: Readonly<Record<string, string>>,
): string | null {
  if (typeof value !== 'string') return null;
  const line = value.trim();
  if (line.length === 0 || line.length > MAX_LINE || /[\r\n]/u.test(line)) return null;
  const known = JSON.stringify(facts);
  const bare = line.replaceAll(PLACEHOLDER, '');
  if (bare.includes('{') || bare.includes('}')) return null;
  for (const [n] of bare.matchAll(NUMBER)) {
    if (!n.split(/[.,:]/u).every((part) => known.includes(part))) return null;
  }
  for (const [, key] of line.matchAll(PLACEHOLDER)) if (fill[key ?? ''] === undefined) return null;
  return line.replaceAll(PLACEHOLDER, (_, key: string) => fill[key] ?? '');
}

/** The model's opening with its count filled in, or the template's own. */
const opening = (say: string | undefined, n: number, otherwise: string): string =>
  (say === undefined ? null : accept(say, {}, { n: String(n) })) ?? otherwise;

/** The steps a step stands on, first to last: itself and every step it narrows to. */
function chainOf(plan: Plan, step: ValidStep): ValidStep[] {
  const chain = [step];
  for (let s = step.within; s !== undefined;) {
    const before = plan.steps.find((x) => x.id === s);
    if (before === undefined) break;
    chain.unshift(before);
    s = before.within;
  }
  return chain;
}

const isManagers = (step: ValidStep): boolean => step.capability.name.endsWith('.managers');
const isReports = (step: ValidStep): boolean => step.capability.name === 'people.reports';
const isBalances = (step: ValidStep): boolean => step.capability.name === 'timeoff.balances';

const personOf = (row: { personId: string; name: string; title?: string | undefined }) => ({
  id: row.personId,
  name: row.name,
  title: row.title ?? null,
});

/** One line per person; the asker, where a module marked them, as "(you)" (§7.2). */
const listed = (
  people: readonly { name: string; title?: string | undefined; self?: true | undefined }[],
): string =>
  people
    .map(
      (p) =>
        `• ${p.name}${p.self === true ? ' (you)' : ''}${p.title === undefined ? '' : ` — ${p.title}`}`,
    )
    .join('\n');

/* ------------------------------------------------------------- the answer -- */

/** The answer to a plan that ran. */
export function answerOf(plan: Plan, executed: Executed, setting: Setting): AssistantAnswer {
  const { answered, output } = executed;
  const usedDates = plan.steps.some((s) => s.input.on !== undefined);
  const utc = usedDates && setting.today.utc ? UTC : null;
  const done = (a: AssistantAnswer): AssistantAnswer =>
    utc === null ? a : { ...a, text: sentence(a.text, utc) };
  return done(written(plan, executed, setting, answered, output));
}

function written(
  plan: Plan,
  executed: Executed,
  setting: Setting,
  step: ValidStep,
  output: CapabilityOutput,
): AssistantAnswer {
  switch (output.kind) {
    case 'not_found':
      return output.name === undefined
        ? { text: NO_PROFILE, people: [], understood: 'About you', answered: true }
        : {
            text: `I couldn’t find anyone called ${output.name}. Could you check the spelling?`,
            people: [],
            understood: `About ${output.name}`,
            answered: true,
          };
    case 'ambiguous':
      return {
        text: `A few people are called ${output.name}. Which one did you mean?\n${listed(output.candidates)}`,
        people: output.candidates.map(personOf),
        understood: `About ${output.name}`,
        answered: true,
      };
    case 'profile': {
      const joined = [
        output.manager === undefined ? null : `report to ${output.manager}`,
        output.hireDate === undefined ? null : `joined on ${longDate(output.hireDate)}`,
      ].filter((x) => x !== null);
      // An opening with a count in it means nothing about one person.
      const say = plan.say?.includes('{n}') === true ? undefined : plan.say;
      return {
        text: sentence(
          say,
          output.title === undefined
            ? `Here’s ${output.name}.`
            : `${output.name} works as ${output.title}.`,
          joined.length === 0 ? null : `They ${joined.join(' and ')}.`,
          output.email === undefined ? null : `You can reach them at ${output.email}.`,
        ),
        people: [personOf(output)],
        understood: `About ${output.name}`,
        answered: true,
      };
    }
    case 'items': {
      const n = output.total;
      return {
        text:
          n === 0
            ? 'You’re all caught up. Nothing is waiting for your approval.'
            : `${opening(plan.say, n, `${String(n)} ${plural(n, 'change is', 'changes are')} waiting for your approval:`)}\n${output.items
                .slice(0, 10)
                .map((i) => `• ${i.name} — ${i.label}`)
                .join('\n')}`,
        people: [],
        understood: 'What waits for approval',
        answered: true,
      };
    }
    case 'people':
      return peopleAnswer(plan, executed, setting, step, output);
  }
}

function peopleAnswer(
  plan: Plan,
  executed: Executed,
  setting: Setting,
  step: ValidStep,
  output: PeopleResult,
): AssistantAnswer {
  const chain = chainOf(plan, step);
  const results = chain.map((s) => executed.outputs.get(s.id));
  const visible = results.some((r) => r?.kind === 'people' && r.scope === 'visible');
  const notes = [...new Set(results.flatMap((r) => (r?.kind === 'people' ? r.notes : [])))].join(
    ' ',
  );
  const phrase = (s: ValidStep, r: CapabilityOutput | undefined): string | null =>
    r?.kind !== 'people' ? null : isReports(s) ? `reporting to ${r.described}` : r.described;
  const what = chain
    .map((s, i) => phrase(s, results[i]))
    .filter((p) => p !== null && p !== '')
    .join(' and ');
  // The model's opening never stands in for "you can see": the template carries the scope.
  const say = visible ? undefined : plan.say;
  const you = visible ? ' you can see' : '';
  const n = output.total;

  // A private leave type a filter on this chain named, and whether the asker sees only part.
  const hidden = new Set<string>(setting.leaveTypes.filter((t) => t.private).map((t) => t.key));
  const privateIn = (s: ValidStep): string[] =>
    (s.input.filters ?? [])
      .filter((f) => f.key === 'leave_type')
      .flatMap((f) => f.values.filter((v) => hidden.has(v)));
  const privateSteps = chain.filter((s) => privateIn(s).length > 0);
  const privateKeys = [...new Set(privateSteps.flatMap(privateIn))];
  const privateSight = privateSteps.some((s) => {
    const r = executed.outputs.get(s.id);
    return r?.kind === 'people' && r.scope === 'visible';
  })
    ? PRIVATE_SIGHT
    : null;
  // The chat rules for private leave, unless the company lifted them.
  const chat = setting.channel !== 'web' && !setting.namesPrivateLeave;
  // One sentence about what the asker sees: the private-type one says it for a leave type.
  const part = visible && privateSight === null ? PART : null;

  const counted = (): string =>
    n === 0
      ? `Nobody${you} ${what} at the moment.`
      : opening(
          // The count is the whole answer: an opening without it says nothing.
          say?.includes('{n}') === true ? say : undefined,
          n,
          `There ${plural(n, 'is', 'are')} ${count(n)}${you} ${what}.`,
        );

  if (plan.answer.kind === 'count' && executed.groups !== undefined) {
    const by = plan.answer.by ?? '';
    const label = (
      setting.offered.get(step.capability.name)?.fields.find((f) => f.key === by)?.label ??
      by.replaceAll('_', ' ')
    ).toLowerCase();
    const sum = executed.groups.reduce((total, g) => total + g.count, 0);
    return {
      text:
        sum === 0
          ? sentence(`Nobody${you} ${what} at the moment.`, part, privateSight, notes)
          : `${sentence(
              opening(say, sum, `Here’s how the ${count(sum)}${you} ${what} split by ${label}:`),
              part,
              privateSight,
            )}\n${executed.groups
              .map((g) => `• ${g.label ?? `No ${label}`}: ${String(g.count)}`)
              .join('\n')}${notes === '' ? '' : `\n${notes}`}`,
      people: [],
      understood: `People ${what}, by ${label}`,
      answered: true,
    };
  }

  if (plan.answer.kind === 'count') {
    return {
      text: sentence(counted(), part, privateSight, notes),
      people: [],
      understood: `People ${what}`,
      answered: true,
    };
  }

  if (isManagers(step)) {
    const of = chain
      .slice(0, -1)
      .map((s, i) => phrase(s, results[i]))
      .filter((p) => p !== null && p !== '')
      .join(' and ');
    const seen = visible ? ' that you can see' : '';
    return {
      text:
        n === 0
          ? sentence(`I couldn’t find a manager for the people ${of}${seen}.`, notes)
          : `${sentence(`The people ${of}${seen} report to:`)}\n${listed(output.rows)}${notes === '' ? '' : `\n${notes}`}`,
      people: output.rows.map(personOf),
      understood: `Managers of people ${of}`,
      answered: true,
    };
  }

  // In a chat app, a list filtered by a private type is its count and the calendar (§11.4).
  if (chat && privateKeys.length > 0) {
    const where = privateSteps.at(-1);
    const on = where?.input.on === undefined ? null : resolve(where.input.on, setting.today);
    const link =
      setting.origin === null || on === null
        ? null
        : `${setting.origin}/time-off/calendar/month?day=${on.from}&types=${privateKeys.join(',')}`;
    return {
      text: sentence(
        counted(),
        n === 0
          ? null
          : `I don’t name people on sick or parental leave in ${CHANNEL_NAMES[setting.channel]} — see who in Time Off${link === null ? '.' : `: ${link}`}`,
        part,
        privateSight,
        notes,
      ),
      people: [],
      understood: `People ${what}`,
      answered: true,
    };
  }

  // "How much vacation do I have left?": said to the asker, not listed as somebody they can see.
  const [mine] = output.rows;
  if (isBalances(step) && step.input.name === SELF_NAME && n === 1 && mine?.self === true) {
    return {
      text: `You have ${detailOf(mine, setting, chat) ?? 'no balance'}.`,
      people: [],
      understood: `You, ${what}`,
      answered: true,
    };
  }

  const rows = output.rows.slice(0, 25);
  const shown = rows.map((r) => ({ name: r.name, title: detailOf(r, setting, chat) }));
  if (isReports(step)) {
    const manager = executed.outputs.get(step.id);
    const name = manager?.kind === 'people' ? manager.described : '';
    return {
      text:
        n === 0
          ? `No one reports to ${name} at the moment.`
          : `${opening(say, n, `${name} has ${String(n)} direct ${plural(n, 'report', 'reports')}:`)}\n${listed(shown)}`,
      people: rows.map(personOf),
      understood: `Who reports to ${name}`,
      answered: true,
    };
  }

  const more =
    n > rows.length
      ? ` Here are the first ${String(rows.length)}; the directory has the rest.`
      : '';
  return {
    text:
      n === 0
        ? sentence(`I couldn’t find anyone${you} ${what}.`, part, privateSight, notes)
        : `${sentence(
            `${opening(say, n, `I found ${count(n)}${you} ${what}.`)}${more}`,
            part,
            privateSight,
          )}\n${listed(shown)}${notes === '' ? '' : `\n${notes}`}`,
    people: rows.map(personOf),
    understood: `People ${what}`,
    answered: true,
  };
}

/**
 * What follows a name on its line: the module's detail, or the job title. In
 * a chat app a private type in any part of the detail ("Thu 15 · Baja
 * médica", "3 days left · Baja médica, 25 days left · Vacation") reads "Away",
 * whoever asks (§11.4).
 */
function detailOf(row: PersonRow, setting: Setting, chat: boolean): string | undefined {
  if (row.detail === undefined) return row.title;
  if (!chat) return row.detail;
  return row.detail
    .split(', ')
    .map((part) => {
      const cut = part.lastIndexOf(' · ');
      const type = (cut < 0 ? part : part.slice(cut + 3)).trim().toLowerCase();
      const hidden = setting.leaveTypes.some(
        (t) => t.private && (t.name.toLowerCase() === type || t.key === type),
      );
      return hidden ? `${cut < 0 ? '' : `${part.slice(0, cut)} · `}Away` : part;
    })
    .join(', ');
}
