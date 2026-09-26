import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { AttributeDefinition } from '@kithena/contracts';

import {
  checkSegment,
  mayDelete,
  seenBy,
  type Segment,
  type SegmentInput,
} from '../../domain/segment/segment.js';
import type { ViewerRelations } from '../../domain/access/field-access.js';
import { authorizeFields, type ChartViewer } from '../analytics/access.js';
import { chartFilters } from '../analytics/queries.js';
import { filterable, type Asking } from '../person/person-access.js';
import { run } from '../person/service.js';
import { NOBODY, personOfViewer, type ScreenDeps, type Tx } from './record.js';

/**
 * Saved segments (PEO-068, PRD §16.3): one filter, saved once, used in the
 * directory, the export builder and analytics.
 *
 * A segment is a filter and never a result (`domain/segment`). Each place
 * that uses one hands its filter to the same check a filter typed by hand
 * meets, as the person using it, when they use it: the directory's and the
 * export's `filterable` over the people *they* may list, analytics'
 * `authorizeChart` over *their* scope. So whoever saved it, and whatever they
 * could see, the segment shows its user nothing they could not have asked
 * for themselves.
 *
 * The list goes one step further: a segment is offered only where its user
 * could use it, and not at all where they could use it nowhere — the name
 * and values of a filter over a field somebody cannot read say something
 * about that field.
 */

export interface SegmentView {
  readonly id: string;
  readonly name: string;
  readonly filter: readonly { readonly key: string; readonly value: string }[];
  readonly shared: boolean;
  /** Saved by the viewer, who alone may delete it. */
  readonly mine: boolean;
  /** Where this viewer could use it now. */
  readonly usableIn: { readonly directory: boolean; readonly analytics: boolean };
}

/** Who a chart is for: HR sees the tenant, anybody with a record their chain. */
export async function chartViewerOf(
  deps: Pick<ScreenDeps, 'personOf'>,
  tx: Tx,
  asking: Asking,
  everyone: ViewerRelations,
): Promise<ChartViewer | null> {
  if (everyone.isHr) return { kind: 'hr' };
  const own = await personOfViewer(deps, tx, asking);
  return own.ok ? { kind: 'manager', personId: own.value } : null;
}

/** Where a filter could be used by this viewer, decided as each place decides it. */
export function usableIn(
  filter: Readonly<Record<string, string>>,
  definitions: readonly AttributeDefinition[],
  everyone: ViewerRelations,
  viewer: ChartViewer | null,
): SegmentView['usableIn'] {
  const keys = Object.keys(filter);
  const charted = viewer === null ? null : chartFilters(filter);
  const readable =
    viewer !== null && charted?.ok === true ? authorizeFields(definitions, viewer, keys) : null;
  return {
    directory: filterable(definitions, keys, everyone).ok,
    // A special-category filter is never usable: such a breakdown is unfiltered.
    analytics: readable?.ok === true && !readable.value.special,
  };
}

interface Context {
  readonly definitions: readonly AttributeDefinition[];
  readonly everyone: ViewerRelations;
  readonly viewer: ChartViewer | null;
}

async function context(deps: ScreenDeps, tx: Tx, asking: Asking): Promise<Result<Context>> {
  const version = await deps.service.schemas.current(tx, asking.tenantId);
  if (!version) return err(failure('SCHEMA_NOT_PUBLISHED', 'Nothing is published yet'));
  const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
  return ok({
    definitions: version.document.attributes.filter((d) => d.deprecatedAt === null),
    everyone,
    viewer: await chartViewerOf(deps, tx, asking, everyone),
  });
}

const unavailable = () => failure('UNAVAILABLE', 'Segments are not configured');

function viewOf(segment: Segment, asking: Asking, can: Context): SegmentView {
  return {
    id: segment.id,
    name: segment.name,
    filter: Object.entries(segment.filter).map(([key, value]) => ({ key, value })),
    shared: segment.shared,
    mine: segment.ownerAccountId === asking.viewer.accountId,
    usableIn: usableIn(segment.filter, can.definitions, can.everyone, can.viewer),
  };
}

