import { redirect } from 'next/navigation';
import type { JSX } from 'react';

import { AppShell } from '../../components/app-shell';
import { SettingsIndex, type SettingsModule } from '../../components/settings-index';
import { currentTenant } from '../../lib/branding';
import { settingsOverview } from '../../lib/people-screens';
import { shellData } from '../../lib/shell';
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
                endpoints
                  .filter((e) => e['enabled'] !== false)
                  .flatMap((e) => list(e['allowlist'])),
              ).size,
              'field',
            )} sent out`,
            scim.length === 0
              ? 'no provisioning'
              : `provisioning from ${String(scim[0]?.['system'])}`,
          ].join(' · '),
  };
}

/** What wants attention in People's settings: a draft to publish, a role nobody holds. */
function peopleAttention(data: {
  fields: Json | null;
  roles: Json | null;
}): Record<string, { badge: string; chip: string }> {
  const out: Record<string, { badge: string; chip: string }> = {};
  const drafts = Number(data.fields?.['unpublishedChanges'] ?? 0);
  if (drafts > 0) {
    out['/settings/people/fields'] = {
      badge: plural(drafts, 'draft'),
      chip: `${plural(drafts, 'draft')} to publish`,
    };
  }
  const finance = list(data.roles?.['people']).filter((p) =>
    list(p['roles']).includes('finance' as never),
  ).length;
  if (data.roles !== null && finance === 0) {
    out['/settings/people/roles'] = { badge: 'Needs attention', chip: 'Nobody in finance' };
  }
  return out;
}

export default async function Settings(): Promise<JSX.Element> {
  const person = await currentPerson();
  if (person === null) redirect('/login');

  const modules: SettingsModule[] = [];
  const shell = await shellData(person.entitlements);

  if (shell.settings.length > 0) {
    const overview = await settingsOverview();
    const data =
      overview.status === 'ready'
        ? (overview.data as Parameters<typeof peopleNow>[0])
        : { fields: null, organisation: null, roles: null, integrations: null };
    const now = peopleNow(data);
    const attention = peopleAttention(data);
    modules.push({
      key: 'people',
      title: 'People',
      description:
        'Your employee records: what they hold, who can see and change them, and where they go.',
      settings: shell.settings.map((place) => ({
        path: place.path,
        label: place.label,
        description: place.description,
        icon: place.icon,
        now: now[place.path] ?? null,
        attention: attention[place.path] ?? null,
      })),
    });
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
      shell={shell}
    >
      <SettingsIndex modules={modules} />
    </AppShell>
  );
}
