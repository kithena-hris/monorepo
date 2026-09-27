import {
  Avatar,
  Card,
  EmptyState,
  PageHeader,
  PageSection,
  Stack,
  icons,
  type IconName,
} from '@reach/ui';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';

import { AppShell } from '../../components/app-shell';
import { currentTenant } from '../../lib/branding';
import { people } from '../../lib/people';
import { settingsOverview } from '../../lib/people-screens';
import { peopleRoute, placesFor, type Place } from '../../lib/remotes';
import { currentPerson, displayName } from '../../lib/session';

/**
 * Settings: every setting this person may open, grouped by the module it
 * belongs to, one click from here.
 *
 * Each is a tile naming what it governs and what is set now, read back from
 * the module, so the page answers "how is this set up" before anything is
 * opened; the tile opens that setting, where it is read in full and changed.
 * The shell draws the page and knows which modules exist; each module says
 * which settings it has, and for whom, in its own route manifest.
 */

type Json = Record<string, unknown>;
const list = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const plural = (n: number, one: string, many = `${one}s`): string =>
  `${String(n)} ${n === 1 ? one : many}`;

/** What is set now, in one line, for each of People's settings; null where it could not be read. */
function peopleNow(data: {
  fields: Json | null;
  organisation: Json | null;
  roles: Json | null;
  integrations: Json | null;
}): Record<string, string | null> {
  const { fields, organisation, roles, integrations } = data;
  const published = fields?.['published'] as { version: number } | null | undefined;
  const unpublished = Number(fields?.['unpublishedChanges'] ?? 0);
  const live = (xs: unknown) => list(xs).filter((x) => x['archived'] !== true).length;
  const holding = (role: string) =>
    list(roles?.['people']).filter((p) => list(p['roles']).includes(role as never)).length;
  const settings = (organisation?.['settings'] ?? {}) as Json;
  const endpoints = list(integrations?.['endpoints']);
  const scim = list((integrations?.['scim'] as Json | null | undefined)?.['connections']).filter(
    (c) => c['revokedAt'] === null,
  );
  return {
    '/settings/people/fields':
      fields === null
        ? null
        : [
            plural(list(fields['fields']).length, 'field'),
            published == null ? 'not published yet' : `version ${String(published.version)}`,
            unpublished > 0 ? plural(unpublished, 'unpublished change') : null,
          ]
            .filter((x) => x !== null)
            .join(' · '),
    '/settings/people/organisation':
      organisation === null
        ? null
        : [
            plural(live(organisation['legalEntities']), 'legal entity', 'legal entities'),
            plural(live(organisation['locations']), 'location'),
            typeof settings['defaultTimeZone'] === 'string' ? settings['defaultTimeZone'] : '',
          ].join(' · '),
    '/settings/people/roles':
      roles === null
        ? null
        : [
            plural(holding('people_admin'), 'administrator'),
            `${String(holding('hr'))} in HR`,
            `${String(holding('finance'))} in finance`,
          ].join(' · '),
    '/settings/people/integrations':
      integrations === null
        ? null
        : [
            endpoints.length === 0 ? 'No webhooks' : plural(endpoints.length, 'webhook'),
            // What leaves: every field some enabled endpoint receives.
            `${plural(
              new Set(
                endpoints.filter((e) => e['enabled'] !== false).flatMap((e) => list(e['allowlist'])),
              ).size,
              'field',
            )} sent out`,
            scim.length === 0 ? 'no provisioning' : `provisioning from ${String(scim[0]?.['system'])}`,
          ].join(' · '),
  };
}

function iconOf(name: string | undefined): JSX.Element {
  const Icon = name !== undefined && name in icons ? icons[name as IconName] : icons.settings;
  return <Icon aria-hidden />;
}

/** One setting: its mark, what it is, what it governs and what is set now. The whole tile opens it. */
function SettingTile({
  place,
  now,
}: {
  readonly place: Place;
  readonly now: string | null;
}): JSX.Element {
  return (
    <li>
      <Card interactive className="relative flex h-full items-start gap-4 p-4">
        <Avatar
          size="lg"
          shape="rounded"
          name={place.label}
          fallback={<span className="text-fg-muted [&_svg]:size-5">{iconOf(place.icon)}</span>}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="text-base font-medium text-fg">
            {/* The title's link covers the tile: one tab stop, named by the setting. */}
            <a href={place.path} className="after:absolute after:inset-0 focus-visible:outline-none">
              {place.label}
            </a>
          </h3>
          {place.description === undefined ? null : (
            <p className="text-sm text-fg-muted">{place.description}</p>
          )}
          {now === null || now === '' ? null : (
            <p className="mt-1 text-xs font-medium text-fg tabular-nums">{now}</p>
          )}
        </div>
        <icons.next aria-hidden className="mt-1 size-4 shrink-0 text-fg-subtle" />
      </Card>
    </li>
  );
}

export default async function Settings(): Promise<JSX.Element> {
  const person = await currentPerson();
  if (person === null) redirect('/login');

  const modules: {
    readonly key: string;
    readonly title: string;
    readonly description: string;
    readonly settings: readonly Place[];
    readonly now: Record<string, string | null>;
  }[] = [];

  if (person.entitlements.includes('module.people')) {
    const [route, home] = await Promise.all([
      peopleRoute('/settings/people'),
      people<{ hr: boolean; admin: boolean; finance: boolean }>('Home'),
    ]);
    const roles = home.ok ? home.data : { hr: false, admin: false, finance: false };
    const settings = route == null ? [] : placesFor(route.nav, roles).settings;
    if (settings.length > 0) {
      const overview = await settingsOverview();
      modules.push({
        key: 'people',
        title: 'People',
        description: 'Your employee records: what they hold, who can see and change them, and where they go.',
        settings,
        now:
          overview.status === 'ready'
            ? peopleNow(overview.data as Parameters<typeof peopleNow>[0])
            : {},
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
      <Stack gap={8}>
        <PageHeader
          title="Settings"
          description="How Kithena works for your company. Open a setting to see it in full and change it."
        />
        {modules.length === 0 ? (
          <EmptyState
            title="Nothing here for you to change"
            description="Settings are for your company's administrators and HR. Ask one of them if something needs changing."
          />
        ) : (
          modules.map((m) => (
            <PageSection key={m.key} title={m.title} description={m.description}>
              <ul className="grid gap-3 md:grid-cols-2">
                {m.settings.map((place) => (
                  <SettingTile key={place.path} place={place} now={m.now[place.path] ?? null} />
                ))}
              </ul>
            </PageSection>
          ))
        )}
      </Stack>
    </AppShell>
  );
}