/** The segments this viewer sees and could use somewhere, by name. */
export async function segmentsView(
  deps: ScreenDeps,
  asking: Asking,
): Promise<Result<readonly SegmentView[]>> {
  const store = deps.segments?.store;
  if (store === undefined) return err(unavailable());
  return run(deps.service, asking.tenantId, async (tx) => {
    const can = await context(deps, tx, asking);
    if (!can.ok) return can;
    return ok(await listed(deps, tx, asking, can.value));
  });
}

async function listed(
  deps: ScreenDeps,
  tx: Tx,
  asking: Asking,
  can: Context,
): Promise<SegmentView[]> {
  const all = (await deps.segments?.store.all(tx, asking.tenantId)) ?? [];
  return all
    .filter((s) => seenBy(s, asking.viewer.accountId))
    .map((s) => viewOf(s, asking, can))
    .filter((s) => s.usableIn.directory || s.usableIn.analytics)
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

/** The segments offered beside a screen, for a view that already has its context. */
export async function segmentsFor(
  deps: ScreenDeps,
  tx: Tx,
  asking: Asking,
): Promise<readonly SegmentView[]> {
  if (deps.segments === undefined) return [];
  const can = await context(deps, tx, asking);
  return can.ok ? listed(deps, tx, asking, can.value) : [];
}

/**
 * Save a segment. Its owner must be able to use it somewhere themselves: a
 * filter they could not type by hand is not one they may save for others.
 */
export async function saveSegment(
  deps: ScreenDeps,
  asking: Asking,
  input: SegmentInput,
): Promise<Result<SegmentView>> {
  const segments = deps.segments;
  if (segments === undefined) return err(unavailable());
  const checked = checkSegment(input);
  if (!checked.ok) return checked;
  return run(deps.service, asking.tenantId, async (tx) => {
    const can = await context(deps, tx, asking);
    if (!can.ok) return can;
    const segment: Segment = {
      id: segments.newId(),
      ...checked.value,
      ownerAccountId: asking.viewer.accountId,
    };
    const view = viewOf(segment, asking, can.value);
    if (!view.usableIn.directory && !view.usableIn.analytics) {
      const keys = Object.keys(segment.filter);
      return err(
        failure('FIELD_NOT_FILTERABLE', `You cannot filter people by ${keys.join(', ')}`, keys),
      );
    }
    if (!(await segments.store.insert(tx, asking.tenantId, segment))) {
      return err(
        failure('SEGMENT_NAME_TAKEN', `You already have a segment called ${segment.name}`, [
          'name',
        ]),
      );
    }
    return ok(view);
  });
}

/** Delete a segment: its owner only. One the viewer cannot see is not found. */
export async function deleteSegment(
  deps: ScreenDeps,
  asking: Asking,
  id: string,
): Promise<Result<void>> {
  const store = deps.segments?.store;
  if (store === undefined) return err(unavailable());
  return run(deps.service, asking.tenantId, async (tx) => {
    const found = await segmentFor(deps, tx, asking, id);
    if (!found.ok) return found;
    const may = mayDelete(found.value, asking.viewer.accountId);
    if (!may.ok) return may;
    await store.remove(tx, asking.tenantId, id);
    return ok(undefined);
  });
}

/**
 * The segment a screen was asked to apply, as its filter. Found only when the
 * viewer sees it; whether they may use its keys is the screen's own check.
 */
export async function segmentFor(
  deps: ScreenDeps,
  tx: Tx,
  asking: Asking,
  id: string,
): Promise<Result<Segment>> {
  const all = (await deps.segments?.store.all(tx, asking.tenantId)) ?? [];
  const found = all.find((s) => s.id === id && seenBy(s, asking.viewer.accountId));
  return found === undefined ? err(failure('NOT_FOUND', 'There is no such segment')) : ok(found);
}
