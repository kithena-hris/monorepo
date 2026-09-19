import { countryRules, themePreset } from '@kithena/contracts';
import {
  Alert,
  AutoGrid,
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
  PageSection,
  Stack,
  Stat,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@reach/ui';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { JSX } from 'react';

import { CreatedToast, SavedToast } from '../../../components/created-toast';
import { callIdentity, readIdentity } from '../../../lib/identity';
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

  const active = company.people.filter((person) => person.status === 'active').length;
  const invited = company.people.filter((person) => person.status === 'invited').length;
  const other = company.people.length - active - invited;

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

      <Stack gap={8} className="mt-8">
        {/*
          The four questions an operator opens this page to answer, before any
          of the detail below: can anybody sign in, is anybody still waiting,
          is anybody locked out, and how long has this company been here.
        */}
        <AutoGrid minItemWidth="11rem" gap={4}>
          <Stat label="Can sign in" value={active} />
          <Stat
            label="Awaiting enrolment"
            value={invited}
            sentiment={invited > 0 ? 'negative' : 'neutral'}
          />
          <Stat label="Other accounts" value={other} />
          <Stat label="Customer since" value={formatDate(company.createdAt)} />
        </AutoGrid>

        <div className="grid gap-5 lg:grid-cols-2">
          <PageSection title="Registered address" surface>
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
          </PageSection>

          <PageSection
            title="Sign-in page"
            description="What this company's own people see."
            surface
          >
            <Stack gap={4}>
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="border-border size-9 shrink-0 rounded-full border"
                  style={theme ? { background: theme.accent } : undefined}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium">{theme?.name ?? 'Default accent'}</span>
                  <span className="text-fg-muted text-xs">
                    {theme === undefined
                      ? 'No theme chosen, so the product accent is used.'
                      : `${theme.contrastOnWhite.toFixed(1)}:1 on white`}
                  </span>
                </span>
              </div>

              {company.brandingPublic ? null : (
                <Alert tone="info" title="Branding is hidden">
                  Their logo and cover image are stored but are not shown before somebody signs in.
                </Alert>
              )}
            </Stack>
          </PageSection>
        </div>

        <PageSection
          title="Invite somebody"
          description="They are sent a link and set up a passkey on their own device. You are not given a way to sign in as them."
          surface
        >
          <InvitePersonForm action={invite} companyName={company.displayName} />
        </PageSection>

        <PageSection
          title="People"
          description={`${String(company.people.length)} ${company.people.length === 1 ? 'account' : 'accounts'} in the registry.`}
          surface
        >
          {company.people.length === 0 ? (
            <Alert tone="warning" title="Nobody can sign in">
              This company has no accounts at all.
            </Alert>
          ) : (
            <Table aria-label={`People at ${company.displayName}`}>
              <TableHeader>
                <TableRow>
                  <TableHead>Work email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Added</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {company.people.map((person) => (
                  <TableRow key={person.id}>
                    <TableCell className="truncate">{person.email}</TableCell>
                    <TableCell>
                      <Badge dot tone={badgeTone(person.status)}>
                        {person.status}
                      </Badge>
                    </TableCell>
                    <TableCell numeric>
                      <time dateTime={person.createdAt} className="text-fg-muted text-sm">
                        {formatDate(person.createdAt)}
                      </time>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </PageSection>
      </Stack>
    </Container>
  );
}

/** The date an operator reads, not the timestamp the database stores. */
function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
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
