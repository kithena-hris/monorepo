import type { JSX } from 'react';

import { SignInButton } from '../../components/sign-in-button';

/**
 * The back-office's own sign-in.
 *
 * A passkey and nothing else — no password, no OTP, no consumer identity
 * provider, and not configurable. `docs/auth-administration.md` sets that
 * policy, and the reasoning is that every argument for accommodating an
 * employee is absent here: the population is small, salaried and equipped.
 */
export default function SignIn(): JSX.Element {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-xl font-semibold">Kithena back-office</h1>
        <p className="text-fg-muted mt-1 text-sm">
          Internal. Sign in with the passkey registered to this device.
        </p>
      </div>
      <SignInButton />
    </main>
  );
}
