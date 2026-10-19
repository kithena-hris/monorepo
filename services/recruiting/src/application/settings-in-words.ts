import * as z from 'zod';
import { LaunchCountry } from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { BENEFIT_CATEGORIES } from '../domain/benefits/benefits.js';
import { write, type PromptSpec } from './ai.js';
import { adminOnly, type Ctx } from './context.js';

/* ------------------------------------------------------- in words (AI) -- */

/**
 * Settings asked for in words (PRD §22.3, the AI decisions): "add a Berlin
 * office under Acme GmbH", "a pipeline for interns without an assessment".
 * The model only plans: it reads the names and ids the settings hold, never a
 * person, and proposes changes as the same inputs the commands take. Nothing
 * is written here; the administrator reads the proposal and applies it, and
 * every change then goes through its own command and its own checks.
 */

const Stage = z.object({
  id: z.uuid().nullable(),
  name: z.string().min(1).max(60),
  candidateName: z.string().max(60).nullable(),
  category: z.enum([
    'applied',
    'screening',
    'interview',
    'assessment',
    'works_council',
    'offer',
    'hired',
  ]),
});
const Approver = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('person'), personId: z.uuid() }),
  z.object({ kind: z.literal('role'), role: z.enum(['hr', 'finance', 'recruiting_admin']) }),
  z.object({ kind: z.literal('managers_manager') }),
]);
const Proposed = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('saveEntity'),
    id: z.uuid().nullable(),
    name: z.string().min(1).max(200),
    country: LaunchCountry,
    currency: z.string().length(3),
    worksCouncil: z.boolean(),
  }),
  z.object({
    op: z.literal('saveLocation'),
    id: z.uuid().nullable(),
    name: z.string().min(1).max(200),
    entityId: z.uuid().nullable(),
    country: LaunchCountry,
    city: z.string().max(120).nullable(),
    timeZone: z.string().min(1).max(60),
  }),
  z.object({
    op: z.literal('saveOrgUnit'),
    id: z.uuid().nullable(),
    name: z.string().min(1).max(200),
    parentId: z.uuid().nullable(),
  }),
  z.object({
    op: z.literal('savePipeline'),
    id: z.uuid().nullable(),
    name: z.string().min(1).max(120),
    isDefault: z.boolean(),
    stages: z.array(Stage).min(2).max(20),
  }),
  z.object({
    op: z.literal('saveChain'),
    id: z.uuid().nullable(),
    name: z.string().min(1).max(120),
    appliesTo: z.enum(['requisition', 'offer']),
    priority: z.int().min(0).max(100),
    budgetAboveMinor: z.int().nonnegative().nullable(),
    legalEntityIds: z.array(z.uuid()).max(20),
    steps: z.array(Approver).min(1).max(10),
  }),
  z.object({
    op: z.literal('saveBenefit'),
    id: z.string().max(80).nullable(),
    legalEntityId: z.uuid(),
    category: z.enum(BENEFIT_CATEGORIES),
    name: z.string().min(1).max(200),
    description: z.string().max(1000).nullable(),
    value: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('money'),
        yearlyMinor: z.int().nonnegative(),
        currency: z.string().length(3),
      }),
      z.object({ kind: z.literal('percent'), basisPoints: z.int().min(0).max(10_000) }),
      z.object({ kind: z.literal('days'), days: z.int().min(0).max(365) }),
      z.object({ kind: z.literal('descriptive') }),
    ]),
    waiting: z.enum(['none', 'after_probation']),
    taxNote: z.string().max(500).nullable(),
  }),
  z.object({
    op: z.literal('saveTemplate'),
    id: z.uuid().nullable(),
    kind: z.enum(['email', 'offer_letter', 'contract']),
    purpose: z.string().min(1).max(60),
    language: z.enum(['en', 'es', 'de', 'hi']),
    name: z.string().min(1).max(120),
    subject: z.string().max(200).nullable(),
    body: z.string().min(1).max(8000),
  }),
  z.object({
    op: z.literal('remove'),
    kind: z.enum([
      'entity',
      'location',
      'orgUnit',
      'pipeline',
      'chain',
      'questionnaire',
      'template',
      'benefit',
      'payBand',
    ]),
    id: z.string().max(80),
  }),
]);
const Plan = z.object({
  say: z.string().max(400),
  changes: z.array(Proposed).max(10),
});
export type ProposedChange = z.infer<typeof Proposed>;

