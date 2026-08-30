import { countryRules, themePreset } from '@kithena/contracts';
import { Alert, Avatar, Badge, Button, Card, CopyButton } from '@reach/ui';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { JSX } from 'react';

import { CreatedToast, SavedToast } from '../../../components/created-toast';
import { callIdentity } from '../../../lib/identity';
import { tenantHost, tenantUrl } from '../../../lib/tenant-host';
import { currentOperator } from '../../../lib/session';
import {
  InvitePersonForm,
  type Invitation,
  type InviteResult,
} from '../../../components/invite-person-form';

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
}

export default async function Company({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  if (!(await currentOperator())) redirect('/sign-in');

  const { id } = await params;
  const query = await searchParams;
  const { status, body } = await callIdentity(`/api/internal/admin/tenants/${id}`);
  if (status === 404) notFound();
  const company = body as Detail | null;
  if (company === null) notFound();

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
        typeof failure.message === 'string' ? failure.message : 'That person could not be invited.',
      ...(Array.isArray(failure.path)
        ? { path: failure.path.filter((p): p is string => typeof p === 'string') }
        : {}),
    };
  }

  const theme = company.themeId === null ? undefined : themePreset(company.themeId);
  const country = company.address ? countryRules(company.address.country) : undefined;

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
  const justCreated = query['created'] === '1';
  const justSaved = query['saved'] === '1';

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      {justCreated ? (
        <CreatedToast
          companyName={company.displayName}
          invited={count('invited')}
          undelivered={count('undelivered')}
        />
      ) : null}
      {justSaved ? <SavedToast companyName={company.displayName} /> : null}
      <Link href="/" className="text-fg-muted hover:text-fg text-sm">
        ← All companies
      </Link>

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
      <header className="border-border mt-4 mb-8 overflow-hidden rounded-xl border">
        <div
          className="bg-surface-sunken relative h-32 sm:h-40"
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

        <div className="bg-surface flex items-end gap-4 p-5">
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
            className="bg-surface -mt-12 shadow-sm"
          />

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-semibold">{company.displayName}</h1>
            {/* The address an operator will actually follow, so it has to be
                this environment's. A copy button rather than asking somebody to
                select a hostname out of a sentence by hand. */}
            <div className="mt-0.5 flex items-center gap-1">
              <a
                href={tenantUrl(company.slug)}
                target="_blank"
                rel="noreferrer"
                className="text-fg-muted hover:text-fg text-sm underline-offset-2 hover:underline"
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
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {company.brandingPublic ? null : (
              <Badge tone="neutral">Unbranded</Badge>
            )}
            <Badge tone={company.status === 'active' ? 'success' : 'warning'}>
              {company.status}
            </Badge>
            <Button asChild variant="secondary" size="sm">
              <Link href={`/companies/${company.id}/edit`}>Edit</Link>
            </Button>
          </div>
        </div>
      </header>

      <div className="grid gap-5 sm:grid-cols-2">
        <Card variant="outlined" padded>
          <h2 className="mb-3 text-sm font-medium">Registered address</h2>
          {company.address === null ? (
            <p className="text-fg-muted text-sm">
              None recorded. This company was created before an address was asked for.
            </p>
          ) : (
            <address className="text-fg-muted text-sm not-italic">
              {company.address.line1}
              <br />
              {company.address.line2 === null ? null : (
                <>
                  {company.address.line2}
                  <br />
                </>
              )}
              {company.address.city}
              {company.address.subdivision === null
                ? null
                : `, ${
                    country?.subdivisions.find((s) => s.code === company.address?.subdivision)
                      ?.name ?? company.address.subdivision
                  }`}
              <br />
              {company.address.postcode === null ? null : (
                <>
                  {company.address.postcode}
                  <br />
                </>
              )}
              {country?.name ?? company.address.country}
            </address>
          )}
        </Card>

        <Card variant="outlined" padded>
          <h2 className="mb-3 text-sm font-medium">Theme</h2>
          {theme === undefined ? (
            <p className="text-fg-muted text-sm">Using the default accent.</p>
          ) : (
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="border-border size-9 rounded-full border"
                style={{ background: theme.accent }}
              />
              <span className="flex flex-col">
                <span className="text-sm font-medium">{theme.name}</span>
                <span className="text-fg-muted text-xs">
                  {theme.contrastOnWhite.toFixed(1)}:1 on white
                </span>
              </span>
            </div>
          )}

          <h2 className="mt-6 mb-2 text-sm font-medium">Created</h2>
          <p className="text-fg-muted text-sm">
            <time dateTime={company.createdAt}>
              {new Date(company.createdAt).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </time>
          </p>
        </Card>
      </div>

      <Card variant="outlined" padded className="mt-5">
        <h2 className="mb-1 text-sm font-medium">Invite somebody</h2>
        <p className="text-fg-muted mb-4 text-sm">
          They are sent a link and set up a passkey on their own device. You are not given a way to
          sign in as them.
        </p>
        <InvitePersonForm action={invite} companyName={company.displayName} />
      </Card>

      <Card variant="outlined" padded className="mt-5">
        <h2 className="mb-3 text-sm font-medium">People</h2>
        {company.people.length === 0 ? (
          <Alert tone="warning" title="Nobody can sign in">
            This company has no accounts at all.
          </Alert>
        ) : (
          <ul className="divide-border border-border divide-y rounded-md border">
            {company.people.map((person) => (
              <li key={person.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="truncate text-sm">{person.email}</span>
                <Badge tone={badgeTone(person.status)}>{person.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <footer className="border-border mt-10 border-t pt-6">
        <Button asChild variant="secondary">
          <Link href="/">Back to companies</Link>
        </Button>
      </footer>
    </main>
  );
}

/**
 * `invited` is deliberately not a warning.
 *
 * It is the correct state for somebody who has been sent a link and has not
 * used it yet, which is most of a company's first week. Colouring the normal
 * case as a problem teaches an operator to ignore the colour.
 */
function badgeTone(status: string): 'success' | 'info' | 'warning' {
  if (status === 'active') return 'success';
  if (status === 'invited') return 'info';
  return 'warning';
}
