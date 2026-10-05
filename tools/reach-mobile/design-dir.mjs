import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/**
 * The design on disk: `$REACH_MOBILE_DESIGN`, else `.claude/design/reach-mobile`
 * in this checkout, else in the main checkout. It is untracked, so a worktree
 * usually has to borrow the main checkout's copy.
 */
export function designDir() {
  const candidates = [
    process.env['REACH_MOBILE_DESIGN'],
    join(repoRoot, '.claude/design/reach-mobile'),
  ];
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
    candidates.push(join(dirname(resolve(repoRoot, common)), '.claude/design/reach-mobile'));
  } catch {
    // Not a git checkout: the first two candidates are all there is.
  }
  const found = candidates.find((dir) => dir && existsSync(join(dir, 'ref/index.json')));
  if (!found) {
    console.error(
      'The Reach Mobile design is not on disk. Set REACH_MOBILE_DESIGN to the directory holding ref/index.json.',
    );
    process.exit(1);
  }
  return found;
}
