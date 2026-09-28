import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { visibleTo } from '../../domain/access/field-access.js';
import {
  instructionFor,
  readIntent,
  type CatalogueField,
  type Intent,
} from '../../domain/assistant/intent.js';
import { REPORTS_TO, refinable, type Asking, type PersonView } from '../person/person-access.js';
import type { Condition } from '../person/ports.js';
import { run } from '../person/service.js';
import { approvalsView, fieldKind, STATUS_OPTIONS } from '../screens/people.js';
import { nameOf, NOBODY, type ScreenDeps, type Tx } from '../screens/record.js';

/**
 * Ask People a question in words: from Slack, or anywhere else that carries
 * a person's question.
 *
 * The model is told the question and the names of the fields the asker may
 * filter on — never a value from anybody's record — and answers with a query
 * (`domain/assistant/intent.ts`). People runs that query as the asker, through
 * the same authorization as the directory, and writes the answer itself. The
 * prompt leaves through the AI gateway, which refuses one that names a field
 * no model may see; a field marked not for AI is not offered to the model at
 * all.
 *
 * Reads only, for now. An action somebody asks for will come back as a
 * proposal they confirm, never done on the model's word.
 */

export type { AssistantPort } from './assistant-port.js';

export interface AssistantAnswer {
  /** The answer, in words, ready to post. */
  readonly text: string;
  /** The people it names, to link to. */
  readonly people: readonly {
    readonly id: string;
    readonly name: string;
    readonly title: string | null;
  }[];
  /** How the question was read, for somebody checking the answer. */
  readonly understood: string;
  /**
   * People understood the question and answered it (even with "nobody"):
   * false when it was not a question for People, or not sent. Where several
   * modules are asked the same question, this is how an answer is chosen.
   */
  readonly answered: boolean;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** The fields this asker may filter everybody by, and that a model may be told about. */
async function catalogueOf(deps: ScreenDeps, tx: Tx, asking: Asking): Promise<CatalogueField[]> {
  const version = await deps.service.schemas.current(tx, asking.tenantId);
  if (!version) return [];
  const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
  const definitions = version.document.attributes;
  const org = await deps.calendars.load(tx, asking.tenantId);
  const fields = definitions.flatMap((d): CatalogueField[] => {
    const kind = fieldKind(d.typeConfig.kind);
    if (
      kind === null ||
      d.encrypted ||
      d.deprecatedAt !== null ||
      !d.classification.aiEligible ||
      !visibleTo(d, everyone) ||
      !refinable(
        definitions,
        { conditions: [{ key: d.key, op: 'not_empty', values: [] }] },
        everyone,
      ).ok
    ) {
      return [];
    }
    const options =
      d.typeConfig.kind === 'select'
        ? d.typeConfig.options
            .filter((o) => o.retiredAt === null)
            .map((o) => ({ value: o.value, label: o.label.default }))
        : d.typeConfig.kind === 'location_ref'
          ? [...org.locations.values()]
              .filter((l) => l.archived !== true)
              .map((l) => ({ value: l.id, label: l.name }))
          : d.typeConfig.kind === 'legal_entity_ref'
            ? [...org.entities.values()]
                .filter((e) => e.archived !== true)
                .map((e) => ({ value: e.id, label: e.name }))
            : [];
    return [{ key: d.key, label: d.label.default, kind, options }];
  });
  return everyone.isHr
    ? [...fields, { key: 'status', label: 'Status', kind: 'status', options: STATUS_OPTIONS }]
    : fields;
}

const personLine = (p: PersonView): { id: string; name: string; title: string | null } => ({
  id: p.id,
  name: nameOf(p.attributes) ?? text(p.attributes['work_email']) ?? 'Unnamed',
  title: text(p.attributes['job_title']),
});

const listed = (people: readonly { name: string; title: string | null }[]): string =>
  people.map((p) => `• ${p.name}${p.title === null ? '' : ` — ${p.title}`}`).join('\n');

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** A calendar date as people say it: "12 March 2019". */
function spokenDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      });
}

/**
 * Who the conditions pick out, as a sentence ends: "whose department is Sales
 * and who started after 1 January 2020". "everyone" when there are none.
 */
function describe(
  conditions: readonly Condition[],
  catalogue: readonly CatalogueField[],
  match: 'all' | 'any' = 'all',
): string {
  if (conditions.length === 0) return 'across the company';
  return conditions
    .map((c) => {
      const f = catalogue.find((x) => x.key === c.key);
      const label = (f?.label ?? c.key).toLowerCase();
      const values = c.values.map((v) => {
        const option = f?.options.find((o) => o.value === v)?.label;
        return option ?? (f?.kind === 'date' && v !== '' ? spokenDate(v) : v);
      });
      switch (c.op) {
        case 'empty':
          return `with no ${label} yet`;
        case 'not_empty':
          return `with a ${label}`;
        case 'contains':
          return `whose ${label} mentions ${values.join(' or ')}`;
        case 'before':
          return `whose ${label} is before ${values[0] ?? ''}`;
        case 'after':
          return `whose ${label} is after ${values[0] ?? ''}`;
        case 'between':
          return `whose ${label} is between ${values[0] || 'the start'} and ${values[1] || 'today'}`;
        default:
          return `whose ${label} is ${values.join(' or ')}`;
      }
    })
    .join(match === 'any' ? ', or ' : ' and ');
}

