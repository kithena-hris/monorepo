import { Alert, Badge, KithenaMark } from '@reach/ui';
import type { JSX } from 'react';

/** Placeholder shell. Same design system as the product, deliberately. */
export default function Home(): JSX.Element {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Badge tone="warning">Internal</Badge>
      <h1 className="mt-4 flex items-center gap-2 text-2xl font-semibold text-fg">
        {/* Mark without the wordmark: the heading already says the name, and
            the lockup beside it would say it twice. */}
        <KithenaMark className="size-7 text-accent" />
        Kithena Back-office
      </h1>
      <Alert className="mt-6" tone="info" title="Nothing mounted yet">
        Dead-letter replay, tenant resync, entitlement inspection and per-tenant health land here.
      </Alert>
    </main>
  );
}
