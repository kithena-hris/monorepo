import 'server-only';

import { currentTenant } from './branding';
import { people } from './people';
import type { OperationName } from './people-operations';
import { VIEWS } from './people-views';

/**
 * The data each People screen is drawn from, fetched here, on the server,
 * before the page is sent (PEO-098), through the router (PEO-113).
 *
 * The remote draws; the shell fetches (`docs/build-plan.md`, "Remotes are
 * dumb"). One read per route, as the person signed in, and the answer handed
 * to the screen as its `Loadable`. The shell does not look inside beyond
 * putting a record's keyed list back into an object (`people-views.ts`): a
 * field People withheld is absent from what arrives, so it cannot reach the
 * HTML.
 */

export type ScreenLoad =
  | { readonly status: 'ready'; readonly data: unknown }
  | {
      readonly status: 'error';
      readonly message: string;
      /** Nothing answered at the router's address: the VM may be asleep. */
      readonly unreachable?: true;
    }
  /** Nothing to fetch: the screen starts from its own first state. */
  | { readonly status: 'none' };

export interface ScreenQuery {
  readonly params: Readonly<Record<string, string>>;
  readonly search: Readonly<Record<string, string>>;
}

/** One screen's read, and how its answer becomes the view model the remote draws. */
async function read(
  name: OperationName,
  variables: Record<string, unknown> = {},
  view: (data: never) => unknown = (data) => data,
): Promise<ScreenLoad> {
  const answer = await people<never>(name, variables);
  return answer.ok
    ? { status: 'ready', data: view(answer.data) }
    : answer.code === 'UNREACHABLE'
      ? { status: 'error', message: answer.message, unreachable: true }
      : { status: 'error', message: answer.message };
}

/** Today in UTC, as a calendar date. The tenant's own calendar is People's to apply. */
const today = (): string => new Date().toISOString().slice(0, 10);

/** A query-string value, or null for one that was not given. */
const given = (value: string | undefined): string | null =>
  value === undefined || value === '' ? null : value;

export async function loadScreen(component: string, query: ScreenQuery): Promise<ScreenLoad> {
  switch (component) {
    case 'Directory':
      return read(
        'Directory',
        {
          search: given(query.search['search']),
          filter: given(query.search['filter']),
          after: given(query.search['after']),
          segment: given(query.search['segment']),
        },
        VIEWS.Directory,
      );
    case 'Profile':
      return read('Profile', { personId: query.params['id'] ?? null }, VIEWS.Profile);
    case 'PersonHistory':
      return read(
        'History',
        { personId: query.params['id'] ?? null, asOf: given(query.search['asOf']) },
        VIEWS.PersonHistory,
      );
    case 'Onboarding':
      return read('Onboarding', {}, VIEWS.Onboarding);
    case 'BulkEdit':
      return read(
        'BulkEdit',
        { personIds: (query.search['people'] ?? '').split(',').filter((id) => id !== '') },
        VIEWS.BulkEdit,
      );
    case 'CompletenessGrid':
      return read('Completeness', { after: given(query.search['after']) });
    case 'FieldRegistry':
      return read('Registry');
    case 'Integrations':
      return read('Integrations');
    case 'RoleSettings':
      return read('RoleSettings');
    case 'PeopleHome':
      return read('Home');
    case 'Organisation':
      return read('Organisation');
    case 'FullValues':
      return read('FullValues');
    case 'IdentifierReviews':
      return read('IdentifierReviews');
    case 'Duplicates':
      return read('Duplicates', { a: given(query.search['a']), b: given(query.search['b']) });
    case 'WebhookLog':
      return read('WebhookDeliveries', {
        endpointId: query.params['id'] ?? '',
        after: given(query.search['after']),
      });
    case 'ExportBuilder':
      return read('ExportBuilder');
    case 'Analytics':
      return read('Analytics', { segment: given(query.search['segment']) }, VIEWS.Analytics);
    case 'PeopleSetup': {
      const loaded = await read('Setup', {}, VIEWS.PeopleSetup);
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
