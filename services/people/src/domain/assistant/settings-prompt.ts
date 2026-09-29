import type { AttributeDefinition, RequirednessPredicate } from '@kithena/contracts';

import { PACK_COUNTRIES, specOf, type FieldSpec, type SettingsSnapshot } from './settings-plan.js';

/**
 * The words either side of the model (docs/ai-settings.md).
 *
 * `SETTINGS_INSTRUCTION` is what the model is told, once, the same for every
 * company, so it is cached with the tools. `planningContext` is the settings
 * as they are, which it is shown beside the request: section and field
 * metadata, legal entities and locations — never a person and never a value
 * from anybody's record.
 *
 * `settingsPrompt` goes the other way: a setting, written out as a request
 * the planner turns back into the same plan. Deterministic, from the stored
 * setting and nothing else, and as complete as a field's editor — so it can be
 * copied into "Set up with AI" at another company, or anywhere else. It holds
 * configuration only: a role is written without the person who holds it.
 */

export const SETTINGS_INSTRUCTION = `You set up the People settings of an HR system from an administrator's request. You never change anything yourself: you propose changes by calling the tools, and the administrator reviews every one before anything is applied.

How to answer
- Propose every change the request needs in one reply, calling the tools in parallel. Then call finish_plan once, last, with one sentence saying what the plan does. The summary names no person and no value.
- The message holds the settings as they are now. Refer to existing sections and fields by their keys and change what exists rather than adding a duplicate: "rename the Bank section to Payment" is rename_section on the existing section.
- Refer to a section this plan adds by its name.
- If part of the request is outside these tools, call cannot_do for that part and propose the rest. If none of it is about these settings, call cannot_do with area "other", then finish_plan.

Employee fields
- Every new field needs dataType, requiredness, ownership (who fills it in), visibility (who sees it), collectAt, classification and piiKind. Give help text (description) when it helps somebody fill the field in.
- Who fills it in: employee, manager, hr, finance, system. Who sees it: self (the employee), manager, manager_chain (managers above), hr, finance, admin (People administrators), directory (everybody in the company). "Managers see it" means manager; "managers do not see it" leaves out manager and manager_chain. A required field must be seen by somebody who fills it in: an employee who fills it in needs self.
- When it is asked: onboarding for what a new starter fills in, hr_only for what only HR records, signup for what is needed on the first day, anytime otherwise.
- Protection, never less than the data needs: health, disability, religion, ethnicity, trade union membership, sexual orientation and biometrics are special-category (piiKind health or biometric, or none for beliefs). Bank details, salary, pay and tax are confidential with piiKind financial. National identifiers are confidential with piiKind identity and dataType national_id. Contact details are confidential or internal with piiKind contact. Free text that could hold anything is at least confidential. When the request calls something sensitive, it is at least confidential.
- Financial data and identifiers are stored encrypted, so their type must be one that can be: text, long_text, email, phone, url, number, decimal, date, money, national_id or bank_account — never a choice, a percentage, a reference or a file.
- A national_id field needs country and scheme; a bank_account field needs country. For a country's statutory identifiers prefer add_country_pack (ES adds NIF/NIE and the Social Security number; GB the National Insurance number; DE the tax id and social insurance number; IN PAN and UAN; US the SSN) instead of adding them by hand.
- Required on some records only: requiredness conditional with requiredWhen, clauses over country (codes), legalEntity (ids from the settings), employmentType, workModel, status, or another field being set or equal to one of its option keys.
- Options are the choices' labels, in order.

Organisation, reporting and roles
- A legal entity is the employer of record: a name, a country and an IANA time zone (Europe/Madrid, never an offset). A work location belongs to one legal entity: name the entity, which may be one this plan adds.
- Employee numbering is per legal entity: a prefix, the digits it is padded to, and where it starts.
- set_cohort_minimum raises the smallest group reports describe; it is never lowered.
- Grant or revoke a role by the person's name as the request writes it. Roles are hr, finance and people_admin.

Never
- Never set up integrations, webhooks, provisioning (SCIM), chat apps, or anything that needs a secret, a token, a password or an address to call: call cannot_do for them.
- Never invent a person, a legal entity id, or a value from anybody's record.

A copied settings description
- A request may be a description of settings copied from another company: sections and fields with their keys and every property, legal entities, locations and the rest. Reproduce it exactly, in its order: the same keys, labels, types, choices, requiredness and conditions, who fills each field in and who sees it, when it is asked, help text and protection. Add what is missing here and edit what differs; leave alone what already matches.`;

