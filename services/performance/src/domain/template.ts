import type { FormActivity, FormDefinition, TemplateVersionState } from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';
import { fingerprint, normalise, validateDefinition } from '@kithena/form-kit';

/**
 * A form template and its versions (PRD §11.7, PRF-027): published versions
 * are immutable, a cycle pins the one it launched with, and at most one draft
 * and one published version exist at a time.
 */

export interface TemplateVersion {
  readonly version: number;
  readonly state: TemplateVersionState;
  readonly definition: FormDefinition;
  readonly fingerprint: string;
  readonly by: string;
  readonly at: string;
  readonly publishedAt: string | null;
}

export interface Template {
  readonly id: string;
  readonly name: string;
  /** What it is used for: review kinds, feedback, quizzes. */
  readonly purpose: readonly FormActivity[];
  readonly archived: boolean;
  readonly versions: readonly TemplateVersion[];
  readonly createdBy: string;
  readonly updatedAt: string;
  /** Every version any cycle ever used: once one has, the template can only be archived. */
  readonly everUsed: boolean;
}

export const published = (t: Template): TemplateVersion | undefined =>
  t.versions.find((v) => v.state === 'published');
export const draftOf = (t: Template): TemplateVersion | undefined =>
  t.versions.find((v) => v.state === 'draft');
/** The version the builder shows: the draft, else the published one, else the newest. */
export const current = (t: Template): TemplateVersion | undefined =>
  draftOf(t) ?? published(t) ?? t.versions.at(-1);

const purposeOf = (t: Pick<Template, 'purpose'>): 'feedback' | 'quiz' | 'review' =>
  t.purpose.includes('feedback') ? 'feedback' : t.purpose.includes('quiz') ? 'quiz' : 'review';

/** A new template, its first version a draft. */
export function createTemplate(input: {
  readonly id: string;
  readonly name: string;
  readonly purpose: readonly FormActivity[];
  readonly definition: FormDefinition;
  readonly by: string;
  readonly at: string;
}): Result<Template> {
  const def = normalise(input.definition).definition;
  const valid = validateDefinition(def, { purpose: purposeOf(input) });
  if (!valid.ok) return valid;
  return ok({
    id: input.id,
    name: input.name,
    purpose: input.purpose,
    archived: false,
    everUsed: false,
    createdBy: input.by,
    updatedAt: input.at,
    versions: [
      {
        version: 1,
        state: 'draft',
        definition: def,
        fingerprint: fingerprint(def),
        by: input.by,
        at: input.at,
        publishedAt: null,
      },
    ],
  });
}

/**
 * An edit: into the draft, or a new draft copied from the published version
 * when there is none (§11.7). Empty sections go, and the caller says so.
 */
export function editDraft(
  t: Template,
  change: {
    readonly name?: string;
    readonly purpose?: readonly FormActivity[];
    readonly definition: FormDefinition;
    readonly by: string;
    readonly at: string;
  },
): Result<{ readonly template: Template; readonly removed: readonly string[] }> {
  if (t.archived) return err(failure('ARCHIVED', 'Unarchive the template to edit it'));
  const { definition, removed } = normalise(change.definition);
  const purpose = change.purpose ?? t.purpose;
  const valid = validateDefinition(definition, { purpose: purposeOf({ purpose }) });
  if (!valid.ok) return valid;
  const draft = draftOf(t);
  const next: TemplateVersion = {
    version: draft?.version ?? Math.max(0, ...t.versions.map((v) => v.version)) + 1,
    state: 'draft',
    definition,
    fingerprint: fingerprint(definition),
    by: change.by,
    at: change.at,
    publishedAt: null,
  };
  return ok({
    removed,
    template: {
      ...t,
      name: change.name ?? t.name,
      purpose,
      updatedAt: change.at,
      versions: [...t.versions.filter((v) => v.state !== 'draft'), next],
    },
  });
}

/** The draft becomes the published version, the old one superseded (§11.7). */
export function publish(t: Template, at: string): Result<Template> {
  const draft = draftOf(t);
  if (draft === undefined) return err(failure('NO_DRAFT', 'There is no draft to publish'));
  if (t.archived) return err(failure('ARCHIVED', 'Unarchive the template to publish it'));
  const valid = validateDefinition(draft.definition, { purpose: purposeOf(t) });
  if (!valid.ok) return valid;
  const questions = draft.definition.sections.reduce((n, s) => n + s.questions.length, 0);
  if (questions === 0) return err(failure('EMPTY', 'A template needs at least one question'));
  return ok({
    ...t,
    updatedAt: at,
    versions: t.versions.map((v) =>
      v.state === 'draft'
        ? { ...v, state: 'published', publishedAt: at }
        : v.state === 'published'
          ? { ...v, state: 'superseded' }
          : v,
    ),
  });
}

/** Delete only a template no cycle ever used (§11.8); otherwise archive. */
export function mayDelete(t: Template): Result<true> {
  return t.everUsed
    ? err(failure('IN_USE', 'A cycle has used this template, so it can only be archived'))
    : ok(true);
}

export function version(t: Template, n: number): TemplateVersion | undefined {
  return t.versions.find((v) => v.version === n);
}
