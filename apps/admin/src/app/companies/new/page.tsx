import type { PostalAddress } from '@kithena/contracts';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';

import { callIdentity } from '../../../lib/identity';
import { currentOperator } from '../../../lib/session';
import { NewCompanyWizard } from '../../../components/new-company-wizard';

/**
 * Adding a customer.
 *
 * The wizard posts to a server action rather than to an API route, so the
 * internal token never leaves this process and the invitation links come back
 * without a second round trip. They are shown once and are not retrievable —
 * the database holds their hashes.
 */
interface Draft {
  displayName: string;
  slug: string;
  logoUrl: string | null;
  coverImageUrl: string | null;
  address: PostalAddress;
  admins: string[];
  themeId: string;
}

export default async function NewCompany(): Promise<JSX.Element> {
  if (!(await currentOperator())) redirect('/sign-in');

  async function create(
    draft: Draft,
  ): Promise<
    | { ok: true; slug: string; invitations: { email: string; token: string }[] }
    | { ok: false; message: string; path?: string[] }
  > {
    'use server';

    const { status, body } = await callIdentity('/api/internal/admin/tenants', {
      method: 'POST',
      body: {
        slug: draft.slug.trim().toLowerCase(),
        displayName: draft.displayName.trim(),
        themeId: draft.themeId,
        logoUrl: draft.logoUrl,
        coverImageUrl: draft.coverImageUrl,
        admins: draft.admins,
        address: draft.address,
      },
    });

    if (status === 201 && body !== null && typeof body === 'object') {
      const { slug, invitations } = body as Record<string, unknown>;
      return {
        ok: true,
        slug: String(slug),
        invitations: (invitations ?? []) as { email: string; token: string }[],
      };
    }

    // The back-office is authenticated, so it gets the real reason: an operator
    // has to know whether the label was malformed, reserved or already taken,
    // and no stranger reaches here to learn it. `path` comes back too, so the
    // wizard can return to the step that owns the field.
    const failure = (body ?? {}) as { message?: unknown; path?: unknown };
    return {
      ok: false,
      message:
        typeof failure.message === 'string'
          ? failure.message
          : 'That company could not be created.',
      ...(Array.isArray(failure.path)
        ? { path: failure.path.filter((p): p is string => typeof p === 'string') }
        : {}),
    };
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold">Add a company</h1>
      <p className="text-fg-muted mt-1 text-sm">
        This creates the tenant and invites its administrators. You are not given a way to sign in
        as them — each receives their own single-use link.
      </p>
      <NewCompanyWizard action={create} />
    </main>
  );
}
