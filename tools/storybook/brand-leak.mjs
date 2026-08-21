/**
 * Brand leak check for the public Reach documentation.
 *
 * Reach is sold and documented on its own, and `CLAUDE.md` states the rule
 * plainly: the design system must never learn that Kithena exists. Storybook
 * already enforces its half — `.storybook/main.ts` excludes `*.kithena.stories`
 * with an extglob so the mark, its construction grid and its clear-space rules
 * stay off a public URL. The documentation site had no equivalent, and a demo
 * shipped a `https://kithena.example/...` share link to production.
 *
 * A naming rule that depends on nobody typing the name is not a rule. This is
 * the missing half.
 *
 * Scope is deliberately `apps/docs/src` only. `packages/ui/src/brand` holds
 * both marks by design — a mark is presentation and nothing else — and
 * `packages/ui` exports their prop types, which is a decision already taken
 * rather than a leak to catch here.
 *
 * Usage: `pnpm docs:brand-leak`.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const docsSource = join(repoRoot, 'apps/docs/src');

/**
 * The product name, and the package scope that only Kithena services use.
 * `@kithena/*` appearing in the design system's documentation would mean the docs
 * had reached for a domain type, which is the same boundary stated a different
 * way.
 */
const FORBIDDEN = [
  { pattern: /kithena/i, what: 'the product name' },
  { pattern: /@kithena\//, what: 'a Kithena package scope' },
];

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* sourceFiles(full);
    } else if (/\.(ts|tsx|css|json|md|mdx|html)$/.test(entry)) {
      yield full;
    }
  }
}

const findings = [];
let scanned = 0;

for (const file of sourceFiles(docsSource)) {
  scanned += 1;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    for (const { pattern, what } of FORBIDDEN) {
      if (pattern.test(line)) {
        findings.push({
          file: relative(repoRoot, file),
          line: index + 1,
          what,
          text: line.trim().slice(0, 100),
        });
      }
    }
  });
}

// A check that matched no files is not a passing check. If the directory moves,
// the loop above finds nothing and reports success for the wrong reason.
if (scanned === 0) {
  console.error(`No files scanned under ${relative(repoRoot, docsSource)}. Has the path moved?`);
  process.exit(1);
}

if (findings.length > 0) {
  console.error('\nThe Reach documentation names Kithena:\n');
  for (const found of findings) {
    console.error(`   ${found.file}:${found.line}  (${found.what})`);
    console.error(`      ${found.text}`);
  }
  console.error(
    '\nThis site is public and is the design system on its own. Use an\n' +
      'unbranded example instead. The marks live in packages/ui/src/brand and\n' +
      'belong on a Kithena surface — apps/admin or apps/web.\n',
  );
  process.exit(1);
}

console.log(`no brand leaks in ${String(scanned)} documentation files`);
