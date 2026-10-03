import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { err, failure, ok, type Result } from '@kithena/domain-kit';
import {
  PersonId,
  PunchInput,
  TenantId,
  type Instant,
  type LocationKey,
  type PunchKind,
} from '@kithena/contracts';

import { AttendanceClock, ms } from '../../domain/attendance/clock.js';
import { CLOCK_SKEW_SECONDS, clockSkew, kindAt, unseen } from '../../domain/attendance/kiosk.js';
import type { Caller, Deps, KioskCredentialKind, KioskDevice, Member, Tx } from '../ports.js';
import { forbidden, isHrAdmin, notFound, refuse, transact } from '../shared.js';

/**
 * Kiosk devices (PRD §11.9, TOF-107): a wall tablet at a location, which
 * authenticates as itself with a revocable token scoped to punching there.
 *
 * **A kiosk reads nothing personal.** It is told the first name of whoever
 * tapped, and what the tap did, and nothing else: no balance, no surname, no
 * schedule. Members tap with a badge (a keyboard-wedge reader types its
 * number), a PIN, or a personal QR their phone shows for a minute.
 *
 * Only hashes are kept: the device token's SHA-256, and badges and PINs as
 * HMACs under the module's secret (`feedSecret`), so a database dump alone
 * cannot be walked back to a four-digit PIN. ponytail: rotating that secret
 * means every badge and PIN is set again; a key of their own when that bites.
 */

type KioskDeps = Pick<Deps, 'uow' | 'authz' | 'clock' | 'newId' | 'feedSecret' | 'notifier'>;

/* ----------------------------------------------------------------- token -- */

/**
 * `kk_` and base64url of the tenant's id, the device's id and 32 random bytes:
 * People's SCIM token shape (`kps_`), so the token is found inside its own
 * tenant's row-level security without searching every tenant.
 */
