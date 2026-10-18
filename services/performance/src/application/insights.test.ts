import { describe, expect, it } from 'vitest';

import type { Review } from '../domain/review.js';
import { insightsOf } from './cycles.js';
import type { Person } from './members.js';

const review = (subjectId: string, status: string, due: string, submitted = false, kind = 'self') =>
  ({
    kind,
    subjectId,
    status,
    due,
    detached: null,
    hidden: false,
    submitted: submitted ? [{ at: '2026-10-01T00:00:00Z' }] : [],
  }) as unknown as Review;
const person = (personId: string, department: string | null) =>
  ({ personId, department }) as unknown as Person;

describe('insightsOf', () => {
  it('counts every review once, lateness first, and ranks the departments least done first', () => {
    const got = insightsOf(
      [
        review('a', 'completed', '2026-10-10', true),
        review('a', 'in_progress', '2026-10-30'),
        review('b', 'not_started', '2026-10-01'),
        review('b', 'not_started', '2026-10-30'),
        review('c', 'cancelled', '2026-10-30'),
      ],
      [person('a', 'Sales'), person('b', 'Ops'), person('c', 'Ops')],
      '2026-10-18' as never,
    );
    expect(got.status).toEqual({ submitted: 1, overdue: 1, started: 1, waiting: 1 });
    expect(got.statusByKind.submitted).toEqual({ self: 1 });
    expect(got.byDepartment.map((d) => d.department)).toEqual(['Ops', 'Sales']);
    expect(got.byDepartment[0]).toMatchObject({ overdue: 1, waiting: 1, submitted: 0 });
  });
});
