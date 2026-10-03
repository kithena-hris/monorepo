import { ok, type Result } from '@kithena/domain-kit';
import {
  isPrivateLeaveType,
  timeoffCapabilities,
  type CatalogueField,
  type RuntimeCatalogue,
} from '@kithena/contracts';

import type { Caller, Deps } from '../ports.js';
import { transact } from '../shared.js';
import { DENIED } from './denied.js';

/**
 * What Time Off answers the assistant (assistant PRD §8, §10.3): read-only
 * queries, run as the asker, over the same sight rule as the calendar. Nothing
 * here decides who may see what a second time; the transport only proves the
 * assistant sent the request (`http/capabilities.ts`).
 */

/**
 * `GET /internal/capabilities`: configuration only — the leave types, the
 * teams the projection holds, Time Off's denied words — never a value from
 * anybody's record. The assistant drops what yields to People and masks what
 * is private before a model sees any of it.
 *
 * A private type is not an option by name: the assistant offers it only as a
 * masked reference (§12.2), and `leaveTypes` says which ones those are.
 */
export const capabilityCatalogue =
  (deps: Pick<Deps, 'uow'>) =>
  (caller: Caller): Promise<Result<RuntimeCatalogue>> =>
    transact(deps, caller.tenantId, async (tx) => {
      const types = (await tx.leaveTypes.list())
        .map((t) => t.definition)
        .toSorted((a, b) => a.name.default.localeCompare(b.name.default));
      const teams = new Map<string, string>();
      for (const m of await tx.members.list()) {
        if (m.status !== 'left' && m.teamKey !== null)
          teams.set(m.teamKey, m.teamName ?? m.teamKey);
      }
      const leaveType: CatalogueField = {
        key: 'leave_type',
        label: 'Leave type',
        kind: 'select',
        options: types
          .filter((t) => !isPrivateLeaveType(t))
          .map((t) => ({ value: t.key, label: t.name.default })),
      };
      const team: CatalogueField = {
        key: 'team',
        label: 'Team',
        kind: 'select',
        options: [...teams]
          .map(([value, label]) => ({ value, label }))
          .toSorted((a, b) => a.label.localeCompare(b.label)),
      };
      return ok({
        module: 'timeoff',
        serves: timeoffCapabilities.map((c) => ({ name: c.name, version: c.version })),
        fields: { 'timeoff.away': [leaveType, team] },
        metrics: [],
        leaveTypes: types.map((t) => ({
          key: t.key,
          name: t.name.default,
          private: isPrivateLeaveType(t),
        })),
        denied: DENIED.map((d) => ({ key: d.key, labels: [...(d.labels ?? [])] })),
      });
    });