/** The settings as the model is shown them: metadata only. */
export function planningContext(
  snapshot: SettingsSnapshot,
  request: string,
): Record<string, unknown> {
  const published = new Set(snapshot.published?.fieldKeys ?? []);
  return {
    request,
    settings: {
      publishedVersion: snapshot.published?.version ?? null,
      sections: snapshot.sections.map((s) => ({
        key: s.key,
        label: s.label,
        origin: s.origin,
        fields: snapshot.fields
          .filter((f) => f.sectionKey === s.key)
          .map((f) => {
            const spec = specOf(f);
            return {
              key: f.key,
              label: spec.label,
              dataType: spec.dataType,
              ...(spec.options?.length ? { options: spec.options } : {}),
              ...(spec.country ? { country: spec.country } : {}),
              ...(spec.scheme ? { scheme: spec.scheme } : {}),
              requiredness: spec.requiredness,
              ...(spec.requiredWhen ? { requiredWhen: spec.requiredWhen } : {}),
              ownership: spec.ownership,
              visibility: spec.visibility,
              collectAt: spec.collectAt,
              ...(spec.description ? { description: spec.description } : {}),
              classification: spec.classification,
              piiKind: spec.piiKind,
              origin: f.origin,
              published: published.has(f.key),
            };
          }),
      })),
      organisation: {
        defaultTimeZone: snapshot.organisation.defaultTimeZone,
        cohortMinimum: snapshot.organisation.cohortMinimum,
        legalEntities: snapshot.organisation.entities,
        locations: snapshot.organisation.locations,
      },
      countryPacks: PACK_COUNTRIES,
    },
  };
}

/* ------------------------------------------------------ copy as prompt -- */

export type PromptScope =
  | { readonly kind: 'everything' }
  | { readonly kind: 'fields' }
  | { readonly kind: 'section'; readonly key: string }
  | { readonly kind: 'field'; readonly key: string }
  | { readonly kind: 'organisation' }
  | { readonly kind: 'legal_entity'; readonly id: string }
  | { readonly kind: 'location'; readonly id: string }
  | { readonly kind: 'numbering'; readonly id: string }
  | { readonly kind: 'time_zone' }
  | { readonly kind: 'reminders' }
  | { readonly kind: 'country_pack'; readonly country: string }
  | { readonly kind: 'roles' }
  | { readonly kind: 'role'; readonly role: string };

const ROLE_NAMES: Readonly<Record<string, string>> = {
  hr: 'HR',
  finance: 'finance',
  people_admin: 'People administrator',
};

const ordinal = (n: number, of: number): string => `position ${String(n)} of ${String(of)}`;
const code = (s: string): string => `\`${s}\``;
const codes = (xs: readonly string[]): string => xs.map(code).join(', ');
const quoted = (s: string): string => JSON.stringify(s);

function condition(
  when: RequirednessPredicate,
  entities: SettingsSnapshot['organisation']['entities'],
): string {
  const clauses = when.clauses.map((c) => {
    switch (c.operand) {
      case 'attribute':
        return c.is === 'set'
          ? `field ${code(c.key)} is filled in`
          : `field ${code(c.key)} equals ${code(c.equals ?? '')}`;
      case 'legalEntity':
        return `legal entity is one of ${c.in
          .map((id) => quoted(entities.find((e) => e.id === id)?.name ?? id))
          .join(', ')}`;
      default:
        return `${c.operand} is one of ${codes(c.in)}`;
    }
  });
  return `${when.combine === 'any' ? 'any' : 'all'} of these hold: ${clauses.join('; ')}`;
}