/** The model's opening with its count filled in, or People's own. */
const opening = (say: string | undefined, n: number, otherwise: string): string =>
  say === undefined ? otherwise : say.replaceAll('{n}', String(n));

/** One person by name, as the asker may find them; null when nobody or several match. */
/** How the model, or a person, names the asker. */
const SELF = /^(@me|me|myself|i|my self)$/iu;

const NO_PROFILE = 'You don’t have a profile in People yet, so I can’t answer about you.';

async function onePerson(
  deps: ScreenDeps,
  tx: Tx,
  asking: Asking,
  name: string,
): Promise<{ person: PersonView | null; several: readonly PersonView[]; self?: 'none' }> {
  // "Me" is whoever asks: resolved here, so the model never needs their name.
  if (SELF.test(name.trim())) {
    const own = await deps.personOf(tx, asking.tenantId, asking.viewer.accountId);
    if (own === null) return { person: null, several: [], self: 'none' };
    const read = await deps.service.access.read(tx, { ...asking, personId: own });
    return { person: read.ok ? read.value : null, several: [] };
  }
  const found = await deps.service.access.list(tx, { ...asking, search: name, limit: 5 });
  const items = found.ok ? found.value.items : [];
  return items.length === 1
    ? { person: items[0] ?? null, several: [] }
    : { person: null, several: items };
}

async function answer(
  deps: ScreenDeps,
  tx: Tx,
  asking: Asking,
  intent: Intent,
  catalogue: readonly CatalogueField[],
): Promise<AssistantAnswer> {
  switch (intent.kind) {
    case 'unclear':
      return {
        text: intent.reply,
        people: [],
        understood: 'Not a question People can answer',
        answered: false,
      };
    case 'people': {
      const refine = { conditions: intent.conditions, match: intent.match };
      const [found, counted] = await Promise.all([
        deps.service.access.list(tx, { ...asking, refine, limit: intent.limit }),
        deps.service.access.count(tx, { ...asking, refine }),
      ]);
      if (!found.ok)
        return { text: found.error.message, people: [], understood: 'Refused', answered: false };
      const people = found.value.items.map(personLine);
      const total = counted.ok ? counted.value.all : people.length;
      const what = describe(intent.conditions, catalogue, intent.match);
      const open = opening(
        intent.say,
        total,
        `I found ${String(total)} ${plural(total, 'person', 'people')} ${what}.`,
      );
      const more =
        total > people.length
          ? ` Here are the first ${String(people.length)}; the directory has the rest.`
          : '';
      return {
        text: total === 0 ? `I couldn’t find anyone ${what}.` : `${open}${more}\n${listed(people)}`,
        people,
        understood: `People ${what}`,
        answered: true,
      };
    }
    case 'count': {
      const refine = { conditions: intent.conditions, match: intent.match };
      const what = describe(intent.conditions, catalogue, intent.match);
      const group = catalogue.find((f) => f.key === intent.groupBy);
      if (group === undefined) {
        const counted = await deps.service.access.count(tx, { ...asking, refine });
        if (!counted.ok)
          return {
            text: counted.error.message,
            people: [],
            understood: 'Refused',
            answered: false,
          };
        const n = counted.value.all;
        return {
          text:
            n === 0
              ? `Nobody ${what} at the moment.`
              : opening(
                  // The count is the whole answer: an opening without it says nothing.
                  intent.say?.includes('{n}') === true ? intent.say : undefined,
                  n,
                  `There ${plural(n, 'is', 'are')} ${String(n)} ${plural(n, 'person', 'people')} ${what}.`,
                ),
          people: [],
          understood: `How many ${what}`,
          answered: true,
        };
      }
      const rows: string[] = [];
      let sum = 0;
      for (const option of group.options.slice(0, 20)) {
        const counted = await deps.service.access.count(tx, {
          ...asking,
          refine: {
            conditions: [
              ...intent.conditions,
              { key: group.key, op: 'in', values: [option.value] },
            ],
            match: 'all',
          },
        });
        if (counted.ok && counted.value.all > 0) {
          sum += counted.value.all;
          rows.push(`• ${option.label}: ${String(counted.value.all)}`);
        }
      }
      return {
        text:
          rows.length === 0
            ? `Nobody ${what} at the moment.`
            : `${opening(intent.say, sum, `Here’s how the ${String(sum)} ${plural(sum, 'person', 'people')} ${what} split by ${group.label.toLowerCase()}:`)}\n${rows.join('\n')}`,
        people: [],
        understood: `How many ${what}, by ${group.label.toLowerCase()}`,
        answered: true,
      };
    }
    case 'person': {
      const { person, several, self } = await onePerson(deps, tx, asking, intent.name);
      if (self === 'none') return { text: NO_PROFILE, people: [], understood: 'About you', answered: true };
      if (person === null) {
        return several.length === 0
          ? {
              text: `I couldn’t find anyone called ${intent.name}. Could you check the spelling?`,
              people: [],
              understood: `About ${intent.name}`,
              answered: true,
            }
          : {
              text: `A few people are called ${intent.name}. Which one did you mean?\n${listed(several.map(personLine))}`,
              people: several.map(personLine),
              understood: `About ${intent.name}`,
              answered: true,
            };
      }
      const line = personLine(person);
      const a = person.attributes;
      const manager = text(a[REPORTS_TO]);
      const managerName =
        manager === null
          ? null
          : await deps.service.access
              .read(tx, { ...asking, personId: manager })
              .then((r) => (r.ok ? nameOf(r.value.attributes) : null));
      const hired = text(a['hire_date']);
      const email = text(a['work_email']);
      const joined = [
        managerName === null ? null : `report to ${managerName}`,
        hired === null ? null : `joined on ${spokenDate(hired)}`,
      ].filter((x) => x !== null);
      const sentences = [
        line.title === null ? `Here’s ${line.name}.` : `${line.name} works as ${line.title}.`,
        joined.length === 0 ? null : `They ${joined.join(' and ')}.`,
        email === null ? null : `You can reach them at ${email}.`,
      ].filter((x) => x !== null);
      return {
        text: [intent.say ?? null, ...sentences].filter((x) => x !== null).join(' '),
        people: [line],
        understood: `About ${line.name}`,
        answered: true,
      };
    }
    case 'reports': {
      const { person, several, self } = await onePerson(deps, tx, asking, intent.name);
      if (self === 'none') return { text: NO_PROFILE, people: [], understood: 'Who reports to you', answered: true };
      if (person === null) {
        return {
          text:
            several.length === 0
              ? `I couldn’t find anyone called ${intent.name}. Could you check the spelling?`
              : `A few people are called ${intent.name}. Which one did you mean?\n${listed(several.map(personLine))}`,
          people: several.map(personLine),
          understood: `Who reports to ${intent.name}`,
          answered: true,
        };
      }
      const manager = personLine(person);
      const reports = await deps.service.access.list(tx, {
        ...asking,
        where: { [REPORTS_TO]: person.id },
        limit: 25,
      });
      const people = reports.ok ? reports.value.items.map(personLine) : [];
      return {
        text:
          people.length === 0
            ? `No one reports to ${manager.name} at the moment.`
            : `${opening(intent.say, people.length, `${manager.name} has ${String(people.length)} direct ${plural(people.length, 'report', 'reports')}:`)}\n${listed(people)}`,
        people,
        understood: `Who reports to ${manager.name}`,
        answered: true,
      };
    }
    case 'approvals': {
      const inbox = await approvalsView(deps, asking);
      const items = inbox.ok ? inbox.value.items : [];
      return {
        text:
          items.length === 0
            ? 'You’re all caught up. Nothing is waiting for your approval.'
            : `${opening(intent.say, items.length, `${String(items.length)} ${plural(items.length, 'change is', 'changes are')} waiting for your approval:`)}\n${items
                .slice(0, 10)
                .map((i) => `• ${i.name} — ${i.label}`)
                .join('\n')}`,
        people: [],
        understood: 'What waits for approval',
        answered: true,
      };
    }
  }
}

