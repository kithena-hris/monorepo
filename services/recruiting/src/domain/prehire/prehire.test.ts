import { CalendarDate } from '@kithena/contracts';
import { describe, expect, it } from 'vitest';

import { cancelPrehire, openPrehire, startPrehire } from './prehire.js';

const open = () => openPrehire('a1', 'c1', CalendarDate.parse('2026-12-01'), ['right_to_work']);

describe('a pre-hire on their first day', () => {
  it('is started, whatever conditions are left, and stays started', () => {
    const started = startPrehire(open());
    expect(started.ok && started.value.state).toBe('started');
    const again = started.ok ? startPrehire(started.value) : null;
    expect(again?.ok && again.value.state).toBe('started');
  });

  it('is never started once cancelled', () => {
    const cancelled = cancelPrehire(open(), 'reneged');
    const started = cancelled.ok ? startPrehire(cancelled.value) : null;
    expect(started?.ok).toBe(false);
  });
});