const IN_WORDS: PromptSpec<z.infer<typeof Plan>> = {
  feature: 'assistant',
  version: 'settings-in-words@1',
  instruction: `You plan changes to a company's recruiting settings from a request in words. You never write anything yourself: return a JSON object {"say":"","changes":[...]} and an administrator will read and apply it.
"say" is one or two plain sentences on what you propose, or what you could not do and why. "changes" is a list of at most ten, each one of:
- {"op":"saveEntity","id":<existing id or null for a new one>,"name":"","country":"DE|ES|GB|IN|US","currency":"EUR|GBP|INR|USD","worksCouncil":false}
- {"op":"saveLocation","id":null|existing,"name":"","entityId":<entity id or null>,"country":"DE|ES|GB|IN|US","city":""|null,"timeZone":"<IANA zone>"}
- {"op":"saveOrgUnit","id":null|existing,"name":"","parentId":<department id or null>}
- {"op":"savePipeline","id":null|existing,"name":"","isDefault":false,"stages":[{"id":null|existing,"name":"","candidateName":""|null,"category":"applied|screening|interview|assessment|works_council|offer|hired"}]} — a pipeline starts at applied, ends at hired, has an offer, and never goes back a category.
- {"op":"saveChain","id":null|existing,"name":"","appliesTo":"requisition|offer","priority":10,"budgetAboveMinor":null|integer,"legalEntityIds":[],"steps":[{"kind":"role","role":"hr|finance|recruiting_admin"}|{"kind":"managers_manager"}|{"kind":"person","personId":"<id from members>"}]}
- {"op":"saveBenefit","id":null|existing,"legalEntityId":"<entity id>","category":"<one of the benefit categories>","name":"","description":""|null,"value":{"kind":"money","yearlyMinor":0,"currency":"EUR"}|{"kind":"percent","basisPoints":0}|{"kind":"days","days":0}|{"kind":"descriptive"},"waiting":"none|after_probation","taxNote":""|null}
- {"op":"saveTemplate","id":null|existing,"kind":"email|offer_letter|contract","purpose":"","language":"en|es|de|hi","name":"","subject":""|null,"body":""}
- {"op":"remove","kind":"entity|location|orgUnit|pipeline|chain|questionnaire|template|benefit|payBand","id":"<existing id>"}
Use the ids in "current" to change or remove what exists, and null for something new. Never invent an id. Rows marked "people" come from the People module and cannot be renamed or removed here: say so instead. A statutory benefit cannot be removed. Keep names as the person wrote them. When the request is unclear or outside these settings, return no changes and say why.`,
  answer: Plan,
};

export interface SettingsPlan {
  readonly say: string;
  readonly changes: readonly { readonly change: ProposedChange; readonly summary: string }[];
}