/** The most earlier questions a follow-up is read with. */
export const EARLIER = 5;

export async function ask(
  deps: ScreenDeps,
  asking: Asking,
  question: string,
  /** Earlier questions in the same conversation, oldest first: never their answers. */
  earlier: readonly string[] = [],
): Promise<Result<AssistantAnswer>> {
  const assistant = deps.assistant;
  if (assistant === undefined) {
    return err(failure('UNAVAILABLE', 'The assistant is not set up here: no model is configured'));
  }
  const q = question.trim();
  if (q === '') return err(failure('QUESTION_EMPTY', 'Ask a question', ['question']));

  const catalogue = await run(deps.service, asking.tenantId, async (tx) => {
    await assistant.loadPolicies(tx, asking.tenantId);
    return ok(await catalogueOf(deps, tx, asking));
  });
  if (!catalogue.ok) return catalogue;

  const today = deps.clock.instant().slice(0, 10);
  const completed = await assistant.complete(asking.tenantId, {
    instruction: `${instructionFor()}\nToday is ${today}.`,
    context: {
      question: q,
      ...(earlier.length === 0
        ? {}
        : { earlier: earlier.slice(-EARLIER).map((e) => e.trim().slice(0, 500)) }),
      fields: catalogue.value,
    },
  });
  if (!completed.ok) {
    return ok({
      text:
        completed.error.code === 'AI_FIELD_NAMED' || completed.error.code === 'AI_VALUE_DENIED'
          ? 'That question touches information I’m not allowed to see, so I can’t help with it here. You’ll find it in People.'
          : 'Sorry, I couldn’t take that question just now. Could you try again in a moment?',
      people: [],
      understood: 'Not sent to the assistant',
      answered: false,
    });
  }
  const intent = readIntent(completed.value, catalogue.value);
  return run(deps.service, asking.tenantId, async (tx) =>
    ok(await answer(deps, tx, asking, intent, catalogue.value)),
  );
}
