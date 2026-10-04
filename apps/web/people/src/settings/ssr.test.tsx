// @vitest-environment jsdom
import { TooltipProvider } from '@reach/ui';
import { createElement } from 'react';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { framed } from '../frame';
import { serveAndHydrate } from '../test/hydrate';
import { FieldRegistry as FieldRegistryScreen } from './field-registry';
import { Integrations as IntegrationsScreen } from './integrations/integrations';
import type { RegistryDraft } from './model';
import { Organisation as OrganisationScreen, type OrganisationState } from './organisation';

/**
 * People's settings as the shell serves them: the tab the address names is in
 * the server's HTML, and hydrating it with the same props changes nothing.
 */

const Organisation = framed(OrganisationScreen);
const Integrations = framed(IntegrationsScreen);
const FieldRegistry = framed(FieldRegistryScreen);
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
  payBands: [
    {
      id: 'b1',
      grade: 'L3',
      currency: 'EUR',
      minimumMinor: '4000000',
      midpointMinor: '5000000',
      maximumMinor: '6000000',
      effectiveFrom: '2026-01-01',
      recordedAt: '2026-01-01T09:00:00Z',
      supersedes: null,
    },
  ],
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
  onSetPayBand: done,
});

const registry: RegistryDraft = {
  published: { version: 3, publishedAt: '12 Sep' },
  unpublishedChanges: 1,
  choices: { legalEntities: [], countries: [], employmentTypes: [], workModels: [] },
  sections: [
    {
      key: 'hr',
      label: 'HR information',
      visibility: ['self', 'manager', 'hr'],
      ownership: ['hr'],
      origin: 'core',
      fixed: false,
    },
  ],
  fields: [
    {
      key: 'shirt_size',
      label: 'Shirt size',
      sectionKey: 'hr',
      description: null,
      dataType: 'text',
      options: [],
      requiredness: 'never',
      requiredWhen: null,
      ownership: ['employee'],
      visibility: ['self', 'hr'],
      visibilityRules: [],
      collectAt: 'signup',
      classification: 'internal',
      piiKind: 'none',
      origin: 'tenant',
      pending: null,
    },
  ],
};

const registryProps = (open: string | null) => ({
  load: { status: 'ready' as const, data: registry },
  today: '2026-09-22',
  advise: vi.fn(),
  onReorderSections: done,
  onReorderFields: done,
  onAddSection: done,
  onSaveField: done,
  preview: vi.fn(),
  onPublish: done,
  open,
  onOpenChange: vi.fn(),
});

const integrationsProps = (tab: string, open: string | null) => ({
  load: {
    status: 'ready' as const,
    data: {
      schemaVersion: 1,
      deliveries24h: 0,
      events: [],
      fields: [],
      endpoints: [],
      scim: { url: '', paths: [], extension: 'x', mappable: [], connections: [] },
    },
  },
  tab,
  onTabChange: () => undefined,
  open,
  onOpenChange: vi.fn(),
  onCreate: () => Promise.resolve({ ok: true as const, secret: 's' }),
  onUpdate: done,
  onRotate: () => Promise.resolve({ ok: true as const, secret: 's' }),
  scim: {
    onConnect: () => Promise.resolve({ ok: true as const, token: 't' }),
    onRotateToken: () => Promise.resolve({ ok: true as const, token: 't' }),
    onDisconnect: done,
    onSetMapping: done,
  },
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

/**
 * A dialog the address names (`?open=`) is in the server's HTML, open, and
 * hydrating it changes nothing: a shared link reopens it.
 */
describe('People settings’ dialogs, in the address', () => {
  it.each([
    ['preview', 'Sign-up preview'],
    ['section', 'Add a section'],
  ])('serves Employee fields with ?open=%s', async (open, title) => {
    const { html, errors } = await serveAndHydrate(
      createElement(FieldRegistry, registryProps(open)),
    );
    expect(html).toContain(title);
    expect(errors).toEqual([]);
    expect(screen.getByRole('dialog', { name: title })).toBeInTheDocument();
  });

  it.each([
    ['entities', `entity:${ACME}`, 'Acme Iberia SL'],
    ['entities', 'entity:new', 'Add a legal entity'],
    ['locations', 'location:l1', 'Madrid office'],
    ['numbering', `numbering:${ACME}`, 'ES-'],
    ['pay-bands', 'band:new', 'Add a pay band'],
    ['pay-bands', 'band:b1', 'Correct L3, EUR'],
  ])('serves Organisation’s %s with ?open=%s', async (tab, open, text) => {
    const { html, errors } = await serveAndHydrate(
      createElement(Organisation, { ...orgProps(tab), open, onOpenChange: vi.fn() }),
    );
    expect(errors).toEqual([]);
    expect(html).toContain('role="dialog"');
    expect(screen.getByRole('dialog')).toHaveTextContent(text);
  });

  it('opens nothing for an entity this company does not have', async () => {
    const { html } = await serveAndHydrate(
      createElement(Organisation, { ...orgProps('entities'), open: 'entity:gone' }),
    );
    expect(html).not.toContain('role="dialog"');
  });

  it.each([
    ['webhooks', 'endpoint', 'Add an endpoint'],
    ['provisioning', 'connect', 'Connect a system'],
  ])('serves Integrations’ %s with ?open=%s', async (tab, open, title) => {
    const { html, errors } = await serveAndHydrate(
      createElement(
        TooltipProvider,
        null,
        createElement(Integrations, integrationsProps(tab, open)),
      ),
    );
    expect(html).toContain('role="dialog"');
    expect(errors).toEqual([]);
    expect(screen.getByRole('dialog', { name: title })).toBeInTheDocument();
  });
});
