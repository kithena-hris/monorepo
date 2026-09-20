import { countryRules } from '@kithena/contracts';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
  PageSection,
  Stack,
  icons,
} from '@reach/ui';

const PinIcon = icons.location;

/**
 * `GB` is a fine thing to store and a poor thing to read.
 *
 * The same lookup the back-office uses, so one company is named the same way on
 * both sides. An unknown code falls through as itself rather than as nothing.
 */
function countryName(code: string): string {
  return countryRules(code)?.name ?? code;
}
import { redirect } from 'next/navigation';
import type { JSX } from 'react';

import { AppShell } from '../components/app-shell';
import { LocalTime } from '../components/local-time';
import { currentTenant } from '../lib/branding';
import { currentPerson, displayName } from '../lib/session';

/**
 * The first screen a person sees at their company.
 *
 * Starter, and honest about it: the areas in the sidebar are the modules in
 * `ModuleKey`, and only this one is built. They are listed and disabled rather
 * than hidden, because a sidebar that grows an item per release teaches nobody
 * where anything lives.
 *
 * Nothing here reads a module's data. `apps/web` is one of four transports and
 * this page renders the shell; the day Time Off lands, it fetches through the
 * router like everything else.
 */
export default async function Home(): Promise<JSX.Element> {
  const person = await currentPerson();
  const tenant = await currentTenant();

  /*
   * Straight to this company's own sign-in page, which is on this hostname.
   *
   * Not a central one. The passkey ceremony is legal here — `app.kithena.com`
   * is a registrable suffix of `acme.app.kithena.com` — so the whole sign-in
   * happens on the origin the cookie belongs to, and nobody is sent somewhere
   * that has to hand a session back.
   */
  if (person === null) redirect('/login');

  /*
   * What to call them: the name they chose, then their legal given name, then
   * a guess from their address.
   *
   * The preferred name comes first because it is the one they asked to be
   * called — that is the whole reason onboarding collects it separately from
   * the legal name payroll needs.
   */
  const greeting =
    person.name?.preferred ?? person.name?.given ?? displayName(person.workEmail);
  const name = person.name === null ? displayName(person.workEmail) : `${person.name.given} ${person.name.family}`;
  /*
   * The slug, not a display name.
   *
   * `proxy.ts` writes `x-tenant-id` and `x-tenant-slug` and nothing else, and
   * it is the one file that decides what a request is allowed to claim about
   * which company it belongs to — every inbound copy is deleted before any
   * branch that can return early. Adding a third header there to carry a
   * prettier label means adding a third thing to sanitise, on the file where
   * getting it wrong is one tenant reading another's data.
   *
   * The slug is what the person typed to get here and what is in their address
   * bar, so it is not a bad label. A real display name arrives with the tenant
   * registry read, which is a change to that file made deliberately.
   */
  // The name they chose, falling back to the label in the address bar. Both are
  // things the person already knows this company by.
  const company = tenant?.branding.displayName ?? tenant?.slug ?? 'your company';
  return (
    <AppShell
      person={{ name, email: person.workEmail }}
      companyName={company}
      logoUrl={tenant?.branding.logoUrl ?? null}
    >
      {/*
        Their zone, rendered beside the greeting rather than in a card.

        It answers a question somebody has every day and nowhere else in this
        app can: what time is it where I work, and are my colleagues likely at
        their desks. The account carries the zone because HR sets it when a
        person is invited, so it is a fact rather than a guess from the browser.
      */}
      <PageHeader
        title={`Hi ${greeting}`}
        description={
          /*
            The place, under the greeting and on its own line.
            
            The company's registered city and country, which is what "the
            workplace" means — identity holds no address for a person. Falls
            back to the old sentence for a company created before an address
            was asked for.
          */
          tenant?.location === null || tenant?.location === undefined ? (
            `Your ${company} account is set up.`
          ) : (
            <span className="flex items-center gap-1.5">
              <PinIcon aria-hidden className="size-3.5" />
              {tenant.location.city}, {countryName(tenant.location.country)}
            </span>
          )
        }
        meta={
          person.timeZone === null ? null : (
            <LocalTime
              timeZone={person.timeZone}
              initial={new Date().toLocaleTimeString('en-GB', {
                timeZone: person.timeZone,
                hour: '2-digit',
                minute: '2-digit',
              })}
              initialHour={Number(
                new Date().toLocaleString('en-GB', {
                  timeZone: person.timeZone,
                  hour: '2-digit',
                  hour12: false,
                }),
              )}
            />
          )
        }
      />

      <PageSection>
        <Stack gap={4}>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Nothing needs you yet</CardTitle>
                <CardDescription>
                  Requests, documents and approvals will appear here as each module is switched on.
                </CardDescription>
              </div>
            </CardHeader>
          </Card>
        </Stack>
      </PageSection>
    </AppShell>
  );
}
