import { redirect } from 'next/navigation';
import type { JSX } from 'react';

import { SettingsIndex } from '../../../components/settings-index';
import { accessToken, people } from '../../../lib/people';
import { settingsOverview, type ScreenLoad } from '../../../lib/people-screens';
import { remoteNav } from '../../../lib/remote-manifest';
import { AREAS, placesFor } from '../../../lib/remotes';
import { readPreference } from '../../../lib/preferences';
import { settingsModules } from '../../../lib/settings-modules';
import { prefsFrom } from '../../../lib/shortcut-prefs';
import { shellData } from '../../../lib/shell';
import { currentPerson } from '../../../lib/session';
import { serverWords, type ServerT } from '../../../lib/server-words';
import { isWaking } from '../../../lib/waking';

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
/** What is set now, in one line, for each of People's settings; null where it could not be read. */
function peopleNow(
  data: {
    fields: Json | null;
    organisation: Json | null;
    roles: Json | null;
    integrations: Json | null;
  },
  t: ServerT,
): Record<string, string | null> {
  const { fields, organisation, roles, integrations } = data;
  const published = fields?.['published'] as { version: number } | null | undefined;
  const unpublished = Number(fields?.['unpublishedChanges'] ?? 0);
  const live = (xs: unknown) => list(xs).filter((x) => x['archived'] !== true).length;
  const holding = (role: string) =>
    list(roles?.['people']).filter((p) => list(p['roles']).includes(role as never)).length;
  const sent = new Set(
    list(integrations?.['endpoints'])
      .filter((e) => e['enabled'] !== false)
      .flatMap((e) => list(e['allowlist'])),
  ).size;
  const endpoints = list(integrations?.['endpoints']);
  const settings = (organisation?.['settings'] ?? {}) as Json;
  const scim = list((integrations?.['scim'] as Json | null | undefined)?.['connections']).filter(
    (c) => c['revokedAt'] === null,
  );
  return {
    '/settings/people/fields':
      fields === null
        ? null
        : [
            t(
              'app.app.settings.page.fields',
              { one: '{{count}} field', other: '{{count}} fields' },
              {
                count: list(fields['fields']).length,
              },
            ),
            published == null
              ? t('app.app.settings.page.not_published_yet', 'not published yet')
              : t('app.app.settings.page.version', 'version {{version}}', {
                  version: String(published.version),
                }),
            unpublished > 0
              ? t(
                  'app.app.settings.page.unpublished_changes',
                  { one: '{{count}} unpublished change', other: '{{count}} unpublished changes' },
                  { count: unpublished },
                )
              : null,
          ]
            .filter((x) => x !== null)
            .join(' · '),
    '/settings/people/organisation':
      organisation === null
        ? null
        : [
            t(
              'app.app.settings.page.legal_entities',
              { one: '{{count}} legal entity', other: '{{count}} legal entities' },
              {
                count: live(organisation['legalEntities']),
              },
            ),
            t(
              'app.app.settings.page.locations',
              { one: '{{count}} location', other: '{{count}} locations' },
              {
                count: live(organisation['locations']),
              },
            ),
            t(
              'app.app.settings.page.org_units',
              { one: '{{count}} org unit', other: '{{count}} org units' },
              {
                count: live(organisation['orgUnits']),
              },
            ),
            typeof settings['defaultTimeZone'] === 'string' ? settings['defaultTimeZone'] : '',
          ].join(' · '),
    '/settings/people/roles':
      roles === null
        ? null
        : [
            t(
              'app.app.settings.page.administrators',
              { one: '{{count}} administrator', other: '{{count}} administrators' },
              {
                count: holding('people_admin'),
              },
            ),
            t('app.app.settings.page.in_hr', '{{count}} in HR', { count: holding('hr') }),
            t('app.app.settings.page.in_finance', '{{count}} in finance', {
              count: holding('finance'),
            }),
          ].join(' · '),
    '/settings/people/integrations':
      integrations === null
        ? null
        : [
            endpoints.length === 0
              ? t('app.app.settings.page.no_webhooks', 'No webhooks')
              : t(
                  'app.app.settings.page.webhooks',
                  { one: '{{count}} webhook', other: '{{count}} webhooks' },
                  {
                    count: endpoints.length,
                  },
                ),
            // What leaves: every field some enabled endpoint receives.
            t(
              'app.app.settings.page.fields_sent_out',
              { one: '{{count}} field sent out', other: '{{count}} fields sent out' },
              {
                count: sent,
              },
            ),
            scim.length === 0
              ? t('app.app.settings.page.no_provisioning', 'no provisioning')
              : t('app.app.settings.page.provisioning_from', 'provisioning from {{system}}', {
                  system: String(scim[0]?.['system']),
                }),
          ].join(' · '),
    // The company's log, opened on People's settings.
    '/settings/activity?area=fields,organisation,roles,integrations': t(
      'app.app.settings.page.filtered_to_people_settings',
      'Filtered to People settings',
    ),
  };
}

