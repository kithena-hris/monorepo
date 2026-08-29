import { DEFAULT_THEME_ID } from '@kithena/contracts';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { JSX } from 'react';

import {
  EditCompanyForm,
  type CompanyDraft,
  type EditResult,
} from '../../../../components/edit-company-form';
import { callIdentity } from '../../../../lib/identity';
import { currentOperator } from '../../../../lib/session';

/**
 * The registry's answer, which is `CompanyDraft` with the parts a form cannot
 * change and one it must default: a company provisioned before the theme step
 * existed has no `themeId`.
 */
interface Detail extends Omit<CompanyDraft, 'themeId'> {
  id: string;
  slug: string;
  themeId: string | null;
}

/**
 * Changing what the registry holds about a company.
 *
 * Its own route rather than an editable company page. The detail page is the
 * one an operator lands on from a list and reads; an edit form on it would make
 * every visit a page with unsaved state in it, and "did I change something" is
 * not a question a back-office should leave open.
 */
export default async function EditCompany({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  if (!(await currentOperator())) redirect('/sign-in');

  const { id } = await params;
  const { status, body } = await callIdentity(`/api/internal/admin/tenants/${id}`);
  if (status === 404) notFound();
  const company = body as Detail | null;
  if (company === null) notFound();

  /**
   * Saving, as a server action.
   *
   * Same reasoning as the invite action on the company page: the internal token
   * stays in this process, and a server action is a POST endpoint with a
   * generated name — so the operator check is repeated *inside* it rather than
   * relying on the page having refused to render.
   */
  async function save(_previous: EditResult | null, form: FormData): Promise<EditResult> {
    'use server';

    if (!(await currentOperator())) {
      return { ok: false, message: 'Your session has expired.' };
    }

    const text = (key: string): string => {
      const value = form.get(key);
      return typeof value === 'string' ? value.trim() : '';
    };

    const { status: saved, body: result } = await callIdentity(
      `/api/internal/admin/tenants/${id}`,
      {
        method: 'PATCH',
        body: {
          displayName: text('displayName'),
          themeId: text('themeId'),
          logoUrl: text('logoUrl'),
          coverImageUrl: text('coverImageUrl'),
          brandingPublic: text('brandingPublic') !== '',
          address: {
            country: text('country'),
            line1: text('line1'),
            line2: text('line2'),
            city: text('city'),
            subdivision: text('subdivision'),
            postcode: text('postcode'),
          },
        },
      },
    );

    if (saved === 200) return { ok: true };

    const failure = (result ?? {}) as { message?: unknown; path?: unknown };
    return {
      ok: false,
      message:
        typeof failure.message === 'string' ? failure.message : 'That change could not be saved.',
      ...(Array.isArray(failure.path)
        ? { path: failure.path.filter((p): p is string => typeof p === 'string') }
        : {}),
    };
  }

  /*
   * Redirecting on success rather than reporting it here.
   *
   * The company page is where the change is visible, and it re-reads the
   * registry — so an operator sees what was actually stored rather than a form
   * still holding what they typed. `?saved=1` is what raises the toast there.
   */
  async function saveAndReturn(
    previous: EditResult | null,
    form: FormData,
  ): Promise<EditResult> {
    'use server';
    const result = await save(previous, form);
    if (result.ok) redirect(`/companies/${id}?saved=1`);
    return result;
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href={`/companies/${id}`} className="text-fg-muted hover:text-fg text-sm">
        ← {company.displayName}
      </Link>

      <header className="mt-4 mb-8">
        <h1 className="text-2xl font-semibold">Edit company</h1>
        <p className="text-fg-muted mt-1 text-sm">
          <code>{company.slug}</code>.app.kithena.com
        </p>
      </header>

      <EditCompanyForm
        action={saveAndReturn}
        companyId={id}
        company={{
          displayName: company.displayName,
          // A company provisioned before the theme step existed has none. The
          // default is what its login page already renders, so offering it as
          // the starting point is describing what is true rather than
          // proposing a change.
          themeId: company.themeId ?? DEFAULT_THEME_ID,
          logoUrl: company.logoUrl,
          coverImageUrl: company.coverImageUrl,
          brandingPublic: company.brandingPublic,
          address: company.address,
        }}
      />
    </main>
  );
}
