import { ok, type Result } from '@kithena/domain-kit';

import type { Asking } from '../person/person-access.js';
import { run } from '../person/service.js';
import { avatarsOf } from './photo.js';
import { nameOf, type ScreenDeps } from './record.js';

/**
 * Names and faces for ids another service holds: the central activity log
 * (`docs/audit.md`) keeps account and person ids, never names, and asks here
 * for the ones on its page.
 *
 * Each person is read as the viewer may read them, through the same access
 * every screen uses: somebody the viewer may not see is simply absent, and the
 * log shows "someone" rather than a name it should not have.
 */

/** The most ids of each kind one page asks about. A page is fifty entries. */
export const NAMES_LIMIT = 100;

export interface NamesView {
  readonly people: readonly {
    /** The account asked about, when it was an account that was asked about. */
    readonly accountId: string | null;
    readonly personId: string;
    readonly name: string;
    readonly avatarUrl: string | null;
  }[];
}

export async function namesView(
  deps: ScreenDeps,
  asking: Asking,
  ids: { readonly accountIds: readonly string[]; readonly personIds: readonly string[] },
): Promise<Result<NamesView>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const wanted = new Map<string, string | null>();
    for (const accountId of new Set(ids.accountIds.slice(0, NAMES_LIMIT))) {
      const personId = await deps.personOf(tx, asking.tenantId, accountId);
      if (personId !== null) wanted.set(personId, accountId);
    }
    for (const personId of ids.personIds.slice(0, NAMES_LIMIT)) {
      if (!wanted.has(personId)) wanted.set(personId, null);
    }
    const named: { accountId: string | null; personId: string; name: string }[] = [];
    for (const [personId, accountId] of wanted) {
      const read = await deps.service.access.read(tx, { ...asking, personId });
      const name = read.ok ? nameOf(read.value.attributes) : null;
      if (name !== null) named.push({ accountId, personId, name });
    }
    const avatars = await avatarsOf(deps, tx, asking.tenantId, named.map((p) => p.personId));
    return ok({
      people: named.map((p) => ({ ...p, avatarUrl: avatars.get(p.personId) ?? null })),
    });
  });
}
