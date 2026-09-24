import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildASTSchema, parse, validate } from 'graphql';

import { OPERATIONS } from '../../web/src/lib/people-operations.ts';

/**
 * The router's safelist, generated from the tenant app's operations (PEO-113).
 *
 * One `persisted/operations/<sha256>.json` per operation, `{ version: 1, body }`,
 * which is what the router's file-system storage provider reads (`config.yaml`,
 * `persisted_operations.storage`). The hash is of the document exactly as the
 * shell sends it. Every operation is validated against People's schema first,
 * so a stale one fails here rather than as a refusal in production.
 *
 * `--check` writes nothing and fails when the files are not what this would
 * write: `pnpm test` runs it, so an operation added without regenerating fails
 * the build rather than the router.
 */

const HERE = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(HERE, 'persisted/operations');
const SDL = join(HERE, '../../services/people/schemas/people.graphql');

const schema = buildASTSchema(parse(await readFile(SDL, 'utf8')), { assumeValidSDL: true });

const wanted = new Map<string, string>();
const problems: string[] = [];
for (const [name, body] of Object.entries(OPERATIONS)) {
  const errors = validate(schema, parse(body));
  if (errors.length > 0) problems.push(`${name}: ${errors.map((e) => e.message).join('; ')}`);
  const hash = createHash('sha256').update(body).digest('hex');
  wanted.set(`${hash}.json`, `${JSON.stringify({ version: 1, body })}\n`);
}
if (problems.length > 0) {
  console.error(`Operations People's schema refuses:\n${problems.join('\n')}`);
  process.exit(1);
}

await mkdir(OUT, { recursive: true });
const present = new Set((await readdir(OUT)).filter((f) => f.endsWith('.json')));

if (process.argv.includes('--check')) {
  const stale: string[] = [];
  for (const [file, content] of wanted) {
    const on = present.has(file) ? await readFile(join(OUT, file), 'utf8') : null;
    if (on !== content) stale.push(`missing or changed: ${file}`);
  }
  for (const file of present) if (!wanted.has(file)) stale.push(`not an operation: ${file}`);
  if (stale.length > 0) {
    console.error(
      `apps/gateway/persisted is out of date; run pnpm --filter @kithena/gateway persist\n${stale.join('\n')}`,
    );
    process.exit(1);
  }
  console.log(`${String(wanted.size)} persisted operations, up to date`);
} else {
  for (const file of present) if (!wanted.has(file)) await rm(join(OUT, file));
  for (const [file, content] of wanted) await writeFile(join(OUT, file), content);
  console.log(`${String(wanted.size)} persisted operations written`);
}
