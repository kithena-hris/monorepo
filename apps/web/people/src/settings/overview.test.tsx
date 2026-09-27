import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../test/axe';
import { PeopleSettings, type PeopleSettingsState } from './overview';

const all: PeopleSettingsState = {
  fields: {
    published: { version: 4, publishedAt: '2026-09-12T10:00:00.000Z' },
    unpublishedChanges: 3,
    fields: [{}, {}, {}, {}, {}],
  },
  organisation: {
    settings: { defaultTimeZone: 'America/New_York', cohortMinimum: 10 },
    legalEntities: [{ archived: false }, { archived: true }],
    locations: [{ archived: false }, { archived: false }],
    retentionFloors: [{ status: 'placeholder' }, { status: 'reviewed' }],
  },
  roles: { people: [{ roles: ['people_admin', 'hr'] }, { roles: ['hr'] }, { roles: [] }] },
  integrations: {
    endpoints: [{ enabled: true }, { enabled: false }],
    scim: { connections: [{ system: 'Okta', revokedAt: null, linked: 42 }] },
  },
};

describe('PeopleSettings', () => {
  it('reads each setting back on a card that links to changing it', async () => {
    const { container } = render(<PeopleSettings load={{ status: 'ready', data: all }} />);
    expect(screen.getByRole('heading', { name: 'People settings' })).toBeInTheDocument();

    const fields = screen.getByRole('link', { name: 'Employee fields' });
    expect(fields).toHaveAttribute('href', '/settings/people/fields');
    const fieldsNow = screen.getByLabelText('Employee fields, now');
    expect(within(fieldsNow).getByText(/^Version 4, .*2026$/)).toBeInTheDocument();
    expect(within(fieldsNow).getByText('3 changes')).toBeInTheDocument();

    const org = screen.getByLabelText('Organisation, now');
    // Archived entities are not counted; unreviewed retention periods are flagged.
    expect(within(org).getByText('America/New_York')).toBeInTheDocument();
    expect(within(org).getByText('1 waiting for legal review')).toBeInTheDocument();

    const roles = screen.getByLabelText('Roles, now');
    expect(
      within(roles)
        .getAllByRole('definition')
        .map((d) => d.textContent),
    ).toEqual(['1', '2', '0']);

    const integrations = screen.getByLabelText('Integrations, now');
    expect(within(integrations).getByText('1 of 2 on')).toBeInTheDocument();
    expect(within(integrations).getByText('Okta, 42 people linked')).toBeInTheDocument();

    expect(await axeViolations(container)).toEqual([]);
  });

  it('draws only what this viewer may open', () => {
    render(
      <PeopleSettings
        load={{
          status: 'ready',
          data: { ...all, fields: null, roles: null, integrations: null },
        }}
      />,
    );
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['Organisation']);
  });

  it('says so when there is nothing to change', async () => {
    const { container } = render(
      <PeopleSettings
        load={{
          status: 'ready',
          data: { fields: null, organisation: null, roles: null, integrations: null },
        }}
      />,
    );
    expect(screen.getByText('Nothing here for you to change')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});
