import { describe, expect, it } from 'vitest';
import { Instant, LocationKey } from '@kithena/contracts';

import { caller, hr, MADRID, people, TENANT, world } from '../testing/world.js';
import {
  issueKioskQr,
  kioskDevices,
  kioskIdentify,
  kioskPunches,
  kioskStatus,
  registerKiosk,
  revokeKiosk,
  setKioskCredential,
} from './kiosk.js';

const adam = caller(people.adam);
const at = (s: string) => Instant.parse(s);

async function setup() {
  const app = world('2026-10-01T06:50:00.000Z');
  const registered = await registerKiosk(app.deps)(hr, {
    name: 'Madrid office, main entrance',
    locationKey: MADRID,
  });
  if (!registered.ok) throw new Error(registered.error.message);
  const { deviceId, token } = registered.value;
  const badge = await setKioskCredential(app.deps)(hr, people.adam, 'badge', '0004817265');
  const pin = await setKioskCredential(app.deps)(adam, people.adam, 'pin', '482193');
  expect([badge.ok, pin.ok]).toEqual([true, true]);
  return { app, deviceId, token };
}

describe('kiosk devices (PRD §11.9, TOF-107)', () => {
  describe('registering', () => {
    it('only HR registers one, and its token is shown once and kept as a hash', async () => {
      const app = world();
      expect(
        await registerKiosk(app.deps)(adam, { name: 'Door', locationKey: MADRID }),
      ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });

      const r = await registerKiosk(app.deps)(hr, { name: 'Door', locationKey: MADRID });
      if (!r.ok) throw new Error(r.error.message);
      const { deviceId, token } = r.value;
      const stored = app.state(TENANT).kiosks.get(deviceId);
      expect(stored?.tokenHash).toMatch(/^[0-9a-f]{64}$/u);
      expect(JSON.stringify(stored)).not.toContain(token);
      expect(token.startsWith('kk_')).toBe(true);

      const listed = await kioskDevices(app.deps)(hr);
      expect(listed.ok && listed.value.map((k) => k.name)).toEqual(['Door']);
      expect(listed.ok && JSON.stringify(listed.value)).not.toContain('tokenHash');
    });

    it('a revoked kiosk’s token stops working at once', async () => {
      const { app, deviceId, token } = await setup();
      expect((await kioskStatus(app.deps)(token, deviceId)).ok).toBe(true);
      expect((await revokeKiosk(app.deps)(hr, deviceId)).ok).toBe(true);
      expect(await kioskStatus(app.deps)(token, deviceId)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_TOKEN' },
      });
    });

    it('a token is for its own device: another device’s address refuses it', async () => {
      const { app, token } = await setup();
      const other = await registerKiosk(app.deps)(hr, {
        name: 'Back door',
        locationKey: LocationKey.parse('madrid'),
      });
      if (!other.ok) throw new Error(other.error.message);
      expect(await kioskStatus(app.deps)(token, other.value.deviceId)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_TOKEN' },
      });
      expect(await kioskStatus(app.deps)('kk_nonsense', other.value.deviceId)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_TOKEN' },
      });
    });
  });

  describe('credentials', () => {
    it('a badge is HR’s to give; a PIN is the member’s own or HR’s', async () => {
      const { app } = await setup();
      expect(
        await setKioskCredential(app.deps)(adam, people.adam, 'badge', '0000000001'),
      ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      expect(await setKioskCredential(app.deps)(adam, people.omar, 'pin', '111111')).toMatchObject({
        ok: false,
        error: { code: 'FORBIDDEN' },
      });
    });

    it('two people cannot share a badge or a PIN', async () => {
      const { app } = await setup();
      expect(await setKioskCredential(app.deps)(hr, people.omar, 'pin', '482193')).toMatchObject({
        ok: false,
        error: { code: 'CREDENTIAL_TAKEN' },
      });
    });

    it('keeps only a keyed hash, never the badge number or the PIN', async () => {
      const { app } = await setup();
      const kept = JSON.stringify([...app.state(TENANT).credentials.keys()]);
      expect(kept).not.toContain('0004817265');
      expect(kept).not.toContain('482193');
    });
  });

  describe('identifying', () => {
    it('answers the first name and what the tap would do, nothing more', async () => {
      const { app, deviceId, token } = await setup();
      const who = await kioskIdentify(app.deps)(token, deviceId, {
        kind: 'badge',
        value: '0004817265',
      });
      expect(who).toEqual({ ok: true, value: { firstName: 'Adam', kind: 'in' } });
    });

    it('an unknown badge is refused without saying whose it might be', async () => {
      const { app, deviceId, token } = await setup();
      expect(
        await kioskIdentify(app.deps)(token, deviceId, { kind: 'badge', value: '999' }),
      ).toMatchObject({ ok: false, error: { code: 'UNKNOWN_CREDENTIAL' } });
    });

    it('a personal QR from the phone works for a minute and then expires', async () => {
      const { app, deviceId, token } = await setup();
      const qr = await issueKioskQr(app.deps)(adam);
      if (!qr.ok) throw new Error(qr.error.message);
      expect(qr.value.expiresAt).toBe('2026-10-01T06:51:00.000Z');
      expect(
        await kioskIdentify(app.deps)(token, deviceId, { kind: 'qr', value: qr.value.token }),
      ).toMatchObject({ ok: true, value: { firstName: 'Adam' } });
      app.clock.set('2026-10-01T06:52:00.000Z');
      expect(
        await kioskIdentify(app.deps)(token, deviceId, { kind: 'qr', value: qr.value.token }),
      ).toMatchObject({ ok: false, error: { code: 'UNKNOWN_CREDENTIAL' } });
    });
  });

  describe('punching, online and offline', () => {
    it('clocks in at the tap’s instant, from the kiosk, and names the first name', async () => {
      const { app, deviceId, token } = await setup();
      app.clock.set('2026-10-01T06:52:06.000Z');
      const synced = await kioskPunches(app.deps)(token, deviceId, {
        sentAt: at('2026-10-01T06:52:05.000Z'),
        punches: [
          {
            sequence: 1,
            at: at('2026-10-01T06:52:00.000Z'),
            credential: { kind: 'pin', value: '482193' },
          },
        ],
      });
      expect(synced).toEqual({
        ok: true,
        value: {
          results: [
            {
              sequence: 1,
              outcome: 'punched',
              kind: 'in',
              firstName: 'Adam',
              at: '2026-10-01T06:52:00.000Z',
            },
          ],
        },
      });
      const [p] = app.state(TENANT).punches.get(people.adam) ?? [];
      expect(p).toMatchObject({
        kind: 'in',
        source: 'kiosk',
        deviceId,
        at: '2026-10-01T06:52:00.000Z',
        recordedAt: '2026-10-01T06:52:06.000Z',
      });
      expect(p?.clockSkewSeconds ?? null).toBeNull();
      expect(app.state(TENANT).kiosks.get(deviceId)?.lastSequence).toBe(1);
    });

    it('a night offline syncs in order, and a replayed batch punches nothing twice', async () => {
      const { app, deviceId, token } = await setup();
      app.clock.set('2026-10-01T16:00:00.000Z');
      const batch = {
        sentAt: at('2026-10-01T16:00:00.000Z'),
        punches: [
          {
            sequence: 2,
            at: at('2026-10-01T15:31:00.000Z'),
            credential: { kind: 'badge' as const, value: '0004817265' },
          },
          {
            sequence: 1,
            at: at('2026-10-01T06:52:00.000Z'),
            credential: { kind: 'badge' as const, value: '0004817265' },
          },
        ],
      };
      const first = await kioskPunches(app.deps)(token, deviceId, batch);
      expect(first.ok && first.value.results.map((r) => [r.sequence, r.outcome, r.kind])).toEqual([
        [1, 'punched', 'in'],
        [2, 'punched', 'out'],
      ]);
      const again = await kioskPunches(app.deps)(token, deviceId, batch);
      expect(again.ok && again.value.results.map((r) => r.outcome)).toEqual([
        'duplicate',
        'duplicate',
      ]);
      expect(app.state(TENANT).punches.get(people.adam)).toHaveLength(2);
    });

    it('keeps a skewed kiosk’s instant, flags the punch and tells HR once', async () => {
      const { app, deviceId, token } = await setup();
      // The tablet's clock is five minutes slow.
      app.clock.set('2026-10-01T07:00:00.000Z');
      const send = (sequence: number, when: string) =>
        kioskPunches(app.deps)(token, deviceId, {
          sentAt: at('2026-10-01T06:55:00.000Z'),
          punches: [{ sequence, at: at(when), credential: { kind: 'pin', value: '482193' } }],
        });
      await send(1, '2026-10-01T06:54:00.000Z');
      await send(2, '2026-10-01T06:54:30.000Z');
      const punches = app.state(TENANT).punches.get(people.adam) ?? [];
      expect(punches[0]).toMatchObject({ at: '2026-10-01T06:54:00.000Z', clockSkewSeconds: 300 });
      expect(app.notices.filter((n) => n.notice.kind === 'kiosk_clock_skew')).toEqual([
        expect.objectContaining({
          to: 'hr',
          notice: { kind: 'kiosk_clock_skew', deviceId, seconds: 300 },
        }),
      ]);
    });

    it('one refused tap does not stop the rest of the batch', async () => {
      const { app, deviceId, token } = await setup();
      app.clock.set('2026-10-01T07:00:00.000Z');
      const synced = await kioskPunches(app.deps)(token, deviceId, {
        sentAt: at('2026-10-01T07:00:00.000Z'),
        punches: [
          {
            sequence: 1,
            at: at('2026-10-01T06:52:00.000Z'),
            credential: { kind: 'pin', value: '000000' },
          },
          {
            sequence: 2,
            at: at('2026-10-01T06:53:00.000Z'),
            credential: { kind: 'pin', value: '482193' },
          },
        ],
      });
      expect(synced.ok && synced.value.results.map((r) => [r.outcome, r.code ?? null])).toEqual([
        ['refused', 'UNKNOWN_CREDENTIAL'],
        ['punched', null],
      ]);
    });
  });
});
