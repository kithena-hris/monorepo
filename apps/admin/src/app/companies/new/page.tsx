import { redirect } from 'next/navigation';
import type { JSX } from 'react';

import { callIdentity } from '../../../lib/identity';
import { currentOperator } from '../../../lib/session';
import { NewCompanyForm } from '../../../components/new-company-form';

/**
 * Adding a customer.
 *
 * The form posts to a server action rather than to an API route, so the
 * internal token never leaves this process and the invitation links come back
 * without a second round trip. They are shown once and are not retrievable —
 * the database holds their hashes.
 */
export default async function NewCompany(): Promise<JSX.Element> {
  if (!(await currentOperator())) redirect('/sign-in');

  async function create(
    form: FormData,
  ): Promise<
    | { ok: true; slug: string; invitations: { email: string; token: string }[] }
    | { ok: false; message: string }
  > {
    'use server';

    const admins = field(form, 'admins')
      .split(/[\n,]/)
      .map((line) => line.trim())
      .filter((line) => line !== '');

    const { status, body } = await callIdentity('/api/internal/admin/tenants', {
      method: 'POST',
      body: {
        slug: field(form, 'slug').trim().toLowerCase(),
        displayName: field(form, 'displayName'),
        accentColor: field(form, 'accentColor').trim() || null,
        admins,
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
    // and no stranger reaches here to learn it.
    const message =
      body !== null &&
      typeof body === 'object' &&
      typeof (body as { message?: unknown }).message === 'string'
        ? (body as { message: string }).message
        : 'That company could not be created.';
    return { ok: false, message };
  }

  return (
    <main className="mx-auto max-w-lg px-6 py-12">
      <h1 className="text-2xl font-semibold">Add a company</h1>
      <p className="text-fg-muted mt-1 text-sm">
        This creates the tenant and invites its administrators. You are not given a way to sign in
        as them — each receives their own single-use link.
      </p>
      <NewCompanyForm action={create} />
    </main>
  );
}

/**
 * One text field, as text.
 *
 * `FormData.get` returns `string | File | null`, so `String(...)` on it renders
 * an uploaded file as `[object Object]` — which would reach the database as a
 * company name and look, at a glance, like somebody had typed it.
 */
function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}
