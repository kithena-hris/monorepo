// @vitest-environment jsdom
import { TooltipProvider } from '@reach/ui';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { framed } from '../frame';
import { serveAndHydrate } from '../test/hydrate';
import { Integrations as IntegrationsScreen } from './integrations/integrations';
import { Organisation as OrganisationScreen, type OrganisationState } from './organisation';

/**
 * People's settings as the shell serves them: the tab the address names is in
 * the server's HTML, and hydrating it with the same props changes nothing.
 */

const Organisation = framed(OrganisationScreen);
const Integrations = framed(IntegrationsScreen);
const done = () => Promise.resolve({ ok: true as const });
const ACME = '00000000-0000-4000-8000-0000000000e1';

const organisation: OrganisationState = {
  canManage: true,
  settings: {
    defaultTimeZone: 'Europe/Madrid',
    cohortMinimum: 10,
    slug: 'acme',
    displayName: 'Acme',
  },
  legalEntities: [
    { id: ACME, name: 'Acme Iberia SL', country: 'ES', timeZone: 'Europe/Madrid', archived: false },
  ],
  locations: [
    {
      id: 'l1',
      legalEntityId: ACME,
      name: 'Madrid office',
      country: 'ES',
      timeZone: 'Europe/Madrid',
      zones: [{ effectiveFrom: '2026-01-01', timeZone: 'Europe/Madrid' }],
      archived: false,
    },
  ],
  numberings: [{ legalEntityId: ACME, prefix: 'ES-', digits: 5, nextValue: 42 }],
  countries: [{ code: 'ES', name: 'Spain' }],
  timeZones: ['Europe/Madrid'],
  retentionFloors: [],
  packs: [{ country: 'ES', countryName: 'Spain', fields: 3, sections: [{ label: 'Identity' }] }],
  reminders: { cadence: 'Then once a week', window: '09:00 to 18:00', inChat: false },
};

const orgProps = (tab: string) => ({
  load: { status: 'ready' as const, data: organisation },
  tab,
  onTabChange: () => undefined,
  onUpdateSettings: done,
  onCreateEntity: done,
  onUpdateEntity: done,
  onCreateLocation: done,
  onUpdateLocation: done,
  onChangeZone: done,
  onSetNumbering: done,
});

describe('People settings on the server', () => {
  it.each([
    ['entities', 'Acme Iberia SL'],
    ['locations', 'Madrid office'],
    ['numbering', 'ES-00042'],
    ['country-packs', 'Identity'],
    ['reminders', 'Then once a week'],
  ])('serves Organisation’s %s tab already open, and hydrates it unchanged', async (tab, text) => {
    const { html, errors } = await serveAndHydrate(createElement(Organisation, orgProps(tab)));
    expect(html).toContain(text);
    expect(errors).toEqual([]);
  });

  it('serves the Integrations tab its address names, and hydrates it unchanged', async () => {
    const element = createElement(
      TooltipProvider,
      null,
      createElement(Integrations, {
        load: {
          status: 'ready',
          data: { schemaVersion: 1, deliveries24h: 0, events: [], fields: [], endpoints: [] },
        },
        tab: 'webhooks',
        onTabChange: () => undefined,
        onCreate: () => Promise.resolve({ ok: true as const, secret: 's' }),
        onUpdate: done,
        onRotate: () => Promise.resolve({ ok: true as const, secret: 's' }),
      }),
    );
    const { html, errors } = await serveAndHydrate(element);
    expect(html).toContain('No third-party tools connected');
    expect(errors).toEqual([]);
  });
});
