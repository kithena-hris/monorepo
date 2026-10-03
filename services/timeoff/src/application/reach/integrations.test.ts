import { describe, expect, it } from 'vitest';

import type { CalendarPort, ChatPort, Deps, ProviderAnswer } from '../ports.js';
import { caller, hr, MADRID, people, TENANT, world } from '../testing/world.js';
import { registerKiosk } from '../attendance/kiosk.js';
import {
  completeIntegration,
  connectIntegration,
  disconnectIntegration,
  integrationsScreen,
} from './integrations.js';

/** A calendar adapter with credentials, granting access through a consent page. */
const microsoft = (): CalendarPort => ({
  provider: 'microsoft',
  configured: true,
  connectUrl: (state, redirect) =>
    `https://login.example/adminconsent?state=${state}&redirect_uri=${redirect}`,
  complete: (answer: ProviderAnswer) =>
    Promise.resolve({ config: { directory: answer['tenant'] ?? '' }, secret: null }),
  put: () => Promise.resolve(),
  remove: () => Promise.resolve(),
});

/** Google's: access granted in the company's own admin console, so nothing to visit. */
const google = (): CalendarPort => ({ ...microsoft(), provider: 'google', connectUrl: () => null });

const slackWithoutCredentials = (): ChatPort => ({
  provider: 'slack',
  configured: false,
  connectUrl: () => null,
  complete: () => Promise.reject(new Error('not configured')),
  setStatus: () => Promise.resolve(),
  askApproval: () => Promise.resolve(),
  action: () => null,
});

function setup() {
  const app = world();
  const deps: Deps = {
    ...app.deps,
    reach: {
      calendars: [google(), microsoft()],
      chats: [slackWithoutCredentials()],
      publicUrl: 'https://timeoff.example',
    },
  };
  return { app, deps };
}

const BACK = 'https://acme.kithena.test/settings/time-off/integrations';

describe('integrations (T35, TOF-109)', () => {
  it('lists calendars and chat apps, what each needs, and the modules that would read Time Off', async () => {
    const { deps } = setup();
    await registerKiosk(deps)(hr, { name: 'Main entrance', locationKey: MADRID });
    const screen = await integrationsScreen(deps)(hr);
    if (!screen.ok) throw new Error(screen.error.message);
    expect(
      screen.value.integrations.map((i) => [
        i.provider,
        i.kind,
        i.available,
        i.configured,
        i.connected,
      ]),
    ).toEqual([
      ['google', 'calendar', true, true, false],
      ['microsoft', 'calendar', true, true, false],
      ['slack', 'chat', true, false, false],
      ['teams', 'chat', false, false, false],
    ]);
    expect(screen.value.modules.map((m) => m.key)).toEqual(['payroll', 'benefits', 'projects']);
    expect(screen.value.modules[0]?.events).toContain('timeoff.period.closed');
    expect(screen.value.kiosks.map((k) => k.name)).toEqual(['Main entrance']);
    expect(screen.value.locations).toEqual([{ locationKey: 'madrid', name: null }]);
    expect(screen.value.packs.map((p) => [p.country, p.reviewed, p.inUse])).toEqual([
      ['ES', false, true],
      ['DE', false, false],
      ['GB', false, false],
    ]);
  });

  it('is HR’s alone', async () => {
    const { deps } = setup();
    expect(await integrationsScreen(deps)(caller(people.adam))).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(await connectIntegration(deps)(caller(people.adam), 'google', BACK)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it('connects at once where access is granted outside Kithena', async () => {
    const { app, deps } = setup();
    expect(await connectIntegration(deps)(hr, 'google', BACK)).toEqual({
      ok: true,
      value: { url: null },
    });
    expect(app.state(TENANT).integrations.get('google')).toMatchObject({
      provider: 'google',
      connectedBy: hr.accountId,
    });
  });

  it('sends HR to the consent page, and the signed state brings the answer back to the company', async () => {
    const { app, deps } = setup();
    const started = await connectIntegration(deps)(hr, 'microsoft', BACK);
    if (!started.ok || started.value.url === null) throw new Error('no consent page');
    const url = new URL(started.value.url);
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://timeoff.example/v1/timeoff/integrations/microsoft/callback',
    );
    const state = url.searchParams.get('state') ?? '';

    const done = await completeIntegration(deps)('microsoft', { state, tenant: 'contoso-dir' });
    expect(done).toEqual({ ok: true, value: { location: `${BACK}?connected=microsoft` } });
    expect(app.state(TENANT).integrations.get('microsoft')?.config).toEqual({
      directory: 'contoso-dir',
    });
  });

  it('refuses an answer whose state was not signed here, or is for another provider', async () => {
    const { deps } = setup();
    const started = await connectIntegration(deps)(hr, 'microsoft', BACK);
    const state = started.ok ? new URL(started.value.url ?? '').searchParams.get('state') : null;
    expect(await completeIntegration(deps)('google', { state: state ?? '' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE' },
    });
    expect(await completeIntegration(deps)('microsoft', { state: 'forged.state' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE' },
    });
  });

  it('says so, and goes back, when the provider was refused access', async () => {
    const { deps } = setup();
    const started = await connectIntegration(deps)(hr, 'microsoft', BACK);
    const state = started.ok ? new URL(started.value.url ?? '').searchParams.get('state') : '';
    expect(
      await completeIntegration(deps)('microsoft', { state: state ?? '', error: 'access_denied' }),
    ).toEqual({ ok: true, value: { location: `${BACK}?refused=microsoft` } });
  });

  it('will not connect a provider without credentials, and forgets one on disconnecting', async () => {
    const { app, deps } = setup();
    expect(await connectIntegration(deps)(hr, 'slack', BACK)).toMatchObject({
      ok: false,
      error: { code: 'NOT_CONFIGURED' },
    });
    await connectIntegration(deps)(hr, 'google', BACK);
    expect((await disconnectIntegration(deps)(hr, 'google')).ok).toBe(true);
    expect(app.state(TENANT).integrations.has('google')).toBe(false);
  });
});
