import type { JSX } from 'react';

/**
 * Nothing lives at the root of the auth origin.
 *
 * A person arrives here by being redirected from a tenant hostname, which
 * carries the tenant with it. Landing here without one is not a state worth
 * guessing about — there is no way to know which company was meant, and
 * inventing a tenant picker would publish the customer list.
 */
export default function Index(): JSX.Element {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-6">
      <h1 className="text-xl font-semibold">Sign in to Kithena</h1>
      <p className="text-fg-muted text-sm">
        Open the address your company gave you. It looks like{' '}
        <code className="text-fg">yourcompany.app.kithena.com</code>.
      </p>
    </main>
  );
}
