import { describe, expect, it } from 'vitest';

import type { NudgeMailer } from '../ports.js';
import { recordingWriter, shown } from '../testing/assist.js';
import { caller, d, hr, MADRID, people, TENANT, world } from '../testing/world.js';
import { nudgePreview, sendNudges } from './nudge.js';

/**
 * Nudges (T28) on Platform's 15 October: nobody has had a day off since
 * June and everybody has their 25 days. Madrid's Tuesday 8 December bridges
 * nothing in 2026 (Monday 7 is itself a holiday), so the second test gives
 * the office a Thursday of its own.
 */

const include = { balance: true, bridge: true, losing: true };
const AT = '2026-10-15T07:00:00.000Z';

function recording(): NudgeMailer & { sent: Parameters<NudgeMailer['send']>[1][] } {
  const sent: Parameters<NudgeMailer['send']>[1][] = [];
  return {
    sent,
    send: (_tenant, message) => {
      sent.push(message);
      return Promise.resolve();
    },
  };
}

describe('nudges (TOF-098)', () => {
  it('previews one person’s message with only their own figures and day', async () => {
    const app = world(AT, { withGrant: true });
    const preview = await nudgePreview(app.deps)(hr, include);
    if (!preview.ok) throw new Error(preview.error.message);
    expect(preview.value.recipients).toHaveLength(7);
    expect(preview.value.recipients.every((r) => r.reachable)).toBe(true);
    expect(preview.value.preview).toEqual({
      personId: people.adam,
      displayName: 'Adam Novak',
      heading: 'Adam, you haven’t had a day off since June',
      lede: 'You have 25 days left this year. 20 of them would be lost on 31 December if they stay unbooked. A few days away do more than they look. Nobody else sees this message.',
      ai: false,
    });
    const plain = await nudgePreview(app.deps)(hr, {
      balance: false,
      bridge: false,
      losing: false,
    });
    expect(plain.ok && plain.value.preview?.lede).toBe(
      'A few days away do more than they look. Nobody else sees this message.',
    );
  });

  it('sends each person their own message through messaging, and counts who it cannot reach', async () => {
    const app = world(AT, { withGrant: true });
    const s = app.state(TENANT);
    const omar = s.members.get(people.omar);
    if (omar === undefined) throw new Error('no Omar');
    s.members.set(people.omar, { ...omar, workEmail: null });
    s.layers.set('acme_day', {
      key: 'acme_day',
      name: 'Acme',
      level: 'city',
      weekendRule: 'none',
      holidays: [{ date: d('2026-11-26'), name: 'Acme Day' }],
    });
    s.assignments.set(MADRID, [...(s.assignments.get(MADRID) ?? []), 'acme_day']);
    const mailer = recording();
    const sent = await sendNudges({ ...app.deps, mailer })(hr, {
      include,
      companyName: 'Acme Corp',
      appOrigin: 'https://acme.app.kithena.com/time-off/insights/what-changed',
    });
    expect(sent).toEqual({ ok: true, value: { sent: 6, unreachable: 1, failed: 0 } });
    expect(mailer.sent[0]?.lede).toContain('Taking Fri 27 Nov gives you 4 days off with Acme Day.');
    const adam = mailer.sent.find((m) => m.email === 'adam@acme.example');
    expect(adam).toMatchObject({
      companyName: 'Acme Corp',
      url: 'https://acme.app.kithena.com/time-off/request?from=2026-11-27&to=2026-11-27',
      dedupeKey: `nudge/${people.adam}/2026-10-15`,
    });
    // Nobody's message names anybody else.
    for (const m of mailer.sent) {
      const others = ['Adam', 'Marco', 'Yuki', 'Leo', 'Hana', 'Ravi'].filter(
        (name) => !m.email.startsWith(name.toLowerCase()),
      );
      for (const name of others) expect(`${m.heading} ${m.lede}`).not.toContain(name);
    }
  });

  it('asks the assistant with only the recipient’s own figures, and keeps the closing promise', async () => {
    const app = world(AT, { withGrant: true });
    const writer = recordingWriter((key) =>
      key === 'heading'
        ? '{who}, it has been a while since June'
        : 'You still have 25 days this year, and 20 would go on 31 December.',
    );
    const mailer = recording();
    const sent = await sendNudges({ ...app.deps, mailer, writer })(hr, {
      include,
      companyName: 'Acme Corp',
      appOrigin: 'https://acme.app.kithena.com',
    });
    expect(sent).toEqual({ ok: true, value: { sent: 7, unreachable: 0, failed: 0 } });
    expect(mailer.sent.find((m) => m.email === 'adam@acme.example')).toMatchObject({
      heading: 'Adam, it has been a while since June',
      lede: 'You still have 25 days this year, and 20 would go on 31 December. Nobody else sees this message.',
    });
    // One ask per recipient, each carrying their own figures and nobody at all by name.
    expect(writer.asks).toHaveLength(7);
    const prompts = shown(writer.asks);
    for (const id of Object.values(people)) expect(prompts).not.toContain(id);
    for (const name of ['Adam', 'Marco', 'Yuki', 'Leo', 'Hana', 'Ravi', 'Omar', 'Platform', '@'])
      expect(prompts).not.toContain(name);
    expect(writer.asks[0]?.facts).toEqual({
      who: '{who}',
      noDayOffSince: 'June',
      daysLeftThisYear: '25',
      daysLostIfUnbooked: '20',
      lostOn: '31 December',
    });

    // A line with a figure the facts do not hold is the template; the preview says which.
    const wrong = recordingWriter(() => 'Take 9 days off soon.');
    const preview = await nudgePreview({ ...app.deps, writer: wrong })(hr, include);
    expect(preview.ok && preview.value.preview).toMatchObject({
      heading: 'Adam, you haven’t had a day off since June',
      ai: false,
    });
  });

  it('refuses without messaging, a link that is no origin, and anybody but HR or a manager', async () => {
    const app = world(AT, { withGrant: true });
    const input = { include, companyName: 'Acme Corp', appOrigin: 'https://acme.app.kithena.com' };
    expect(await sendNudges(app.deps)(hr, input)).toMatchObject({
      ok: false,
      error: { code: 'NUDGES_UNAVAILABLE' },
    });
    const mailer = recording();
    expect(
      await sendNudges({ ...app.deps, mailer })(hr, { ...input, appOrigin: 'javascript:alert(1)' }),
    ).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
    expect(await sendNudges({ ...app.deps, mailer })(caller(people.adam), input)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(mailer.sent).toEqual([]);
  });
});
