import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { fast } from '../test/user';
import { axeViolations } from '../test/axe';
import { CountryPacks } from './country-packs';
import { ReminderSettings, type ReminderSettingsState } from './reminders';

const state: ReminderSettingsState = {
  canManage: true,
  cohortMinimum: 10,
  reminders: { cadence: 'Then once a week', window: '09:00 to 18:00', inChat: false },
};

describe('ReminderSettings', () => {
  it('states the reminder rule, raises the reporting floor and never lowers it', async () => {
    const user = fast();
    const onCohortMinimum = vi.fn(() => Promise.resolve({ ok: true as const }));
    const { container } = render(
      <ReminderSettings
        load={{ status: 'ready', data: state }}
        onCohortMinimum={onCohortMinimum}
      />,
    );
    expect(screen.getByText('Then once a week')).toBeInTheDocument();
    // No source for the digest or the directory: left out, not invented.
    expect(screen.queryByText('HR digest')).toBeNull();
    expect(screen.queryByText('Directory')).toBeNull();

    const form = screen.getByRole('form', { name: 'Reporting privacy' });
    const save = within(form).getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    const floor = within(form).getByRole('spinbutton');
    await user.clear(floor);
    await user.type(floor, '8');
    expect(save).toBeDisabled();
    await user.clear(floor);
    await user.type(floor, '12');
    await user.click(save);
    expect(onCohortMinimum).toHaveBeenCalledWith(12);
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('CountryPacks', () => {
  it('lists what each pack adds and the entities in its country, with no guessed check', async () => {
    const { container } = render(
      <CountryPacks
        load={{
          status: 'ready',
          data: {
            packs: [
              {
                country: 'ES',
                countryName: 'Spain',
                fields: 3,
                sections: [{ label: 'Identification' }],
              },
              {
                country: 'IN',
                countryName: 'India',
                fields: 2,
                sections: [{ label: 'Identification' }],
              },
            ],
            entities: [{ id: 'e1', name: 'Acme Iberia', country: 'ES', archived: false }],
          },
        }}
      />,
    );
    const table = screen.getByRole('table', { name: 'Country packs' });
    expect(within(table).getByText('Acme Iberia')).toBeInTheDocument();
    expect(within(table).getByText('No entity yet')).toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'Check' })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });
});
