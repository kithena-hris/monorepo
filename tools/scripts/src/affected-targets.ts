/**
 * Which deploy targets a commit actually changes, per environment.
 *
 * The Vercel Hobby plan allows 100 deployments a day, and shipping every
 * project on every merge spent that by lunchtime. So each deploy workflow asks
 * this first and runs only the steps whose target is affected.
 *
 * "Affected" is measured against what the environment is running, not against
 * the previous commit: a lightweight tag `deployed/<env>/<target>` is moved to
 * the commit a target last shipped successfully from. A failed deploy moves no
 * tag, so the next run still sees the change; a target skipped for a run keeps
 * its older tag, so nothing it missed is lost. No tag means never deployed,
 * and that deploys.
 *
 * The diff is `git diff base head`, both ends' trees. Turbo's own `[a...b]`
 * filter diffs from the merge base, which is wrong for staging: that
 * environment is deployed from whichever pull request went green last, so the
 * commit it runs is often on another branch, and undoing that branch's change
 * is a change. Turbo is asked only for the graph — which workspace packages
 * depend on the ones a file belongs to — so a change to `packages/ui` reaches
 * every app that renders it.
 *
 * Usage (the workflows call it like this; locally it only reads):
 *
 *     pnpm exec tsx tools/scripts/src/affected-targets.ts --env production --head <sha> \
 *       [--base <sha>] [--force all|identity,messaging]
 *
 * Prints one line per target with its reason, and writes `<target>=true|false`,
 * `vm`, `any` and `targets` to `$GITHUB_OUTPUT` when that is set.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const TARGETS = {
  shell: { packages: ['@kithena/web'] },
  auth: { packages: ['@kithena/auth-shell'] },
  admin: { packages: ['@kithena/admin'] },
  identity: { packages: ['@kithena/identity'] },
  messaging: { packages: ['@kithena/messaging'] },
  docs: { packages: ['@reach/docs'] },
  storybook: { packages: ['@reach/storybook'] },
  'people-remote': { packages: ['@kithena/web-people'] },
  // The image is People plus the Compose files that run it on the VM.
  people: { packages: ['@kithena/people'], paths: [/^deploy\/vm\//u] },
  // The router image bakes in the supergraph, composed from People's schema,
  // and `apps/gateway` holds its config and the persisted operations.
  router: {
    packages: ['@kithena/gateway'],
    paths: [/^deploy\/vm\//u, /^services\/people\/schemas\//u],
  },
  // Not a package: Atlas reads the directory and its config.
  migrations: { packages: [], paths: [/^migrations\//u, /^atlas\.hcl$/u], js: false },
} satisfies Record<string, { packages: string[]; paths?: RegExp[]; js?: boolean }>;

export type Target = keyof typeof TARGETS;
export type Env = 'production' | 'staging' | 'preview';

/** What each workflow ships. Staging has no Reach sites; previews have no VM and no remote. */
export const ENV_TARGETS: Record<Env, readonly Target[]> = {
  production: Object.keys(TARGETS) as Target[],
  staging: [
    'migrations',
    'people',
    'router',
    'people-remote',
    'shell',
    'identity',
    'messaging',
    'auth',
    'admin',
  ],
  preview: ['shell', 'admin', 'auth', 'identity', 'messaging', 'docs', 'storybook'],
};

/**
 * A change to any of these can change every JS build without touching a
 * package: the dependency tree, the workspace, the build graph, a patch, the
 * shared compiler settings.
 */
const EVERY_JS_BUILD =
  /^(pnpm-lock\.yaml|pnpm-workspace\.yaml|package\.json|turbo\.json|\.npmrc|tsconfig\.base\.json|patches\/)/u;

const SELF = 'tools/scripts/src/affected-targets.ts';

export interface Change {
  readonly files: readonly string[];
  /** Workspace packages a changed file belongs to, and everything depending on them. */
  readonly packages: ReadonlySet<string>;
}

/** Why `target` must deploy in `env` given what changed since it last did, or `null` if it need not. */
export function reason(target: Target, env: Env, change: Change | null): string | null {
  if (change === null) return `never deployed to ${env}`;
  const spec: { packages: string[]; paths?: RegExp[]; js?: boolean } = TARGETS[target];
  const own = new Set([`.github/workflows/vercel-${env}.yml`, SELF]);
  for (const file of change.files) {
    if (own.has(file)) return `${file} changed`;
    if (spec.js !== false && EVERY_JS_BUILD.test(file)) return `${file} changed`;
    if (spec.paths?.some((p) => p.test(file))) return `${file} changed`;
  }
  const pkg = spec.packages.find((p) => change.packages.has(p));
  return pkg === undefined ? null : `${pkg} is affected`;
}

