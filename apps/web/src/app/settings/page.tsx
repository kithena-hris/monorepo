import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Stack,
  icons,
} from '@reach/ui';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';

import { AppShell } from '../../components/app-shell';
import { currentTenant } from '../../lib/branding';
import { people } from '../../lib/people';
import { peopleRoute, placesFor } from '../../lib/remotes';
import { currentPerson, displayName } from '../../lib/session';

/**
 * Settings: one card per module this company has, each opening that
 * module's settings.
 *
 * The shell draws the page and knows which modules exist; each module says
 * which settings it has, and for whom, in its own route manifest. A module
 * whose settings this person may not open is not shown here at all.
 */
export default async function Settings(): Promise<JSX.Element> {
  const person = await currentPerson();
  if (person === null) redirect('/login');

  const modules: {
    readonly key: string;
    readonly title: string;
    readonly description: string;
    readonly href: string;
    readonly settings: readonly string[];
  }[] = [];

  if (person.entitlements.includes('module.people')) {
    const [route, home] = await Promise.all([
      peopleRoute('/settings/people'),
      people<{ hr: boolean; admin: boolean; finance: boolean }>('Home'),
    ]);
    const roles = home.ok ? home.data : { hr: false, admin: false, finance: false };
    const settings = route == null ? [] : placesFor(route.nav, roles).settings;
    if (settings.length > 0) {
      modules.push({
        key: 'people',
        title: 'People',
        description:
          'Employee fields, your organisation, who holds which role, and the systems People talks to.',
        href: '/settings/people',
        settings: settings.map((s) => s.label),
      });
    }
  }

  const tenant = await currentTenant();
  const name =
    person.name === null
      ? displayName(person.workEmail)
      : `${person.name.given} ${person.name.family}`;
  return (
    <AppShell
      person={{ name, email: person.workEmail }}
      companyName={tenant?.branding.displayName ?? tenant?.slug ?? 'your company'}
      logoUrl={tenant?.branding.logoUrl ?? null}
      entitlements={person.entitlements}
    >
      <Stack gap={6}>
        <PageHeader
          title="Settings"
          description="How each part of Kithena works for your company. Open one to see what is set and change it."
        />
        {modules.length === 0 ? (
          <EmptyState
            title="Nothing here for you to change"
            description="Settings are for your company's administrators and HR. Ask one of them if something needs changing."
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {modules.map((m) => (
              // The whole card is the link, through the title's anchor
              // stretched over it: one tab stop, named by the module.
              <Card key={m.key} interactive className="relative">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <span className="text-fg-muted [&_svg]:size-5">
                      <icons.people aria-hidden />
                    </span>
                    <CardTitle level={2}>
                      <a
                        href={m.href}
                        className="after:absolute after:inset-0 focus-visible:outline-none"
                      >
                        {m.title}
                      </a>
                    </CardTitle>
                  </div>
                  <CardDescription>{m.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-fg-muted text-sm">{m.settings.join(' · ')}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Stack>
    </AppShell>
  );
}
