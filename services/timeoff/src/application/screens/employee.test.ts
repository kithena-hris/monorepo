import { describe, expect, it } from 'vitest';
import { DateSpan, LeaveTypeKey } from '@kithena/contracts';

import { answerParental } from '../parental/parental.js';
import { previewRequest, sendRequest } from '../request/request.js';
import { caller, people, world } from '../testing/world.js';
import { viewer } from './manager.js';
import { balanceLedger, myRequests, requestPanel } from './employee.js';

const vacation = LeaveTypeKey.parse('vacation');

/**
 * An account no member holds: somebody People has not hired (a provisional
 * record, the founder who signed the company up), so Time Off has no member
 * for them and the router forwards no person. Every screen that is somebody's
 * own says so in words, never "Not permitted".
 */
const nobody = caller(null, '0000000b-0000-4000-8000-000000000001');

describe('an account Time Off holds no member for', () => {
  it('is told why it cannot request time off, on every screen of its own', async () => {
    const app = world('2026-10-01T07:00:00.000Z');
    const span = DateSpan.parse({ from: '2026-10-19', to: '2026-10-23' });
    const answers = [
      await requestPanel(app.deps)(nobody, {}),
      await myRequests(app.deps)(nobody, { tab: 'upcoming' }),
      await balanceLedger(app.deps)(nobody, { leaveTypeKey: vacation }),
      await previewRequest(app.deps)(nobody, { leaveTypeKey: vacation, span }),
      await sendRequest(app.deps)(nobody, { leaveTypeKey: vacation, span }),
      // The answers are never read: the caller is refused first.
      await answerParental(app.deps)(nobody, {} as never),
    ];
    for (const answer of answers) {
      expect(answer).toMatchObject({
        ok: false,
        error: { code: 'FORBIDDEN', message: expect.stringMatching(/not.*employee/iu) },
      });
    }
  });

  it('says the same when the router named a person Time Off does not hold', async () => {
    const app = world('2026-10-01T07:00:00.000Z');
    const stranger = caller(
      people.adam.replace(/-000000000002$/u, '-000000000099') as typeof people.adam,
    );
    expect(await requestPanel(app.deps)(stranger, {})).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN', message: expect.stringMatching(/not.*employee/iu) },
    });
  });

  it('is no member to the shell, which then offers no Request', async () => {
    const app = world('2026-10-01T07:00:00.000Z');
    expect(await viewer(app.deps)(nobody)).toMatchObject({ ok: true, value: { member: false } });
    expect(await viewer(app.deps)(caller(people.adam))).toMatchObject({
      ok: true,
      value: { member: true },
    });
  });
});
