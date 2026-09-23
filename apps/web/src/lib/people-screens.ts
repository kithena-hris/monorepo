import 'server-only';

import { currentTenant } from './branding';
import { people } from './people';

/**
 * The data each People screen is drawn from, fetched here, on the server,
 * before the page is sent (PEO-098).
 *
 * The remote draws; the shell fetches (`docs/build-plan.md`, "Remotes are
 * dumb"). One read per route, as the person signed in, and the answer handed
 * to the screen as its `Loadable`. The shell does not look inside: a field
 * People withheld is absent from what arrives, so it cannot reach the HTML.
 */

export type ScreenLoad =
  | { readonly status: 'ready'; readonly data: unknown }
  | { readonly status: 'error'; readonly message: string }
  /** Nothing to fetch: the screen starts from its own first state. */
  | { readonly status: 'none' };

export interface ScreenQuery {
  readonly params: Readonly<Record<string, string>>;
  readonly search: Readonly<Record<string, string>>;
}

const read = async (path: string): Promise<ScreenLoad> => {
  const answer = await people<unknown>('GET', path);
  return answer.ok
    ? { status: 'ready', data: answer.data }
    : { status: 'error', message: answer.message };
};

/** Today in UTC, as a calendar date. The tenant's own calendar is People's to apply. */
const today = (): string => new Date().toISOString().slice(0, 10);

export async function loadScreen(component: string, query: ScreenQuery): Promise<ScreenLoad> {
  switch (component) {
    case 'Directory': {
      const params = new URLSearchParams();
      if (query.search['search']) params.set('search', query.search['search']);
      if (query.search['filter']) params.set('filter', query.search['filter']);
      if (query.search['after']) params.set('after', query.search['after']);
      const qs = params.toString();
      return read(`/v1/views/directory${qs === '' ? '' : `?${qs}`}`);
    }
    case 'Profile':
      return read(
        query.params['id'] === undefined
          ? '/v1/views/profile'
          : `/v1/views/profile/${encodeURIComponent(query.params['id'])}`,
      );
    case 'Onboarding':
      return read('/v1/views/onboarding');
    case 'CompletenessGrid':
      return read('/v1/views/completeness');
    case 'FieldRegistry':
      return read('/v1/views/registry');
    case 'Integrations':
      return read('/v1/views/integrations');
    case 'ExportBuilder':
      return read('/v1/views/export');
    case 'Analytics':
      return read('/v1/views/analytics');
    case 'PeopleSetup': {
      const loaded = await read('/v1/views/setup');
      if (loaded.status !== 'ready') return loaded;
      const data = loaded.data as { legalEntity?: { name: string; country: string } };
      if (data.legalEntity !== undefined) return loaded;
      // No legal entity in People yet: suggest the company as the back office
      // recorded it, for the admin to confirm.
      const tenant = await currentTenant();
      const country = tenant?.location?.country ?? '';
      return {
        status: 'ready',
        data: {
          ...data,
          legalEntity: {
            name: tenant?.branding.displayName ?? tenant?.slug ?? '',
            // A code, or nothing for the administrator to pick: never a guess.
            country: /^[A-Z]{2}$/.test(country) ? country : '',
          },
        },
      };
    }
    default:
      return { status: 'none' };
  }
}

export { today };
