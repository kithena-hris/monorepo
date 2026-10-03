import * as z from 'zod';
import { AggregateRoot, err, failure, ok, type Result } from '@kithena/domain-kit';
import {
  PolicyPublished,
  type CalendarDate,
  type PolicyDefinition,
  type TenantId,
} from '@kithena/contracts';

import { envelope, type EventContext } from '../context.js';

/**
 * A leave type's entitlement rules, versioned (PRD §6.2, §6.3).
 *
 * A published version is history: entries posted under it name it, and a
 * re-fold must reproduce them. So a published version never changes, and a
 * revision of a published policy is the next version's draft. Publishing
 * raises `timeoff.policy.published`, which re-folds balances from its date.
 */

export const PolicyId = z.uuid().brand<'PolicyId'>();
export type PolicyId = z.infer<typeof PolicyId>;
export const policyId = (value: string): PolicyId => PolicyId.parse(value);

export interface PolicyVersion {
  readonly version: number;
  readonly status: 'draft' | 'published';
  readonly definition: Readonly<PolicyDefinition>;
  /** Set on publishing. */
  readonly effectiveFrom: CalendarDate | null;
}

const frozen = (definition: PolicyDefinition): Readonly<PolicyDefinition> =>
  Object.freeze(structuredClone(definition));

export class Policy extends AggregateRoot<PolicyId> {
  readonly #tenantId: TenantId;
  #versions: PolicyVersion[];

  private constructor(id: PolicyId, tenantId: TenantId, versions: PolicyVersion[]) {
    super(id);
    this.#tenantId = tenantId;
    this.#versions = versions;
  }

  static draft(args: { id: PolicyId; tenantId: TenantId; definition: PolicyDefinition }): Policy {
    return new Policy(args.id, args.tenantId, [
      { version: 1, status: 'draft', definition: frozen(args.definition), effectiveFrom: null },
    ]);
  }

  /**
   * A policy as it was stored, oldest version first. Each publish raised one
   * event, so the published count is the aggregate's version.
   */
  static rehydrate(args: {
    id: PolicyId;
    tenantId: TenantId;
    versions: readonly PolicyVersion[];
  }): Policy {
    if (args.versions.length === 0) throw new Error(`Policy ${args.id} has no versions`);
    const policy = new Policy(
      args.id,
      args.tenantId,
      args.versions.map((v) => ({ ...v, definition: frozen(v.definition) })),
    );
    policy.restoreVersion(args.versions.filter((v) => v.status === 'published').length);
    return policy;
  }

  get versions(): readonly PolicyVersion[] {
    return this.#versions;
  }

  get latest(): PolicyVersion {
    return this.#versions.at(-1) as PolicyVersion;
  }

  at(n: number): PolicyVersion | undefined {
    return this.#versions.find((v) => v.version === n);
  }

  /** The published version in effect on a date, or `null` before the first. */
  inEffectOn(on: CalendarDate): PolicyVersion | null {
    return (
      this.#versions.findLast((v) => v.effectiveFrom !== null && v.effectiveFrom <= on) ?? null
    );
  }

  /** Replace the draft, or start the next one when the latest is published. */
  revise(definition: PolicyDefinition): Result<void> {
    const latest = this.latest;
    if (definition.leaveTypeKey !== latest.definition.leaveTypeKey) {
      return err(
        failure('LEAVE_TYPE_FIXED', 'A policy stays with the leave type it was made for', [
          'leaveTypeKey',
        ]),
      );
    }
    const draft: PolicyVersion = {
      version: latest.status === 'draft' ? latest.version : latest.version + 1,
      status: 'draft',
      definition: frozen(definition),
      effectiveFrom: null,
    };
    this.#versions =
      latest.status === 'draft'
        ? [...this.#versions.slice(0, -1), draft]
        : [...this.#versions, draft];
    return ok(undefined);
  }

  publish(effectiveFrom: CalendarDate, ctx: EventContext): Result<void> {
    const latest = this.latest;
    if (latest.status !== 'draft')
      return err(failure('NOTHING_TO_PUBLISH', 'There is no draft to publish'));
    const previous = this.#versions.findLast((v) => v.status === 'published');
    if (previous?.effectiveFrom && effectiveFrom < previous.effectiveFrom) {
      return err(
        failure(
          'EFFECTIVE_BEFORE_PREVIOUS',
          `Version ${String(previous.version)} is in effect from ${previous.effectiveFrom}`,
          ['effectiveFrom'],
        ),
      );
    }
    this.#versions = [
      ...this.#versions.slice(0, -1),
      { ...latest, status: 'published', effectiveFrom },
    ];
    this.raise(
      envelope(ctx, {
        tenantId: this.#tenantId,
        eventName: PolicyPublished.name,
        eventVersion: PolicyPublished.version,
        effectiveFrom,
        aggregate: { type: 'Policy', id: this.id, version: this.version + 1 },
        payload: PolicyPublished.payload.parse({
          policyId: this.id,
          version: latest.version,
          leaveTypeKey: latest.definition.leaveTypeKey,
          effectiveFrom,
        }),
      }),
    );
    return ok(undefined);
  }
}