export async function settingsInWords(
  ctx: Ctx,
  input: { readonly text: string },
): Promise<Result<SettingsPlan>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  const text = input.text.trim();
  if (text.length < 3) return err(failure('INVALID', 'Say what to change'));
  const entities = await ctx.tx.entities.list();
  const current = {
    entities: entities.map((e) => ({
      id: e.id,
      name: e.name,
      country: e.country,
      currency: e.currency,
      source: e.source ?? 'recruiting',
    })),
    locations: (await ctx.tx.locations.list()).map((l) => ({
      id: l.id,
      name: l.name,
      entityId: l.entityId,
      country: l.country,
      source: l.source ?? 'recruiting',
    })),
    departments: (await ctx.tx.orgUnits.list()).map((u) => ({
      id: u.id,
      name: u.name,
      parentId: u.parentId,
      source: u.source ?? 'recruiting',
    })),
    pipelines: (await ctx.tx.pipelines.list()).map((p) => ({
      id: p.id,
      name: p.name,
      isDefault: p.isDefault,
      stages: p.stages.map((s) => ({ id: s.id, name: s.name, category: s.category })),
    })),
    chains: (await ctx.tx.chains.list()).map((c) => ({
      id: c.id,
      name: c.name,
      appliesTo: c.appliesTo,
    })),
    questionnaires: (await ctx.tx.questionnaires.list()).map((q) => ({ id: q.id, name: q.name })),
    templates: (await ctx.tx.templates.list()).map((t) => ({
      id: t.id,
      name: t.name,
      kind: t.kind,
      purpose: t.purpose,
      language: t.language,
    })),
    benefits: (await ctx.tx.benefits.list()).map((b) => ({
      id: b.id,
      name: b.names['en'] ?? Object.values(b.names)[0] ?? b.key,
      legalEntityId: b.legalEntityId,
      category: b.category,
      statutory: b.statutory,
    })),
    payBands: (await ctx.tx.payBands.list()).map((b) => ({
      id: b.id,
      grade: b.grade,
      source: b.source,
    })),
    // Names only, for a chain's "person" step: who they are stays in People.
    members: (await ctx.tx.members.list()).map((m) => ({ id: m.personId, name: m.displayName })),
    benefitCategories: BENEFIT_CATEGORIES,
  };
  const planned = await write(ctx, IN_WORDS, { request: text, current });
  if (!planned.ok) return planned;
  const named = (id: string | null, list: readonly { id: string; name: string }[]): string =>
    list.find((x) => x.id === id)?.name ?? id ?? '';
  const changes = planned.value.changes.map((raw) => {
    // A new row gets its id here, so what is applied is exactly what was shown.
    const change: ProposedChange =
      'id' in raw && raw.id === null && raw.op !== 'remove'
        ? { ...raw, id: ctx.deps.newId() }
        : raw;
    const verb = 'id' in raw && raw.id === null ? 'Add' : 'Change';
    const summary = ((): string => {
      switch (change.op) {
        case 'saveEntity':
          return `${verb} legal entity ${change.name} (${change.country}, ${change.currency})`;
        case 'saveLocation':
          return `${verb} location ${change.name}${change.entityId === null ? '' : ` under ${named(change.entityId, current.entities)}`}`;
        case 'saveOrgUnit':
          return `${verb} department ${change.name}${change.parentId === null ? '' : ` under ${named(change.parentId, current.departments)}`}`;
        case 'savePipeline':
          return `${verb} pipeline ${change.name}: ${change.stages.map((s) => s.name).join(' → ')}${change.isDefault ? ' (default)' : ''}`;
        case 'saveChain':
          return `${verb} ${change.appliesTo} approval chain ${change.name}, ${String(change.steps.length)} step${change.steps.length === 1 ? '' : 's'}`;
        case 'saveBenefit':
          return `${verb} benefit ${change.name} for ${named(change.legalEntityId, current.entities)}`;
        case 'saveTemplate':
          return `${verb} ${change.kind.replaceAll('_', ' ')} template ${change.name} (${change.language.toUpperCase()})`;
        case 'remove': {
          const lists: Record<typeof change.kind, readonly { id: string; name: string }[]> = {
            entity: current.entities,
            location: current.locations,
            orgUnit: current.departments,
            pipeline: current.pipelines,
            chain: current.chains,
            questionnaire: current.questionnaires,
            template: current.templates,
            benefit: current.benefits,
            payBand: current.payBands.map((b) => ({ id: b.id, name: b.grade })),
          };
          return `Remove ${change.kind === 'orgUnit' ? 'department' : change.kind === 'payBand' ? 'pay band' : change.kind} ${named(change.id, lists[change.kind])}`;
        }
      }
    })();
    return { change, summary };
  });
  return ok({ say: planned.value.say, changes });
}
