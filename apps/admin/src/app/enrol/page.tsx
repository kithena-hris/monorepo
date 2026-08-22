import type { JSX } from 'react';

import { EnrolButton } from '../../components/enrol-button';

/**
 * Registering an operator's passkey.
 *
 * Reachable without a session, because an operator has none until this
 * succeeds. What guards it is on the other side: the identity service refuses
 * unless the identity named here already has an operator row awaiting a
 * credential, and rows are written by hand.
 *
 * The identity is in the query string rather than looked up, deliberately. A
 * screen that found "the invited operator" would be correct while there is
 * exactly one and silently wrong the moment there are two — the same mistake
 * that was rewritten out of the ceremony wiring before it shipped.
 */
export default async function Enrol({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const identity = (await searchParams)['identity'];
  const identityId = typeof identity === 'string' ? identity : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-xl font-semibold">Set up your operator passkey</h1>
        <p className="text-fg-muted mt-1 text-sm">
          This is the back-office. The passkey is separate from any you hold for a company account,
          and your browser will only offer it here.
        </p>
      </div>
      <EnrolButton identityId={identityId} />
    </main>
  );
}