function fieldLines(
  f: FieldSpec,
  entities: SettingsSnapshot['organisation']['entities'],
): string[] {
  const type =
    f.dataType === 'national_id'
      ? `${code(f.dataType)}, country ${f.country ?? '?'}, scheme ${code(f.scheme ?? '')}`
      : f.dataType === 'bank_account'
        ? `${code(f.dataType)}, country ${f.country ?? '?'}`
        : code(f.dataType);
  const required =
    f.requiredness === 'always'
      ? 'always'
      : f.requiredness === 'conditional' && f.requiredWhen
        ? `when ${condition(f.requiredWhen, entities)}`
        : 'never (optional)';
  return [
    `- Type: ${type}.`,
    ...(f.options?.length ? [`- Choices, in order: ${f.options.map(quoted).join(', ')}.`] : []),
    `- Required: ${required}.`,
    `- Filled in by: ${codes(f.ownership)}.`,
    `- Seen by: ${f.visibility.length === 0 ? 'nobody individually' : codes(f.visibility)}.`,
    ...(f.visibilityRules ?? []).map(
      (r) => `- Also seen by ${codes(r.scopes)} when ${condition(r.when, entities)}.`,
    ),
    `- Asked: ${code(f.collectAt)}.`,
    `- Help text: ${f.description ? quoted(f.description) : 'none'}.`,
    `- Protection: classification ${code(f.classification)}, personal data kind ${code(f.piiKind)}.`,
    `- Stored encrypted: ${f.encrypted === true ? 'yes' : 'no'}. The AI assistant may use it: ${f.aiEligible === true ? 'yes' : 'no'}.`,
  ];
}

function fieldBlock(
  a: AttributeDefinition,
  s: SettingsSnapshot,
  position: string,
  indent = '',
): string[] {
  const f = specOf(a);
  return [
    `${indent}Field ${quoted(f.label)} (key ${code(a.key)}), ${position}${a.origin === 'tenant' ? '' : a.origin === 'core' ? ', shipped with People' : ', from a country pack'}:`,
    ...fieldLines(f, s.organisation.entities).map((l) => `${indent}${l}`),
  ];
}

function sectionBlock(s: SettingsSnapshot, key: string): string[] {
  const index = s.sections.findIndex((x) => x.key === key);
  const section = s.sections[index];
  if (section === undefined) return [];
  const fields = s.fields.filter((f) => f.sectionKey === key);
  return [
    `Section ${quoted(section.label)} (key ${code(section.key)}), ${ordinal(index + 1, s.sections.length)} among the sections. Its fields, in this order:`,
    ...(fields.length === 0 ? ['(none)'] : []),
    ...fields.flatMap((f, i) => [
      '',
      ...fieldBlock(f, s, `${String(i + 1)} of ${String(fields.length)}`, '  '),
    ]),
  ];
}

function entityLine(e: SettingsSnapshot['organisation']['entities'][number]): string {
  return `Legal entity ${quoted(e.name)}: country ${e.country}, default time zone ${e.timeZone}.`;
}

function numberingLine(e: SettingsSnapshot['organisation']['entities'][number]): string | null {
  return e.numbering === null
    ? null
    : `Employee numbering for the legal entity ${quoted(e.name)}: prefix ${quoted(e.numbering.prefix)}, ${String(e.numbering.digits)} digits, starting at ${String(e.numbering.next)}.`;
}

function locationLine(
  s: SettingsSnapshot,
  l: SettingsSnapshot['organisation']['locations'][number],
): string {
  const entity =
    s.organisation.entities.find((e) => e.id === l.legalEntityId)?.name ?? l.legalEntityId;
  return `Work location ${quoted(l.name)} in the legal entity ${quoted(entity)}: country ${l.country}, time zone ${l.timeZone}.`;
}

const zoneLine = (s: SettingsSnapshot): string =>
  `The company’s default time zone is ${s.organisation.defaultTimeZone}.`;
const remindersLine = (s: SettingsSnapshot): string =>
  `Completeness and reporting: reports describe no group smaller than ${String(s.organisation.cohortMinimum)} people.`;