/** What wants attention in People's settings: a draft to publish, a role nobody holds. */
function peopleAttention(
  data: {
    fields: Json | null;
    roles: Json | null;
  },
  t: ServerT,
): Record<string, { badge: string; chip: string }> {
  const out: Record<string, { badge: string; chip: string }> = {};
  const drafts = Number(data.fields?.['unpublishedChanges'] ?? 0);
  if (drafts > 0) {
    out['/settings/people/fields'] = {
      badge: t(
        'app.app.settings.page.drafts',
        { one: '{{count}} draft', other: '{{count}} drafts' },
        { count: drafts },
      ),
      chip: t(
        'app.app.settings.page.drafts_to_publish',
        { one: '{{count}} draft to publish', other: '{{count}} drafts to publish' },
        { count: drafts },
      ),
    };
  }
  const finance = list(data.roles?.['people']).filter((p) =>
    list(p['roles']).includes('finance' as never),
  ).length;
  if (data.roles !== null && finance === 0) {
    out['/settings/people/roles'] = {
      badge: t('app.app.settings.page.needs_attention', 'Needs attention'),
      chip: t('app.app.settings.page.nobody_in_finance', 'Nobody in finance'),
    };
  }
  return out;
}

/** People's settings as they are now, for whoever may open any of them; null otherwise. */
async function peopleSettings(): Promise<ScreenLoad | null> {
  const [home, route] = await Promise.all([
    people<Readonly<Record<string, boolean>>>('Home'),
    remoteNav(AREAS.people).catch(() => null),
  ]);
  if (!home.ok || route == null) return null;
  return placesFor(route.nav, home.data).settings.length > 0 ? settingsOverview() : null;
}

export default async function Settings(): Promise<JSX.Element> {
  // The session, the token and this person's shortcuts at once: none waits on another.
  const t = await serverWords();
  const shortcutsSaved = readPreference('shortcuts');
  const [person] = await Promise.all([currentPerson(), accessToken()]);
  if (person === null) redirect('/login');

  // People's settings, read as soon as the roles and the routes say this person
  // has any — beside the shell's overview, which takes longest, not after it.
  const settings = person.entitlements.includes('module.people') ? peopleSettings() : null;
  const [shell, overview] = await Promise.all([shellData(person.entitlements), settings]);
  const data =
    overview?.status === 'ready'
      ? (overview.data as Parameters<typeof peopleNow>[0])
      : { fields: null, organisation: null, roles: null, integrations: null };

  const shortcuts = prefsFrom(await shortcutsSaved);
  const changed = Object.keys(shortcuts.bindings).length;
  const modules = settingsModules(
    shell,
    { now: peopleNow(data, t), attention: peopleAttention(data, t) },
    [
      changed === 0
        ? t('app.app.settings.page.the_defaults', 'The defaults')
        : t(
            'app.app.settings.page.changed_shortcuts',
            { one: '{{count}} changed shortcut', other: '{{count}} changed shortcuts' },
            { count: changed },
          ),
      shortcuts.characterKeys
        ? null
        : t('app.app.settings.page.single_keys_off', 'single keys off'),
    ]
      .filter((x) => x !== null)
      .join(' · '),
  );

  // The shell's own first read, answered already in this request.
  const waking = person.entitlements.includes('module.people') && isWaking(await people('Home'));
  return <SettingsIndex modules={modules} waking={waking} />;
}