const TOKEN_PREFIX = 'kk_';
const uuidBytes = (id: string) => Buffer.from(id.replaceAll('-', ''), 'hex');
const uuidOf = (bytes: Buffer) => {
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

function issueToken(tenantId: string, deviceId: string): string {
  const raw = Buffer.concat([uuidBytes(tenantId), uuidBytes(deviceId), randomBytes(32)]);
  return `${TOKEN_PREFIX}${raw.toString('base64url')}`;
}

function claimsOf(token: string): { tenantId: string; deviceId: string } | null {
  if (!token.startsWith(TOKEN_PREFIX) || token.length > 200) return null;
  const raw = Buffer.from(token.slice(TOKEN_PREFIX.length), 'base64url');
  if (raw.length !== 64) return null;
  return { tenantId: uuidOf(raw.subarray(0, 16)), deviceId: uuidOf(raw.subarray(16, 32)) };
}

function sameHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

const invalidToken = (): Result<never> =>
  err(failure('INVALID_TOKEN', 'This kiosk is not registered, or was revoked'));

/** The device a token proves, in its tenant's transaction; refused alike for every reason. */
function asKiosk<T>(
  deps: Pick<Deps, 'uow'>,
  token: string,
  deviceId: string,
  fn: (tx: Tx, device: KioskDevice) => Promise<Result<T>>,
): Promise<Result<T>> {
  const claims = claimsOf(token);
  const tenant = TenantId.safeParse(claims?.tenantId);
  if (claims === null || !tenant.success || claims.deviceId !== deviceId) {
    return Promise.resolve(invalidToken());
  }
  return transact(deps, tenant.data, async (tx) => {
    const device = await tx.kiosks.device(deviceId);
    if (device === null || device.revokedAt !== null || !sameHex(sha256(token), device.tokenHash))
      return invalidToken();
    return fn(tx, device);
  });
}

/* ----------------------------------------------------------- credentials -- */

export type KioskCredential =
  | { readonly kind: KioskCredentialKind; readonly value: string }
  | { readonly kind: 'qr'; readonly value: string };

export const credentialHash = (secret: string, kind: KioskCredentialKind, value: string): string =>
  createHmac('sha256', secret).update(`kiosk:${kind}:${value.trim()}`).digest('hex');

/** A personal QR's validity: long enough to walk to the door, too short to be worth copying. */
const QR_SECONDS = 60;
const QR_PREFIX = 'kq_';
const qrSignature = (secret: string, body: string) =>
  createHmac('sha256', secret).update(`kiosk-qr:${body}`).digest('base64url');

function qrHolder(secret: string, tenantId: string, token: string, at: Instant): PersonId | null {
  if (!token.startsWith(QR_PREFIX)) return null;
  const [body, signature] = token.slice(QR_PREFIX.length).split('.');
  if (body === undefined || signature === undefined) return null;
  const expected = Buffer.from(qrSignature(secret, body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      t?: unknown;
      p?: unknown;
      e?: unknown;
    };
    const person = PersonId.safeParse(claims.p);
    if (claims.t !== tenantId || typeof claims.e !== 'string' || !person.success) return null;
    // Against the tap's instant: a QR shown to an offline kiosk is checked when it syncs.
    return ms(at) <= ms(claims.e) ? person.data : null;
  } catch {
    return null;
  }
}

/** Whoever a credential belongs to, at the instant it was shown. */
async function holderOf(
  tx: Tx,
  secret: string,
  credential: KioskCredential,
  at: Instant,
): Promise<Member | null> {
  const personId =
    credential.kind === 'qr'
      ? qrHolder(secret, tx.tenantId, credential.value, at)
      : await tx.kiosks.holder(
          credential.kind,
          credentialHash(secret, credential.kind, credential.value),
        );
  return personId === null ? null : tx.members.get(personId);
}

const unknownCredential = () =>
  failure('UNKNOWN_CREDENTIAL', 'This badge, PIN or code is not recognised');

/* ------------------------------------------------------------------- HR -- */

/** What HR sees of a kiosk: never its token or the token's hash. */
export interface KioskSummary {
  readonly id: string;
  readonly name: string;
  readonly locationKey: LocationKey;
  readonly lastSeenAt: Instant | null;
  readonly revokedAt: Instant | null;
}

const summary = (d: KioskDevice): KioskSummary => ({
  id: d.id,
  name: d.name,
  locationKey: d.locationKey,
  lastSeenAt: d.lastSeenAt,
  revokedAt: d.revokedAt,
});

/** A kiosk for a location, and its token, shown this once. HR. */
export const registerKiosk =
  (deps: Pick<Deps, 'uow' | 'authz' | 'newId'>) =>
  (
    caller: Caller,
    input: { readonly name: string; readonly locationKey: LocationKey },
  ): Promise<Result<{ deviceId: string; token: string }>> =>
    transact(deps, caller.tenantId, async (tx) => {
      if (!(await isHrAdmin(deps, caller))) return forbidden();
      const deviceId = deps.newId();
      const token = issueToken(caller.tenantId, deviceId);
      await tx.kiosks.saveDevice({
        id: deviceId,
        name: input.name,
        locationKey: input.locationKey,
        tokenHash: sha256(token),
        lastSeenAt: null,
        revokedAt: null,
        lastSequence: 0,
      });
      return ok({ deviceId, token });
    });

/** Its token stops working at once. HR. */
export const revokeKiosk =
  (deps: Pick<Deps, 'uow' | 'authz' | 'clock'>) =>
  (caller: Caller, deviceId: string): Promise<Result<void>> =>
    transact(deps, caller.tenantId, async (tx) => {
      if (!(await isHrAdmin(deps, caller))) return forbidden();
      const device = await tx.kiosks.device(deviceId);
      if (device === null) return notFound('Kiosk');
      if (device.revokedAt === null)
        await tx.kiosks.saveDevice({ ...device, revokedAt: deps.clock.instant() });
      return ok(undefined);
    });

/** Every kiosk, revoked ones too, by name. HR. */
export const kioskDevices =
  (deps: Pick<Deps, 'uow' | 'authz'>) =>
  (caller: Caller): Promise<Result<KioskSummary[]>> =>
    transact(deps, caller.tenantId, async (tx) => {
      if (!(await isHrAdmin(deps, caller))) return forbidden();
      return ok(
        (await tx.kiosks.devices()).map(summary).toSorted((a, b) => a.name.localeCompare(b.name)),
      );
    });

/**
 * A member's badge (HR's to hand out) or PIN (the member's own, or HR's);
 * `null` takes it away. Two people never share one.
 */
export const setKioskCredential =
  (deps: Pick<Deps, 'uow' | 'authz' | 'feedSecret'>) =>
  (
    caller: Caller,
    personId: PersonId,
    kind: KioskCredentialKind,
    value: string | null,
  ): Promise<Result<void>> =>
    transact(deps, caller.tenantId, async (tx) => {
      const hr = await isHrAdmin(deps, caller);
      if (!hr && !(kind === 'pin' && caller.personId === personId)) return forbidden();
      if ((await tx.members.get(personId)) === null) return notFound('Member');
      const hash = value === null ? null : credentialHash(deps.feedSecret, kind, value);
      if (hash !== null) {
        const holder = await tx.kiosks.holder(kind, hash);
        if (holder !== null && holder !== personId)
          return refuse('CREDENTIAL_TAKEN', `Somebody else already has this ${kind}`, ['value']);
      }
      await tx.kiosks.setCredential(personId, kind, hash);
      return ok(undefined);
    });

/** The QR the member's phone shows the kiosk, good for a minute. */
export const issueKioskQr =
  (deps: Pick<Deps, 'uow' | 'clock' | 'feedSecret'>) =>
  (caller: Caller): Promise<Result<{ token: string; expiresAt: Instant; personId: PersonId }>> =>
    transact(deps, caller.tenantId, async (tx) => {
      if (caller.personId === null) return forbidden();
      if ((await tx.members.get(caller.personId)) === null) return notFound('Member');
      const expiresAt = new Date(
        ms(deps.clock.instant()) + QR_SECONDS * 1000,
      ).toISOString() as Instant;
      const body = Buffer.from(
        JSON.stringify({ t: caller.tenantId, p: caller.personId, e: expiresAt }),
      ).toString('base64url');
      return ok({
        token: `${QR_PREFIX}${body}.${qrSignature(deps.feedSecret, body)}`,
        expiresAt,
        personId: caller.personId,
      });
    });

/* ---------------------------------------------------------------- kiosk -- */

/** What the kiosk shows at its top: its own name and location. Proves the token is live. */
export const kioskStatus =
  (deps: Pick<Deps, 'uow'>) =>
  (
    token: string,
    deviceId: string,
  ): Promise<Result<{ name: string; locationName: string | null }>> =>
    asKiosk(deps, token, deviceId, async (tx, device) => {
      const location = await tx.locations.get(device.locationKey);
      return ok({ name: device.name, locationName: location?.name ?? null });
    });

/** Who tapped, by first name, and what the tap would do now. Writes nothing. */
export const kioskIdentify =
  (deps: Pick<Deps, 'uow' | 'clock' | 'feedSecret'>) =>
  (
    token: string,
    deviceId: string,
    credential: KioskCredential,
  ): Promise<Result<{ firstName: string; kind: PunchKind }>> =>
    asKiosk(deps, token, deviceId, async (tx) => {
      const now = deps.clock.instant();
      const member = await holderOf(tx, deps.feedSecret, credential, now);
      if (member === null) return err(unknownCredential());
      const punches = await tx.attendance.punches(member.personId);
      return ok({ firstName: member.firstName, kind: kindAt(punches, now, member.timeZone) });
    });

export interface KioskPunchItem {
  /** The kiosk's own counter, never reused. */
  readonly sequence: number;
  /** The tap, on the kiosk's clock. */
  readonly at: Instant;
  readonly credential: KioskCredential;
}

export interface KioskPunchResult {
  readonly sequence: number;
  readonly outcome: 'punched' | 'duplicate' | 'refused';
  readonly kind?: PunchKind;
  readonly firstName?: string;
  readonly at?: Instant;
  readonly code?: string;
}

/**
 * The kiosk's queue, sent whenever it can: online a tap at a time, after a
 * night offline all of them. Each tap is punched at its own instant, read
 * against the clock as it stood then; a sequence at or below the last synced
 * is a replay and punches nothing. The kiosk's clock is compared with ours at
 * sending: beyond `CLOCK_SKEW_SECONDS` its instants are kept, each punch
 * carries the skew, and HR hears of it once a day per kiosk. One refused tap
 * does not hold up the others.
 */
export const kioskPunches =
  (deps: KioskDeps) =>
  async (
    token: string,
    deviceId: string,
    batch: { readonly sentAt: Instant; readonly punches: readonly KioskPunchItem[] },
  ): Promise<Result<{ results: KioskPunchResult[] }>> => {
    const now = deps.clock.instant();
    const skew = clockSkew(batch.sentAt, now);
    const flagged = Math.abs(skew) > CLOCK_SKEW_SECONDS ? skew : null;
    const synced = await asKiosk(deps, token, deviceId, async (tx, device) => {
      const fresh = unseen(device.lastSequence, batch.punches);
      const results = new Map<number, KioskPunchResult>(
        batch.punches.map((p) => [p.sequence, { sequence: p.sequence, outcome: 'duplicate' }]),
      );
      let punched = 0;
      for (const item of fresh) {
        const member = await holderOf(tx, deps.feedSecret, item.credential, item.at);
        if (member === null) {
          results.set(item.sequence, {
            sequence: item.sequence,
            outcome: 'refused',
            code: unknownCredential().code,
          });
          continue;
        }
        const clock = AttendanceClock.of({
          tenantId: tx.tenantId,
          personId: member.personId,
          timeZone: member.timeZone,
          punches: await tx.attendance.punches(member.personId),
        });
        const kind = kindAt(clock.punches, item.at, member.timeZone);
        const done = clock.punch({
          id: deps.newId(),
          input: PunchInput.parse({
            kind,
            source: 'kiosk',
            // A kiosk is at the office, by definition.
            workModel: 'office',
            at: item.at,
            deviceId,
          }),
          actor: { kind: 'integration', integrationId: deviceId, provider: 'kiosk' },
          correlationId: deps.newId(),
          clock: deps.clock,
          clockSkewSeconds: flagged,
        });
        if (!done.ok) {
          results.set(item.sequence, {
            sequence: item.sequence,
            outcome: 'refused',
            code: done.error.code,
          });
          continue;
        }
        await tx.attendance.appendPunch(member.personId, done.value);
        await tx.outbox.publish(clock.drainEvents());
        punched++;
        results.set(item.sequence, {
          sequence: item.sequence,
          outcome: 'punched',
          kind,
          firstName: member.firstName,
          at: item.at,
        });
      }
      await tx.kiosks.saveDevice({
        ...device,
        lastSeenAt: now,
        lastSequence: Math.max(device.lastSequence, ...fresh.map((i) => i.sequence)),
      });
      return ok({
        results: [...results.values()].toSorted((a, b) => a.sequence - b.sequence),
        punched,
        tenantId: tx.tenantId,
      });
    });
    if (!synced.ok) return synced;
    if (flagged !== null && synced.value.punched > 0) {
      await deps.notifier.notify(
        synced.value.tenantId,
        'hr',
        { kind: 'kiosk_clock_skew', deviceId, seconds: flagged },
        `kiosk-skew:${deviceId}:${now.slice(0, 10)}`,
      );
    }
    return ok({ results: synced.value.results });
  };
