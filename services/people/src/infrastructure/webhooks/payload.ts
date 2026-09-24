import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * What an endpoint is sent, and how it can tell we sent it.
 *
 * **Filtered at send time, against the allowlist as it is then.** The stored
 * delivery holds the envelope as the outbox did; this runs every time it goes
 * out, including a replay. An administrator who narrows an allowlist has
 * narrowed every future send of every past event, which is the only reading
 * of "remove this field from that integration" that matches what they meant.
 */

export interface StoredEnvelope {
  readonly eventId: string;
  readonly eventName: string;
  readonly payload: unknown;
  readonly [field: string]: unknown;
}

interface ChangedAttribute {
  readonly key: string;
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

/**
 * The envelope, minus the attributes this endpoint may not receive — or null
 * when nothing it may receive is left, because an update naming only fields
 * an integration cannot see still tells it those fields changed.
 *
 * Only events that carry attributes are touched; the rest are sent unchanged,
 * as §13.3 says.
 */
export function filterFor(
  envelope: StoredEnvelope,
  allowlist: readonly string[],
): StoredEnvelope | null {
  const allowed = new Set(allowlist);
  const payload = record(envelope.payload);

  if (
    envelope.eventName === 'people.person.profile_updated' ||
    envelope.eventName === 'people.person.attribute_effective'
  ) {
    const changed = (
      Array.isArray(payload['changed']) ? payload['changed'] : []
    ) as ChangedAttribute[];
    const kept = changed.filter((c) => allowed.has(c.key));
    return kept.length === 0 ? null : { ...envelope, payload: { ...payload, changed: kept } };
  }

  /*
   * The one event with confidential values in it (a name), so it is held to
   * the same allowlist as the attributes it stands for. A name goes whole or
   * not at all, like on the event itself.
   */
  if (envelope.eventName === 'people.person.identity_facts_changed') {
    const name = record(payload['name']);
    const kept = {
      ...payload,
      name:
        payload['name'] != null && allowed.has('given_name') && allowed.has('family_name')
          ? {
              ...name,
              preferred: allowed.has('preferred_name') ? (name['preferred'] ?? null) : null,
            }
          : null,
      employmentStart: allowed.has('hire_date') ? (payload['employmentStart'] ?? null) : null,
    };
    return kept.name === null && kept.employmentStart === null
      ? null
      : { ...envelope, payload: kept };
  }

  /*
   * A hire carries the name, the work email and the placement, so each is
   * held to the attribute it stands for. The fact of the hire itself — who,
   * which account, which schema version — always goes.
   */
  if (envelope.eventName === 'people.person.hired') {
    const name = record(payload['name']);
    const only = (key: string, field: string) =>
      allowed.has(key) ? (payload[field] ?? null) : null;
    return {
      ...envelope,
      payload: {
        ...payload,
        name:
          payload['name'] != null && allowed.has('given_name') && allowed.has('family_name')
            ? {
                ...name,
                preferred: allowed.has('preferred_name') ? (name['preferred'] ?? null) : null,
              }
            : null,
        workEmail: only('work_email', 'workEmail'),
        employment: only('hire_date', 'employment'),
        legalEntityId: only('legal_entity_id', 'legalEntityId'),
        managerId: only('manager_id', 'managerId'),
        orgUnitId: only('org_unit_id', 'orgUnitId'),
      },
    };
  }

  if (envelope.eventName === 'people.person.attribute_corrected') {
    const attribute = record(payload['attribute']) as Partial<ChangedAttribute>;
    return typeof attribute.key === 'string' && allowed.has(attribute.key) ? envelope : null;
  }

  return envelope;
}

/**
 * `v1=<hex>` per live secret: HMAC-SHA256 over the raw body.
 *
 * During a rotation's overlap both secrets sign, so a receiver that has
 * switched and one that has not both find a signature they can check.
 */
export function signatureHeader(body: string, secrets: readonly string[]): string {
  return secrets
    .map((secret) => `v1=${createHmac('sha256', secret).update(body).digest('hex')}`)
    .join(',');
}

/** What a receiver does, here so the tests check the same thing an integrator would. */
export function verifySignature(body: string, header: string, secret: string): boolean {
  const expected = Buffer.from(createHmac('sha256', secret).update(body).digest('hex'));
  return header
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('v1='))
    .some((part) => {
      const presented = Buffer.from(part.slice(3));
      return presented.length === expected.length && timingSafeEqual(presented, expected);
    });
}