/** The workspace package owning each file: the longest package directory that contains it. */
export function owners(
  files: readonly string[],
  packages: readonly { name: string; path: string }[],
): Set<string> {
  const byDepth = packages.toSorted((a, b) => b.path.length - a.path.length);
  const found = new Set<string>();
  for (const file of files) {
    const pkg = byDepth.find((p) => file.startsWith(`${p.path}/`));
    if (pkg) found.add(pkg.name);
  }
  return found;
}

/** `all`, or a comma list of known targets. Throws on a name nobody deploys. */
export function parseForce(value: string, env: Env): Set<Target> {
  const names = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.includes('all')) return new Set(ENV_TARGETS[env]);
  for (const n of names) {
    if (!ENV_TARGETS[env].includes(n as Target)) {
      throw new Error(
        `unknown target "${n}" for ${env}; one of: all, ${ENV_TARGETS[env].join(', ')}`,
      );
    }
  }
  return new Set(names as Target[]);
}

// ---- the I/O half: git and turbo -------------------------------------------

const run = (cmd: string, args: string[]): string =>
  execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 64 << 20,
  });

const turboLs = (filters: string[]): { name: string; path: string }[] =>
  (
    JSON.parse(
      run('pnpm', ['exec', 'turbo', 'ls', '--output=json', ...filters.map((f) => `--filter=${f}`)]),
    ) as { packages: { items: { name: string; path: string }[] } }
  ).packages.items;

function tagged(env: Env, target: Target): string | null {
  try {
    return run('git', [
      'rev-parse',
      '--quiet',
      '--verify',
      `refs/tags/deployed/${env}/${target}^{commit}`,
    ]).trim();
  } catch {
    return null;
  }
}

function changeBetween(
  base: string,
  head: string,
  workspace: { name: string; path: string }[],
): Change | null {
  let files: string[];
  try {
    files = run('git', ['diff', '--name-only', base, head]).split('\n').filter(Boolean);
  } catch {
    return null; // the marked commit is not in this clone: deploy rather than guess
  }
  const roots = [...owners(files, workspace)];
  const packages = new Set(
    roots.length === 0 ? [] : turboLs(roots.map((r) => `...${r}`)).map((p) => p.name),
  );
  return { files, packages };
}

export function plan(
  env: Env,
  head: string,
  opts: { base?: string; force?: Set<Target>; only?: boolean },
): Map<Target, string | null> {
  const workspace = turboLs([]);
  const cache = new Map<string, Change | null>();
  const result = new Map<Target, string | null>();
  for (const target of ENV_TARGETS[env]) {
    if (opts.force?.has(target)) {
      result.set(target, 'forced');
      continue;
    }
    // A hand-picked deploy: what was asked for and nothing it did not name.
    if (opts.only === true) {
      result.set(target, null);
      continue;
    }
    const base = opts.base ?? tagged(env, target);
    if (base !== null && !cache.has(base)) cache.set(base, changeBetween(base, head, workspace));
    result.set(target, reason(target, env, base === null ? null : (cache.get(base) ?? null)));
  }
  return result;
}

function main(argv: string[]): void {
  const arg = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  const env = arg('env') as Env | undefined;
  const head = arg('head');
  if (!env || !(env in ENV_TARGETS) || !head) {
    throw new Error(
      'usage: affected-targets --env production|staging|preview --head <sha> [--base <sha>] [--force all|a,b] [--only]',
    );
  }
  const base = arg('base');
  const force = parseForce(arg('force') ?? '', env);
  const only = argv.includes('--only');
  const decided = plan(env, head, { ...(base ? { base } : {}), force, only });

  const lines: string[] = [];
  const chosen: Target[] = [];
  for (const [target, why] of decided) {
    console.log(`${why ? 'deploy' : 'skip  '} ${target.padEnd(14)} ${why ?? 'unchanged'}`);
    lines.push(`${target}=${String(why !== null)}`);
    if (why !== null) chosen.push(target);
  }
  const vm = chosen.some((t) => t === 'people' || t === 'router' || t === 'migrations');
  lines.push(`vm=${String(vm)}`, `any=${String(chosen.length > 0)}`, `targets=${chosen.join(',')}`);
  const out = process.env['GITHUB_OUTPUT'];
  if (out) appendFileSync(out, `${lines.join('\n')}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
