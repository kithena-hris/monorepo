import { describe, expect, it } from 'vitest';

import {
  ENV_TARGETS,
  owners,
  parseForce,
  reason,
  type Change,
  type Target,
} from './affected-targets.js';

const WORKSPACE = [
  { name: '@kithena/web', path: 'apps/web' },
  { name: '@kithena/web-people', path: 'apps/web/people' },
  { name: '@reach/ui', path: 'packages/ui' },
  { name: '@kithena/people', path: 'services/people' },
];

const change = (files: string[], packages: string[] = []): Change => ({
  files,
  packages: new Set(packages),
});
const chosen = (
  c: Change | null,
  env: 'production' | 'staging' | 'preview' = 'production',
): Target[] => ENV_TARGETS[env].filter((t) => reason(t, env, c) !== null);

describe('reason', () => {
  it('deploys every target that has never been deployed (no marker tag)', () => {
    expect(chosen(null)).toEqual(ENV_TARGETS.production);
    expect(reason('identity', 'staging', null)).toBe('never deployed to staging');
  });

  it('deploys nothing for a change outside every target', () => {
    expect(chosen(change(['docs/environments.md', 'README.md']))).toEqual([]);
  });

  it('follows the package graph: a design-system change reaches what renders it', () => {
    const ui = change(
      ['packages/ui/src/button.tsx'],
      [
        '@reach/ui',
        '@kithena/web',
        '@kithena/web-people',
        '@kithena/admin',
        '@kithena/auth-shell',
        '@reach/docs',
        '@reach/storybook',
      ],
    );
    expect(chosen(ui)).toEqual(['shell', 'auth', 'admin', 'docs', 'storybook', 'people-remote']);
  });

  it('ships a lockfile change to every JS target but not to migrations', () => {
    expect(chosen(change(['pnpm-lock.yaml']))).toEqual(
      ENV_TARGETS.production.filter((t) => t !== 'migrations'),
    );
  });

  it('runs migrations for a migration or atlas.hcl, and nothing else', () => {
    expect(chosen(change(['migrations/2026_x.sql', 'migrations/atlas.sum']))).toEqual([
      'migrations',
    ]);
    expect(chosen(change(['atlas.hcl']))).toEqual(['migrations']);
  });

  it('rebuilds both VM images when the Compose files change', () => {
    expect(chosen(change(['deploy/vm/compose.yaml']))).toEqual(['people', 'router']);
  });

  it("rebuilds the router for People's schema, not for the rest of People", () => {
    expect(chosen(change(['services/people/schemas/people.graphql'], ['@kithena/people']))).toEqual(
      ['people', 'router'],
    );
    expect(chosen(change(['services/people/src/x.ts'], ['@kithena/people']))).toEqual(['people']);
  });

  it("treats a change to the environment's own workflow as touching all of its targets", () => {
    expect(chosen(change(['.github/workflows/vercel-staging.yml']), 'staging')).toEqual(
      ENV_TARGETS.staging,
    );
    expect(chosen(change(['.github/workflows/vercel-staging.yml']), 'production')).toEqual([]);
    expect(chosen(change(['tools/scripts/src/affected-targets.ts']), 'preview')).toEqual(
      ENV_TARGETS.preview,
    );
  });
});

describe('owners', () => {
  it('attributes a file to the most specific package that contains it', () => {
    expect(owners(['apps/web/people/src/a.ts'], WORKSPACE)).toEqual(
      new Set(['@kithena/web-people']),
    );
    expect(owners(['apps/web/src/a.ts', 'packages/ui/x', 'docs/a.md'], WORKSPACE)).toEqual(
      new Set(['@kithena/web', '@reach/ui']),
    );
    // A sibling directory sharing a prefix is not inside the package.
    expect(owners(['apps/webhooks/a.ts'], WORKSPACE)).toEqual(new Set());
  });
});

describe('parseForce', () => {
  it('expands all to the environment', () => {
    expect(parseForce('all', 'staging')).toEqual(new Set(ENV_TARGETS.staging));
  });
  it('accepts a comma list and refuses a name the environment does not deploy', () => {
    expect(parseForce(' identity, messaging ', 'production')).toEqual(
      new Set(['identity', 'messaging']),
    );
    expect(parseForce('', 'production')).toEqual(new Set());
    expect(() => parseForce('docs', 'staging')).toThrow(/unknown target "docs"/u);
  });
});
