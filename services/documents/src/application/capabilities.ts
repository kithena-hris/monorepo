import { ok, type Result } from '@kithena/domain-kit';
import {
  ASSISTANT_LIMITS,
  CalendarDate,
  DocumentsExpiring,
  DocumentsWaiting,
  type CapabilityInput,
  type ItemsResult,
  type RuntimeCatalogue,
} from '@kithena/contracts';

import { daysUntil } from '../domain/dates.js';
import type { Caller, Deps } from './ports.js';
import { library } from './screens.js';

/**
 * Documents' capabilities for the assistant (assistant PRD §8.5, §8.6), each
 * a read of the asker's own Documents screen, so it sees exactly what they
 * do: titles, people and dates, never a document's content.
 */

export const capabilityCatalogue = () => (): Promise<Result<RuntimeCatalogue>> =>
  Promise.resolve(
    ok({
      module: 'documents',
      serves: [DocumentsWaiting, DocumentsExpiring].map((c) => ({
        name: c.name,
        version: c.version,
      })),
      fields: {},
      metrics: [],
      leaveTypes: [],
      chatNamesPrivateLeave: false,
      denied: [],
    }),
  );

const ALL = { show: 'all', q: '', queue: null, deleted: false } as const;
const due = (on: string | null) => (on === null ? '' : ` · due ${on}`);

/** What waits for the asker, as the top of their Documents screen lists it. */
export const waiting =
  (deps: Deps) =>
  async (caller: Caller, input: CapabilityInput): Promise<Result<ItemsResult>> => {
    const screen = await library(deps, caller, ALL);
    if (!screen.ok) return screen;
    const { needsYou, viewer } = screen.value;
    return ok({
      kind: 'items',
      items: needsYou.slice(0, input.limit ?? ASSISTANT_LIMITS.listed).map((n) => ({
        name: viewer.name ?? 'You',
        label: `${n.title}${due(n.dueOn)}`.slice(0, 200),
      })),
      total: needsYou.length,
    });
  };

/** What expires in the next 60 days: HR's queue, or the asker's own documents. */
export const expiring =
  (deps: Deps) =>
  async (caller: Caller, input: CapabilityInput): Promise<Result<ItemsResult>> => {
    const own = await library(deps, caller, ALL);
    if (!own.ok) return own;
    const limit = input.limit ?? ASSISTANT_LIMITS.listed;
    if (own.value.viewer.hr) {
      const queue = await library(deps, caller, { ...ALL, queue: 'expiring' });
      if (!queue.ok) return queue;
      const rows = queue.value.queueRows;
      return ok({
        kind: 'items',
        items: rows.slice(0, limit).map((r) => ({
          name: r.person?.name ?? own.value.viewer.name ?? 'You',
          label: `${r.title} · ${r.detail}`.slice(0, 200),
        })),
        total: rows.length,
      });
    }
    const today = deps.clock.date('UTC');
    const rows = own.value.rows.filter(
      (r) => r.expiresOn !== null && daysUntil(today, CalendarDate.parse(r.expiresOn)) <= 60,
    );
    return ok({
      kind: 'items',
      items: rows.slice(0, limit).map((r) => ({
        name: own.value.viewer.name ?? 'You',
        label: `${r.title} · expires ${r.expiresOn ?? ''}`.slice(0, 200),
      })),
      total: rows.length,
    });
  };
