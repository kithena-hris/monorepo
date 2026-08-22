/**
 * Architectural boundaries. These rules are the anti-sticky guarantee.
 * A module that imports another module directly is a module you can no
 * longer sell on its own.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-cross-module-imports',
      severity: 'error',
      comment:
        'Modules communicate through events and packages/contracts only. ' +
        'If you need data from another module, consume its event or read ' +
        'its published contract.',
      from: { path: '^services/([^/]+)/' },
      to: { path: '^services/(?!$1/)([^/]+)/' },
    },
    {
      name: 'no-trpc-in-services',
      severity: 'error',
      comment: 'tRPC is permitted in apps/admin only. See section 5 of the stack doc.',
      from: { path: '^(services|packages|platform)/' },
      to: { path: 'node_modules/@trpc' },
    },
    {
      name: 'no-domain-importing-infrastructure',
      severity: 'error',
      comment:
        'The domain layer stays free of drivers, clients and frameworks. The ' +
        'optional path segment matters: with vertical slices the layer sits at ' +
        'src/<slice>/domain/, and a pattern anchored at src/domain/ simply stops ' +
        'matching. It would not fail — it would pass, on every file, silently, ' +
        'which is the worst thing a build gate can do.\n\n' +
        'Spelled as an alternation rather than an optional `(?:[^/]+/)?` group: ' +
        'dependency-cruiser runs safe-regex over every pattern and rejects one ' +
        'quantifier nested inside another, so the concise form is refused ' +
        'outright.',
      from: { path: '^(services|platform)/[^/]+/src/(?:domain|[^/]+/domain)/' },
      to: {
        path: '^(services|platform)/[^/]+/src/(?:application|infrastructure|graphql|http|[^/]+/(?:application|infrastructure|graphql|http))/',
      },
    },
    {
      name: 'no-cross-slice-imports',
      severity: 'error',
      comment:
        'A vertical slice reaches another slice through its own module surface, ' +
        'not by importing its internals. Same rule as no-cross-module-imports, ' +
        'one level down. Only fires where both sides are actually sliced — a ' +
        'module keeping its layers directly under src/ is unaffected, and ' +
        'src/shared/ is reachable from everywhere by design.',
      from: {
        path: '^(services|platform)/([^/]+)/src/([^/]+)/(domain|application|infrastructure|graphql|http)/',
      },
      to: {
        path: '^$1/$2/src/(?!$3/|shared/)([^/]+)/(domain|application|infrastructure|graphql|http)/',
      },
    },
    {
      name: 'no-platform-in-modules',
      severity: 'error',
      comment:
        'A module reaches identity through a JWKS URL and a verified token, ' +
        'never by importing it. The moment a subgraph calls the identity ' +
        'service, `just standalone <module>` stops being true and Time Off can ' +
        'no longer be sold to a customer pointing it at their own issuer.',
      from: { path: '^services/' },
      to: { path: '^platform/' },
    },
    {
      name: 'no-modules-in-platform',
      severity: 'error',
      comment:
        'Identity must not learn what a Person is. It consumes the People ' +
        'contract from packages/contracts and the events on the topic; it does ' +
        'not import the module, because a customer running Time Off against ' +
        'Workday has no People module for it to import.',
      from: { path: '^platform/' },
      to: { path: '^services/' },
    },
    {
      name: 'design-system-stays-presentational',
      severity: 'error',
      comment:
        'packages/ui is presentation only. The moment it imports a contract, a ' +
        "domain type or a data client, one module's concepts start leaking into " +
        "every other module's screens and the system stops being shared.",
      from: { path: '^packages/ui/' },
      to: { path: '^(packages/(?!ui/)|services/|platform/)' },
    },
    {
      name: 'no-design-system-in-services',
      severity: 'error',
      comment:
        'A subgraph, a worker or a domain layer has no user interface. React in ' +
        'services/* means presentation logic has moved to the wrong side of the wire.',
      from: { path: '^(services|platform|packages/(?!ui/))' },
      to: { path: '^packages/ui/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      comment:
        'An unreferenced module is usually code that was replaced and not deleted. ' +
        'The exceptions are files that emit no JavaScript, which cannot be dead ' +
        'code in the sense this rule is looking for.',
      severity: 'warn',
      from: {
        orphan: true,
        pathNot: [
          '\\.d\\.ts$',
          '(^|/)\\.[^/]+\\.(js|cjs|ts)$',
          /*
           * Framework configuration, loaded by a tool rather than imported by
           * a module. `modern.config.ts` is an entry point for the build, so
           * having nothing depend on it is the expected state and not the
           * "replaced and never deleted" this rule is looking for.
           *
           * `vitest.config.ts` needs no entry here: it imports from
           * `vitest/config`, which gives it an outgoing dependency and takes it
           * out of the rule's reach on its own.
           */
          '(^|/)modern\\.config\\.ts$',
          '(^|/)postcss\\.config\\.mjs$',
          /*
           * A module's ports: the interfaces an external provider is adapted
           * *to*, with no implementation in the tree yet.
           *
           * These are type-only, they compile to nothing, so an orphan here
           * means "no adapter has been written", not "this is dead". People
           * declares `requiresPeopleSource` and its adapter lands with the
           * first provider; Time Off is sold to customers running Workday and
           * reaches the People Graph through exactly this layer.
           *
           * Scoped to `src/integration/` and nowhere else, so an orphan in a
           * domain, application or infrastructure layer still warns. The
           * exclusion goes inert on its own the moment an adapter imports one
           * of these, because the file stops being an orphan.
           */
          '^(services|platform)/[^/]+/src/integration/',
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // Build output is not architecture. A bundler's chunk graph is circular by
    // construction and says nothing about how the source is layered.
    exclude: { path: '(^|/)(dist|\\.next|storybook-static|\\.turbo)/' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
  },
};