const packLine = (country: string): string =>
  `Add the ${country} country pack (its identifiers and fields) to the employee fields.`;
const roleLine = (role: string): string =>
  `Give the ${ROLE_NAMES[role] ?? role} role to [the person who should hold it].`;

/** Which country packs a draft holds: those with a field the pack ships. */
export function packsIn(s: SettingsSnapshot): string[] {
  return PACK_COUNTRIES.filter((c) =>
    s.fields.some((f) => f.origin === 'country_pack' && f.key.startsWith(`${c.toLowerCase()}_`)),
  );
}

function organisationLines(s: SettingsSnapshot): string[] {
  return [
    zoneLine(s),
    ...s.organisation.entities.flatMap((e) => [
      entityLine(e),
      ...(numberingLine(e) === null ? [] : [numberingLine(e) as string]),
    ]),
    ...s.organisation.locations.map((l) => locationLine(s, l)),
  ];
}

const FIELDS_OPENING =
  'Set up the employee fields exactly as described below: these sections, in this order, each with its fields in order. Keep the keys as written.';

/** One setting, or a whole area, or everything, as a request the planner rebuilds it from. Null when it is not there. */
export function settingsPrompt(s: SettingsSnapshot, scope: PromptScope): string | null {
  const lines = ((): string[] | null => {
    switch (scope.kind) {
      case 'field': {
        const a = s.fields.find((f) => f.key === scope.key);
        if (!a) return null;
        const siblings = s.fields.filter((f) => f.sectionKey === a.sectionKey);
        const section = s.sections.find((x) => x.key === a.sectionKey);
        return [
          'In the employee fields, set up this field exactly as described. Keep the key as written.',
          '',
          `In the section ${quoted(section?.label ?? a.sectionKey)} (key ${code(a.sectionKey)}):`,
          ...fieldBlock(
            a,
            s,
            `${String(siblings.indexOf(a) + 1)} of ${String(siblings.length)} in that section`,
          ),
        ];
      }
      case 'section': {
        const block = sectionBlock(s, scope.key);
        return block.length === 0
          ? null
          : [
              'In the employee fields, set up this section and its fields exactly as described. Keep the keys as written.',
              '',
              ...block,
            ];
      }
      case 'fields':
        return [FIELDS_OPENING, ...s.sections.flatMap((x) => ['', ...sectionBlock(s, x.key)])];
      case 'organisation':
        return ['Set up the organisation exactly as follows.', '', ...organisationLines(s)];
      case 'legal_entity': {
        const e = s.organisation.entities.find((x) => x.id === scope.id);
        return e ? [entityLine(e)] : null;
      }
      case 'numbering': {
        const e = s.organisation.entities.find((x) => x.id === scope.id);
        const line = e ? numberingLine(e) : null;
        return line === null ? null : [line];
      }
      case 'location': {
        const l = s.organisation.locations.find((x) => x.id === scope.id);
        return l ? [locationLine(s, l)] : null;
      }
      case 'time_zone':
        return [zoneLine(s)];
      case 'reminders':
        return [remindersLine(s)];
      case 'country_pack':
        return (PACK_COUNTRIES as readonly string[]).includes(scope.country)
          ? [packLine(scope.country)]
          : null;
      case 'role':
        return ROLE_NAMES[scope.role] === undefined ? null : [roleLine(scope.role)];
      case 'roles':
        return [
          'Roles are given to people by name, so they are not copied. Grant them on the roles page, or name the people here:',
          ...Object.keys(ROLE_NAMES).map(roleLine),
        ];
      case 'everything':
        return [
          'Set up these People settings exactly as described below.',
          '',
          'Country packs:',
          ...(packsIn(s).length === 0 ? ['(none)'] : packsIn(s).map(packLine)),
          '',
          'Organisation:',
          ...organisationLines(s),
          remindersLine(s),
          '',
          `Employee fields. ${FIELDS_OPENING}`,
          ...s.sections.flatMap((x) => ['', ...sectionBlock(s, x.key)]),
        ];
    }
  })();
  return lines === null ? null : `${lines.join('\n')}\n`;
}
