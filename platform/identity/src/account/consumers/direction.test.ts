import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * People publishes, identity consumes — and neither reaches into the other's
 * tables to shortcut that. `docs/people-prd.md` §5.
 *
 * Checked twice, because either half alone can be bypassed: the source is what
 * a developer writes, the grants are what a support session or a script run as
 * the service role can do. dependency-cruiser already forbids the imports; this
 * forbids the SQL and the Drizzle table a hand-written query would use instead.
 */

const root = fileURLToPath(new URL('../../../../../', import.meta.url));

/** Identity's tables, which People holds no copy of and may not read. */
const IDENTITY_TABLE =
  /pgSchema\(\s*['"]platform['"]\s*\)|\bplatform\.(?:identity|account|credential|session|enrolment_token|handoff_code|webauthn_challenge)\b(?!\.)/;

/** People's tables. `(?!\.)` so an event name like `people.person.hired` is not one. */
const PEOPLE_TABLE =
  /pgSchema\(\s*['"]people['"]\s*\)|\bpeople\.(?:person|person_attribute_history|person_secret|attribute_unique|section|attribute_definition|schema_version|outbox)\b(?!\.)/;

/** Production source, comments removed: prose explaining the rule is not a breach of it. */
function sourcesUnder(dir: string): Array<[string, string]> {
  return readdirSync(join(root, dir), { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f): [string, string] => [
      join(dir, f),
      readFileSync(join(root, dir, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1'),
    ]);
}

/** Every `GRANT … TO role` in the migrations, as [what, role]. */
function grants(): Array<[string, string]> {
  const dir = join(root, 'migrations');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .flatMap((f) =>
      [...readFileSync(join(dir, f), 'utf8').replace(/--.*$/gm, '').matchAll(/GRANT\s+([\s\S]*?)\s+TO\s+(\w+)/gi)].map(
        (m): [string, string] => [m[1] ?? '', m[2] ?? ''],
      ),
    );
}

describe('people never reads an identity table', () => {
  it.each(sourcesUnder('services/people/src'))('%s', (_path, source) => {
    expect(source).not.toMatch(IDENTITY_TABLE);
  });

  it('svc_people holds no privilege in the platform schema', () => {
    const all = grants().filter(([, role]) => role === 'svc_people');
    expect(all.length, 'the parser found none of its grants').toBeGreaterThan(0);
    const held = all.filter(([what]) => /\bplatform\b/.test(what));
    expect(held).toEqual([]);
  });
});

describe('identity never writes a people table', () => {
  // Stronger than the rule needs: identity neither writes nor reads them. What it
  // knows about a person arrives on the topic.
  it.each(sourcesUnder('platform/identity/src'))('%s', (_path, source) => {
    expect(source).not.toMatch(PEOPLE_TABLE);
  });

  it('svc_identity holds no privilege in the people schema', () => {
    const all = grants().filter(([, role]) => role === 'svc_identity');
    expect(all.length, 'the parser found none of its grants').toBeGreaterThan(0);
    const held = all.filter(([what]) => /\bpeople\b/.test(what));
    expect(held).toEqual([]);
  });
});

describe('the patterns catch what they are for', () => {
  // A regex that matches nothing passes every file. These are the breaches it exists to refuse.
  it.each([
    [IDENTITY_TABLE, "const platform = pgSchema('platform');"],
    [IDENTITY_TABLE, 'SELECT given_name FROM platform.account WHERE id = $1'],
    [PEOPLE_TABLE, "const people = pgSchema('people');"],
    [PEOPLE_TABLE, 'UPDATE people.person SET hire_date = $1'],
  ])('%s refuses %s', (pattern, breach) => {
    expect(breach).toMatch(pattern);
  });

  it('lets an event name through', () => {
    expect("consumes: ['people.person.hired', 'people.person.profile_updated']").not.toMatch(PEOPLE_TABLE);
  });
});
