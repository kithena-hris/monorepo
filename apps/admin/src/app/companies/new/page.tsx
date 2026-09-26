import type { PostalAddress } from '@kithena/contracts';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Container,
  PageHeader,
} from '@reach/ui';
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';

import { callIdentity } from '../../../lib/identity';
import { tenantHostSuffix } from '../../../lib/tenant-host';
import { currentOperator } from '../../../lib/session';
import {
  NewCompanyWizard,
  type ProvisionedInvitation,
} from '../../../components/new-company-wizard';

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
  timeZone: string;
  entitlements: string[];
  /** Module → the emails of the invited administrators who run it (PEO-112). */
  administrators: Record<string, string[]>;
}

export default async function NewCompany(): Promise<JSX.Element> {
  if (!(await currentOperator())) redirect('/sign-in');

  async function create(
    draft: Draft,
  ): Promise<
    | { ok: true; tenantId: string; slug: string; invitations: ProvisionedInvitation[] }
    | { ok: false; message: string; path?: string[] }
  > {
    'use server';

    const operator = await currentOperator();
    if (!operator) return { ok: false, message: 'Your session has expired.' };

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
        // The company's zone: People's first legal entity and default (PEO-099).
        timeZone: draft.timeZone,
        // The modules the company bought, recorded with it (PEO-114), and
        // who first administers each that needs one (PEO-112).
        entitlements: draft.entitlements,
        administrators: Object.fromEntries(
          Object.entries(draft.administrators).filter(([module]) =>
            draft.entitlements.includes(module),
          ),
        ),
        operatorId: operator.operatorId,
      },
    });

    if (status === 201 && body !== null && typeof body === 'object') {
      // `tenantId` is what the wizard navigates to. It comes back from
      // `provisionTenant` and used to be dropped here, which is why there was
      // nowhere for the wizard to go afterwards.
      const { tenantId, slug, invitations } = body as Record<string, unknown>;
      // A new customer changes every figure on the list, and the wizard sends
      // somebody straight to the company it just created — so the list is not
      // re-requested until they navigate back to a route the router has
      // already cached.
      revalidatePath('/');
      return {
        ok: true,
        tenantId: String(tenantId),
        slug: String(slug),
        invitations: (invitations ?? []) as ProvisionedInvitation[],
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
    <Container size="md" className="py-10 sm:py-12">
      {/*
        A breadcrumb, because this screen is a step inside the companies list
        rather than a place of its own — and because a wizard that can only be
        left by finishing it is a wizard people abandon through the browser.
        The footer of the wizard carries the same exit as a button.
      */}
      <PageHeader
        breadcrumb={
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href="/">Companies</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator>/</BreadcrumbSeparator>
              <BreadcrumbItem>
                <BreadcrumbPage>Add a company</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        title="Add a company"
        description="This creates the tenant and emails each administrator their own single-use link. You are not given a way to sign in as them."
      />
      <div className="mt-8">
        <NewCompanyWizard action={create} hostSuffix={tenantHostSuffix()} />
      </div>
    </Container>
  );
}
