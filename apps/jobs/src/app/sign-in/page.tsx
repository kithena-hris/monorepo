import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';

import { me } from '../../lib/account';
import { SignInForm } from './sign-in-form';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false } };

/** One account for every company here: sign in with a code or with Google. */
export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}): Promise<JSX.Element> {
  const { next = '/me', error } = await searchParams;
  const safeNext = next.startsWith('/') ? next : '/me';
  if ((await me()) !== null) redirect(safeNext);
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 py-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-[-0.02em]">Sign in</h1>
        <p className="text-fg-muted">
          One account for every company that hires here: your applications in one place, your CV
          ready, and no code to type each time you apply.
        </p>
      </div>
      <SignInForm
        next={safeNext}
        google={Boolean(process.env['GOOGLE_CLIENT_ID'])}
        error={error ?? null}
      />
      <p className="text-xs text-fg-muted">
        Your account holds your name, your address and the CVs you keep. What a company knows about
        your application stays with that company.
      </p>
    </div>
  );
}
