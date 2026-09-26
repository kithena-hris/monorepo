import { countryRules, themePreset } from '@kithena/contracts';
import {
  Avatar,
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Container,
  CopyButton,
  PageHeader,
  Tooltip,
  icons,
} from '@reach/ui';

const ExternalLinkIcon = icons.externalLink;
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { Suspense, type JSX } from 'react';

import { CreatedToast, SavedToast } from '../../../components/created-toast';
import { callIdentity, readIdentity } from '../../../lib/identity';
import { placeFor } from '../../../lib/place';
import { tenantHost, tenantUrl } from '../../../lib/tenant-host';
import { currentOperator } from '../../../lib/session';
import { CompanyDetailTabs } from '../../../components/company-detail-tabs';
import type { EmployeeActionResult } from '../../../components/employee-actions';
import { AddressCard } from '../../../components/address-card';
import { CompanyModules, type SaveModulesResult } from '../../../components/company-modules';
import { CompanySummaryTile } from '../../../components/company-summary-tile';
import type { Invitation, InviteResult } from '../../../components/invite-employee-form';

/**
 * One company, everything the registry holds about it.
 *
 * `platform.*` only, like the list. An employee count or a leave balance would
 * mean querying a module's schema, and a back-office that does that stops
 * working the day a customer runs one module against somebody else's HRIS.
 */
interface Detail {
  id: string;
  slug: string;
  displayName: string;
  status: string;
  createdAt: string;
  themeId: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  brandingPublic: boolean;
  address: {
    country: string;
    line1: string;
    line2: string | null;
    city: string;
    subdivision: string | null;
    postcode: string | null;
  } | null;
  people: { id: string; email: string; status: string; createdAt: string }[];
  /** The modules recorded for the company, or null for none recorded (PEO-114). */
  entitlements: string[] | null;
  effectiveEntitlements: string[];
  /** Module → the accounts named to administer it (PEO-112); absent from an older identity. */
  administrators?: Record<string, string[]>;
}

