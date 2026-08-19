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
      from: { path: '^(services|packages)/' },
      to: { path: 'node_modules/@trpc' },
    },
    {
      name: 'no-domain-importing-infrastructure',
      severity: 'error',
      comment: 'The domain layer stays free of drivers, clients and frameworks.',
      from: { path: '^services/[^/]+/src/domain/' },
      to: { path: '^services/[^/]+/src/(infrastructure|graphql|http)/' },
    },
    {
      name: 'design-system-stays-presentational',
      severity: 'error',
      comment:
        'packages/ui is presentation only. The moment it imports a contract, a ' +
        "domain type or a data client, one module's concepts start leaking into " +
        "every other module's screens and the system stops being shared.",
      from: { path: '^packages/ui/' },
      to: { path: '^(packages/(?!ui/)|services/)' },
    },
    {
      name: 'no-design-system-in-services',
      severity: 'error',
      comment:
        'A subgraph, a worker or a domain layer has no user interface. React in ' +
        'services/* means presentation logic has moved to the wrong side of the wire.',
      from: { path: '^(services|packages/(?!ui/))' },
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
          '^services/[^/]+/src/integration/',
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
