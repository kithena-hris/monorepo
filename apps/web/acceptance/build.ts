import { generateKeyPairSync } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';

import { ROOT, run } from './stack';

/**
 * The production builds every acceptance file runs, made once per run rather
 * than once per file: the two remotes, each server build signed as its deploy
 * pipeline signs it, and the shell. All three at once; nothing in one depends
 * on another, and the shell reads every address and key at start, not at build.
 *
 * Each file still starts its own stack (`startStack`), so no test sees
 * another file's data; only the builds are shared. The public halves reach
 * the stacks through `provide`, as `remoteKeys`.
 */

declare module 'vitest' {
  export interface ProvidedContext {
    /** Each remote's SSR public key, DER SPKI in base64, keyed by its env prefix. */
    remoteKeys: { PEOPLE: string; TIMEOFF: string };
  }
}

async function remote(name: 'people' | 'timeoff', env: 'PEOPLE' | 'TIMEOFF'): Promise<string> {
  const signing = generateKeyPairSync('ed25519');
  await run('pnpm', ['--filter', `@kithena/web-${name}`, 'build'], ROOT, 300_000);
  await run('pnpm', ['--filter', `@kithena/web-${name}`, 'sign'], ROOT, 30_000, {
    [`${env}_REMOTE_SSR_SIGNING_KEY`]: signing.privateKey
      .export({ format: 'der', type: 'pkcs8' })
      .toString('base64'),
  });
  return signing.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
}

async function shell(): Promise<void> {
  // The renderer process's bundle, which `next build` does not make.
  await run('node', ['scripts/build-renderer.mjs'], join(ROOT, 'apps/web'), 60_000);
  if (process.env['ACCEPTANCE_SKIP_SHELL_BUILD'] === '1') return;
  // `next build` rewrites `next-env.d.ts` for a production build; a test run
  // leaves the checkout as it found it.
  const nextEnv = join(ROOT, 'apps/web/next-env.d.ts');
  const committed = await readFile(nextEnv, 'utf8');
  try {
    await run(
      join(ROOT, 'apps/web/node_modules/.bin/next'),
      ['build'],
      join(ROOT, 'apps/web'),
      420_000,
    );
  } finally {
    await writeFile(nextEnv, committed);
  }
}

export default async function setup(project: TestProject): Promise<void> {
  const [PEOPLE, TIMEOFF] = await Promise.all([
    remote('people', 'PEOPLE'),
    remote('timeoff', 'TIMEOFF'),
    shell(),
  ]);
  project.provide('remoteKeys', { PEOPLE, TIMEOFF });
}