export default async function Company({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const { id } = await params;
  const query = await searchParams;

  /*
   * The session check and the company, at the same time.
   *
   * Sequentially this page paid for two round trips to a separate deployment
   * before it could render anything, and the second question does not depend on
   * the answer to the first. The guard below still decides whether any of it is
   * shown.
   */
  const [operator, found] = await Promise.all([
    currentOperator(),
    readIdentity(`/api/internal/admin/tenants/${id}`),
  ]);
  if (!operator) redirect('/sign-in');

  /*
   * `null` here means 404 and only 404.
   *
   * It used to mean "anything that was not a body", so an identity service
   * answering 500 — or not answering at all — rendered as "this page could not
   * be found" on a company that plainly exists in the list one click back. A
   * real failure now reaches `app/error.tsx` and says which status came back.
   */
  if (found === null) notFound();
  const company = found as Detail;

  /**
   * Inviting somebody, as a server action rather than an API route.
   *
   * The internal token never leaves this process — `lib/identity` is
   * `server-only`, so importing it from a client component is a build error
   * rather than a convention — and the enrolment link comes back without a
   * second round trip. It is shown once and is not retrievable; the row holds
   * only its hash.
   */
  async function invite(_previous: InviteResult | null, form: FormData): Promise<InviteResult> {
    'use server';

    // Re-checked inside the action, not merely on the page that renders it. A
    // server action is a POST endpoint with a generated name, and the forms
    // guide is explicit that rendering one behind an auth check is not the
    // same as guarding it.
    if (!(await currentOperator())) return { ok: false, message: 'Your session has expired.' };

    const text = (key: string): string | undefined => {
      const value = form.get(key);
      return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
    };
    const employmentStart = text('employmentStart');
    const timeZone = text('timeZone');

    const { status, body } = await callIdentity(`/api/internal/admin/tenants/${id}/invitations`, {
      method: 'POST',
      body: {
        email: text('email') ?? '',
        // Absent rather than empty: `checkEmployment` defaults what is
        // missing, and an empty string is not missing.
        ...(employmentStart === undefined ? {} : { employmentStart }),
        ...(timeZone === undefined ? {} : { timeZone }),
      },
    });

    if (status === 201 && body !== null && typeof body === 'object') {
      /*
       * The employee is in the registry now, so the page that lists them is
       * stale — and it was staying stale until somebody reloaded by hand.
       *
       * `callIdentity` already passes `cache: 'no-store'`, so nothing was
       * cached on the server side; what held the old table was the client's
       * router cache, which keeps the RSC payload for a route it has already
       * rendered and has no way of knowing an action changed it.
       * `revalidatePath` is what tells it, and it re-renders the server
       * components underneath the open dialog rather than replacing it — so
       * the enrolment link, which is shown once and is not retrievable, stays
       * on screen while the table behind it fills in.
       *
       * The list too: its counts and its "nobody can reach" figure both move
       * the moment a company gains its first account.
       */
      revalidatePath(`/companies/${id}`);
      revalidatePath('/');
      return { ok: true, invitation: body as Invitation };
    }

    // The real reason, because the back-office is authenticated and an operator
    // has to know whether this person is already enrolled (use recovery), was
    // terminated (new employment record), or the date was a typo. No stranger
    // reaches here to learn any of it.
    const failure = (body ?? {}) as { message?: unknown; path?: unknown };
    return {
      ok: false,
      message:
        typeof failure.message === 'string'
          ? failure.message
          : 'That employee could not be invited.',
      ...(Array.isArray(failure.path)
        ? { path: failure.path.filter((p): p is string => typeof p === 'string') }
        : {}),
    };
  }

  /**
   * A fresh link for one person, whichever kind they need.
   *
   * Two capabilities behind one menu item, because the operator's intent is the
   * same — "they cannot get in, send them something" — and which endpoint
   * answers it is a fact about the account rather than a decision anybody
   * should have to make from a table.
   *
   * The difference is visible in what comes back. An invitation returns the
   * link, because the person has not proved anything yet and the operator is
   * the second channel. Recovery does not: it goes to the address already on
   * the account and never through here, which is what stops the weaker path
   * becoming a way to take somebody's account.
   */
  async function resendFor(
    accountId: string,
    email: string,
    status: string,
  ): Promise<EmployeeActionResult> {
    'use server';

    if (!(await currentOperator())) return { ok: false, message: 'Your session has expired.' };

    if (status === 'active') {
      const { status: code } = await callIdentity('/api/internal/enrolment/recover', {
        method: 'POST',
        body: { tenantId: id, workEmail: email },
      });
      // Recovery answers the same way for an address it knows and one it does
      // not, by design. A non-2xx here is the service being unreachable.
      if (code >= 400) return { ok: false, message: 'The link could not be sent. Try again.' };
      revalidatePath(`/companies/${id}`);
      return { ok: true, kind: 'recovered' };
    }

    const { status: code, body } = await callIdentity(
      `/api/internal/admin/tenants/${id}/invitations`,
      { method: 'POST', body: { email } },
    );

    if (code === 201 && body !== null && typeof body === 'object') {
      const invitation = body as Invitation;
      revalidatePath(`/companies/${id}`);
      revalidatePath('/');
      return {
        ok: true,
        kind: 'invited',
        enrolUrl: invitation.enrolUrl,
        expiresAt: invitation.expiresAt,
      };
    }

    const failed = (body ?? {}) as { message?: unknown };
    return {
      ok: false,
      message:
        typeof failed.message === 'string' ? failed.message : 'A new link could not be issued.',
    };
  }

  /**
   * Withdrawing an invitation nobody used.
   *
   * Only ever offered for an account that has not enrolled — identity refuses
   * the rest — so what this destroys is a link and a row with no history behind
   * it. `accountId` rather than the address: two people at two companies can
   * share an address, and the id is what the tenant scope is checked against.
   */
  async function withdrawFor(accountId: string): Promise<EmployeeActionResult> {
    'use server';

    if (!(await currentOperator())) return { ok: false, message: 'Your session has expired.' };

    const { status: code, body } = await callIdentity(
      `/api/internal/admin/tenants/${id}/accounts/${accountId}/invitation`,
      { method: 'DELETE' },
    );

    if (code === 204) {
      revalidatePath(`/companies/${id}`);
      revalidatePath('/');
      return { ok: true, kind: 'withdrawn' };
    }

    const failed = (body ?? {}) as { message?: unknown };
    return {
      ok: false,
      message:
        typeof failed.message === 'string'
          ? failed.message
          : 'That invitation could not be cancelled.',
    };
  }

  /**
   * The modules the company bought, the whole list (PEO-114), and who
   * administers each: module → its whole list of account ids (PEO-112).
   */
  async function saveModules(
    entitlements: string[],
    administrators: Record<string, string[]>,
  ): Promise<SaveModulesResult> {
    'use server';

    const operator = await currentOperator();
    if (!operator) return { ok: false, message: 'Your session has expired.' };
    const { status, body } = await callIdentity(`/api/internal/admin/tenants/${id}/entitlements`, {
      method: 'PUT',
      body: { entitlements, administrators, operatorId: operator.operatorId },
    });
    if (status === 200) {
      revalidatePath(`/companies/${id}`);
      return { ok: true };
    }
    const failed = (body ?? {}) as { message?: unknown };
    return {
      ok: false,
      message:
        typeof failed.message === 'string' ? failed.message : 'The modules could not be saved.',
    };
  }

  const theme = company.themeId === null ? undefined : themePreset(company.themeId);
  const country = company.address ? countryRules(company.address.country) : undefined;

  /*
   * The address as lines, resolved once.
   *
   * It used to be assembled inline out of six conditionals and two lookups,
   * which is why a missing subdivision rendered a stray comma. A list of lines
   * is also what a client component can be handed; a rule table is not.
   */
  const counts = {
    active: company.people.filter((person) => person.status === 'active').length,
    invited: company.people.filter((person) => person.status === 'invited').length,
    other: 0,
  };
  counts.other = company.people.length - counts.active - counts.invited;

  const addressLines: string[] =
    company.address === null
      ? []
      : [
          company.address.line1,
          company.address.line2,
          company.address.subdivision === null
            ? company.address.city
            : `${company.address.city}, ${
                country?.subdivisions.find((s) => s.code === company.address?.subdivision)?.name ??
                company.address.subdivision
              }`,
          company.address.postcode,
          country?.name ?? company.address.country,
        ].filter((line): line is string => line !== null && line !== '');

  /**
   * Counts only, and that is the whole contract with the wizard.
   *
   * A token in a URL is a token in browser history, in the referrer of every
   * image the page loads, and in anything watching the path — so the links
   * never travel here. They do not need to: the form below issues a fresh one
   * for anybody, which invalidates the old one anyway.
   */
  const count = (key: string): number => {
    const raw = query[key];
    const value = Number(Array.isArray(raw) ? raw[0] : raw);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  };
  const tile = {
    companyName: company.displayName,
    createdAt: company.createdAt,
    counts,
  };

  const justCreated = query['created'] === '1';
  const justSaved = query['saved'] === '1';

  return (
    <Container size="lg" className="py-10 sm:py-12">
      {justCreated ? (
        <CreatedToast
          companyName={company.displayName}
          invited={count('invited')}
          undelivered={count('undelivered')}
        />
      ) : null}
      {justSaved ? <SavedToast companyName={company.displayName} /> : null}

      {/*
        The company's own images, shown the way their sign-in page shows them
        rather than as two fields in a list. An operator checking a logo is
        checking whether it looks right where it will appear, and a 48px square
        in a form row does not answer that.

        The banner is washed with the company's accent where no image covers
        it. Deliberately an inline `background` on this one element rather than
        `brandRamp`: the ramp only works from `<html>` — see its documentation —
        and the back-office is Kithena's own tool, so re-pointing the whole
        page's accent per customer would leave an operator unable to tell which
        product they are in. One swatch answers "what did they choose"; a
        recoloured application does not.
      */}
      <div className="border-border overflow-hidden rounded-xl border">
        <div
          className="bg-surface-sunken relative h-32 sm:h-44"
          style={theme ? { background: theme.accentSubtle } : undefined}
        >
          {company.coverImageUrl === null ? null : (
            // A plain img, not next/image: these are Blob URLs on a host
            // next.config would have to list in remotePatterns, and that list
            // would need changing whenever the Blob store does.
            <img
              src={company.coverImageUrl}
              alt={`The image on ${company.displayName}'s sign-in page`}
              className="size-full object-cover"
            />
          )}
        </div>

        <div className="bg-surface px-5 pt-3 pb-5">
          {/* `Avatar`, which handles both states. It used to be a hand-rolled
              `<img>` beside a hand-rolled initial-in-a-box, which is two
              treatments of the same idea that had to be kept in step by hand —
              and the design system already derives initials from a name. */}
          <Avatar
            size="2xl"
            shape="rounded"
            fit="contain"
            src={company.logoUrl ?? undefined}
            name={company.displayName}
            className="bg-surface -mt-14 mb-3 shadow-sm"
          />

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
                    <BreadcrumbPage>{company.displayName}</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            }
            title={company.displayName}
            description={
              // The address an operator will actually follow, so it has to be
              // this environment's. A copy button rather than asking somebody to
              // select a hostname out of a sentence by hand.
              <span className="flex items-center gap-1">
                <a
                  href={tenantUrl(company.slug)}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-fg underline-offset-2 hover:underline"
                >
                  {tenantHost(company.slug)}
                </a>
                <CopyButton
                  value={tenantUrl(company.slug)}
                  size="sm"
                  variant="ghost"
                  label={`Copy ${company.displayName}'s address`}
                  tooltip
                />
                {/*
                  Straight to the sign-in page, which is the screen an operator
                  is checking when they follow this: a branded logo, the right
                  hostname, the right accent. The hostname beside it opens the
                  app, which for anybody not signed in is a redirect to this
                  page anyway — but only after a round trip that looks like a
                  broken link when the tenant app is the part that is down.

                  `rel="noreferrer"`, so the back-office URL never appears in a
                  customer's referrer log. Same reason the hostname link has it.
                */}
                <Tooltip content="Open their sign-in page">
                  <Button
                    asChild
                    size="sm"
                    variant="ghost"
                    startIcon={<ExternalLinkIcon aria-hidden />}
                  >
                    <a
                      href={tenantUrl(company.slug, '/login')}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open ${company.displayName}'s sign-in page in a new tab`}
                    />
                  </Button>
                </Tooltip>
              </span>
            }
            meta={
              <>
                <Badge dot tone={company.status === 'active' ? 'success' : 'warning'}>
                  {company.status}
                </Badge>
                {company.brandingPublic ? null : <Badge tone="neutral">Unbranded</Badge>}
              </>
            }
            actions={
              <Button asChild variant="secondary" size="sm">
                <Link href={`/companies/${company.id}/edit`}>Edit</Link>
              </Button>
            }
          />
        </div>
      </div>

      <div className="mt-8">
        {/*
          One tile rather than four. The numbers describe one company, so they
          read as one group; the space that saved is where the sky goes.
        */}
        <CompanySummaryTile {...tile} />
      </div>

      <div className="mt-6">
        {/*
          The country and the theme are resolved here rather than in the tabs.
          `@kithena/contracts` is a server-side lookup either way, and sending
          the two strings an operator reads is smaller than sending the rule
          tables to the browser so it can do the same lookup again.
        */}
        <CompanyDetailTabs
          companyName={company.displayName}
          resend={resendFor}
          withdraw={withdrawFor}
          addressCard={
            /*
              Streamed, so the weather never delays the page.

              The address is only known once identity has answered, so the
              lookup cannot join the first `Promise.all` — awaiting it inline
              would put two more round trips, and a four second timeout, in
              front of a screen that already has everything else. The fallback
              is the same card without a sky, which is exactly what a company
              with no address renders anyway.
            */
            <Suspense fallback={<AddressCard addressLines={addressLines} place={null} />}>
              <AddressCardWithPlace
                addressLines={addressLines}
                city={company.address?.city ?? null}
                country={country?.code ?? null}
              />
            </Suspense>
          }
          people={company.people}
          brandingPublic={company.brandingPublic}
          hasLogo={company.logoUrl !== null}
          hasCover={company.coverImageUrl !== null}
          theme={
            theme === undefined
              ? null
              : {
                  name: theme.name,
                  accent: theme.accent,
                  contrastOnWhite: theme.contrastOnWhite,
                }
          }
          invite={invite}
          modules={
            <CompanyModules
              recorded={company.entitlements}
              effective={company.effectiveEntitlements}
              administrators={company.administrators ?? {}}
              // Anybody who can still sign in, or will once they enrol.
              accounts={company.people
                .filter((p) => ['provisioned', 'invited', 'active'].includes(p.status))
                .map((p) => ({ id: p.id, email: p.email }))}
              save={saveModules}
            />
          }
        />
      </div>
    </Container>
  );
}

/**
 * The address card, once its city has been looked up.
 *
 * Its own component because only an async one can suspend, and suspending is
 * the point: the page renders complete without it and this swaps in when the
 * weather arrives.
 */
async function AddressCardWithPlace({
  addressLines,
  city,
  country,
}: {
  addressLines: readonly string[];
  city: string | null;
  country: string | null;
}): Promise<JSX.Element> {
  return <AddressCard addressLines={addressLines} place={await placeFor(city, country)} />;
}
