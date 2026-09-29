import { countryRules } from '@kithena/contracts';

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

import { AccountSheet } from '../../components/app-shell';
import { HomeDashboard } from '../../components/home-dashboard';
import { LocalTime } from '../../components/local-time';
import { currentTenant } from '../../lib/branding';
import { homeData } from '../../lib/home';
import { currentPerson, displayName } from '../../lib/session';

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
  const greeting = person.name?.preferred ?? person.name?.given ?? displayName(person.workEmail);
  const name =
    person.name === null
      ? displayName(person.workEmail)
      : `${person.name.given} ${person.name.family}`;
  const data = await homeData(person.entitlements);
  const place =
    tenant?.location === null || tenant?.location === undefined
      ? null
      : `${tenant.location.city}, ${countryName(tenant.location.country)}`;
  /*
   * Their zone beside the greeting: it answers a question somebody has every
   * day and nowhere else in this app can — what time is it where I work. The
   * account carries the zone because HR sets it at the invite.
   */
  return (
    <HomeDashboard
      greeting={greeting}
      data={data}
      place={place}
      account={<AccountSheet person={{ name, email: person.workEmail }} />}
      clock={
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
  );
}
