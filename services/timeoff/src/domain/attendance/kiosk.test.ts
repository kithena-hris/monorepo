import { describe, expect, it } from 'vitest';
import type { Instant } from '@kithena/contracts';

import type { Punch } from './clock.js';
import { CLOCK_SKEW_SECONDS, clockSkew, kindAt, unseen } from './kiosk.js';

const at = (s: string) => s as Instant;
const p = (kind: Punch['kind'], when: string, id = when): Punch => ({
  id,
  at: at(when),
  recordedAt: at(when),
  kind,
  source: 'web',
  workModel: 'office',
  deviceId: null,
  insideOfficeArea: null,
  supersedes: null,
  reason: null,
});

describe('a kiosk punch (PRD §11.9)', () => {
  describe('what a tap means', () => {
    it('clocks in somebody who is out, and out somebody who is in', () => {
      expect(kindAt([], at('2026-10-01T06:52:00Z'), 'Europe/Madrid')).toBe('in');
      expect(
        kindAt([p('in', '2026-10-01T06:52:00Z')], at('2026-10-01T15:30:00Z'), 'Europe/Madrid'),
      ).toBe('out');
    });

    it('ends a break for somebody coming back through the door', () => {
      const punches = [p('in', '2026-10-01T06:52:00Z'), p('break_start', '2026-10-01T11:00:00Z')];
      expect(kindAt(punches, at('2026-10-01T11:40:00Z'), 'Europe/Madrid')).toBe('break_end');
    });

    it('reads the clock as it stood at the tap, not as it stands at the sync', () => {
      // Taken offline at 08:52; synced after a web clock-in at 09:10 had already landed.
      const punches = [p('in', '2026-10-01T07:10:00Z')];
      expect(kindAt(punches, at('2026-10-01T06:52:00Z'), 'Europe/Madrid')).toBe('in');
    });
  });

  describe('the sequence', () => {
    it('takes only what is newer than the last synced, in order', () => {
      const items = [{ sequence: 7 }, { sequence: 5 }, { sequence: 6 }, { sequence: 4 }];
      expect(unseen(5, items).map((i) => i.sequence)).toEqual([6, 7]);
    });

    it('a replayed batch is nothing new', () => {
      expect(unseen(7, [{ sequence: 6 }, { sequence: 7 }])).toEqual([]);
    });
  });

  describe('clock skew', () => {
    it('is how far the device’s clock is from ours when it sends, in whole seconds', () => {
      expect(clockSkew(at('2026-10-01T09:00:00Z'), at('2026-10-01T09:04:30Z'))).toBe(270);
      expect(clockSkew(at('2026-10-01T09:05:00Z'), at('2026-10-01T09:00:00Z'))).toBe(-300);
    });

    it('a night offline is not skew: the device sends with its own time of sending', () => {
      expect(clockSkew(at('2026-10-02T07:00:01Z'), at('2026-10-02T07:00:03Z'))).toBe(2);
    });

    it('flags beyond two minutes either way', () => {
      expect(CLOCK_SKEW_SECONDS).toBe(120);
    });
  });
});
