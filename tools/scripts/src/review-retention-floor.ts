/**
 * Mark a statutory retention floor reviewed by counsel (PEO-126), as a change
 * somebody reads before it lands.
 *
 * The floors' review status lives in code
 * (`services/people/src/domain/retention/floors.ts`, `FLOOR_REVIEWS`) because
 * a floor is law, the same for every tenant. Until one is reviewed, People
 * refuses to erase automatically against it. So marking one reviewed is what
 * turns automated erasure on, and this script is the only sanctioned way to do
 * it: an operator runs it with the reviewer, the date and where the written
 * opinion is kept, and the resulting commit — authored, reviewed and merged —
 * is the audit record. Nothing in the running service can do this.
 *
 * It opens no connection and applies nothing. It rewrites one entry.
 *
 * Usage:
 *
 *     pnpm --filter @kithena/scripts review-retention-floor es-labour \
 *       --reviewer "Ana García, Bufete Ejemplo" --on 2026-10-01 --reference "opinion 2026/114"
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const FLOORS = ['es-labour', 'de-labour', 'eu-payroll'] as const;
export type Floor = (typeof FLOORS)[number];

export interface Review {
  readonly reviewer: string;
  readonly reviewedOn: string;
  readonly reference: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/u;

/** The source with one floor's entry replaced by a reviewed one. Throws on anything it cannot do exactly. */
export function markReviewed(source: string, floor: Floor, review: Review, today: string): string {
  for (const [name, value] of Object.entries(review)) {
    if (value.trim() === '') throw new Error(`--${name === 'reviewedOn' ? 'on' : name} is required`);
  }
  if (!DATE.test(review.reviewedOn) || Number.isNaN(Date.parse(review.reviewedOn))) {
    throw new Error('--on must be a calendar date, YYYY-MM-DD');
  }
  if (review.reviewedOn > today) throw new Error('--on cannot be in the future');

  const entry = new RegExp(`^  '${floor}': \\{[^{}]*\\},$`, 'mu');
  if (!entry.test(source)) throw new Error(`No entry for ${floor} in FLOOR_REVIEWS`);
  const q = (s: string): string => `'${s.trim().replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
  return source.replace(
    entry,
    [
      `  '${floor}': {`,
      `    status: 'reviewed',`,
      `    reviewer: ${q(review.reviewer)},`,
      `    reviewedOn: ${q(review.reviewedOn)},`,
      `    reference: ${q(review.reference)},`,
      `  },`,
    ].join('\n'),
  );
}

function arg(argv: readonly string[], name: string): string {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? '' : (argv[at + 1] ?? '');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const floor = argv[0] as Floor;
  if (!FLOORS.includes(floor)) {
    console.error(`Usage: review-retention-floor <${FLOORS.join('|')}> --reviewer <name> --on <YYYY-MM-DD> --reference <where the opinion is>`);
    process.exit(1);
  }
  const file = fileURLToPath(
    new URL('../../../services/people/src/domain/retention/floors.ts', import.meta.url),
  );
  try {
    const next = markReviewed(
      readFileSync(file, 'utf8'),
      floor,
      { reviewer: arg(argv, 'reviewer'), reviewedOn: arg(argv, 'on'), reference: arg(argv, 'reference') },
      new Date().toISOString().slice(0, 10),
    );
    writeFileSync(file, next);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  console.log(
    `Marked ${floor} reviewed in ${file}.\nCommit it on its own, naming the reviewer and the opinion, and open a PR: that commit is the audit record, and merging it enables automated erasure under ${floor}.`,
  );
}
