import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { fast } from '../test/user';
import { PeopleHome } from '../home/people-home';
import {
  numberOf,
  Organisation,
  todayIn,
  toMinorDigits,
  type OrganisationProps,
  type OrganisationState,
} from './organisation';

const ACME = '00000000-0000-4000-8000-0000000000e1';
const MADRID = '00000000-0000-4000-8000-0000000000f1';

const state = (over: Partial<OrganisationState> = {}): OrganisationState => ({
  canManage: true,
  settings: { defaultTimeZone: 'Europe/Madrid', cohortMinimum: 10, slug: 'acme', displayName: 'Acme' },
  legalEntities: [
    { id: ACME, name: 'Acme Iberia SL', country: 'ES', timeZone: 'Europe/Madrid', archived: false },
  ],
  locations: [
    {
      id: MADRID,
      legalEntityId: ACME,
      name: 'Madrid office',
      country: 'ES',
      timeZone: 'Europe/Madrid',
      zones: [{ effectiveFrom: '2026-01-01', timeZone: 'Europe/Madrid' }],
      archived: false,
    },
  ],
  numberings: [{ legalEntityId: ACME, prefix: 'ES-', digits: 5, nextValue: 42 }],
  countries: [
    { code: 'ES', name: 'Spain' },
    { code: 'GB', name: 'United Kingdom' },
  ],
  timeZones: ['Etc/UTC', 'Europe/London', 'Europe/Madrid', 'Pacific/Kiritimati'],
  retentionFloors: [
    { floor: 'es-labour', months: 48, status: 'unreviewed', reviewedBy: null, reviewedOn: null },
    { floor: 'de-labour', months: 72, status: 'unreviewed', reviewedBy: null, reviewedOn: null },
  ],
  ...over,
});

const done = () => Promise.resolve({ ok: true as const });

function props(over: Partial<OrganisationProps> = {}): OrganisationProps {
  return {
    load: { status: 'ready', data: state() },
    onUpdateSettings: vi.fn(done),
    onCreateEntity: vi.fn(done),
    onUpdateEntity: vi.fn(done),
    onCreateLocation: vi.fn(done),
    onUpdateLocation: vi.fn(done),
    onChangeZone: vi.fn(done),
    onSetNumbering: vi.fn(done),
    ...over,
  };
}

describe('the organisation settings (PEO-119)', () => {
  it('writes a number as the scheme would', () => {
    expect(numberOf('ES-', 5, 42)).toBe('ES-00042');
    expect(numberOf('', 2, 1234)).toBe('1234');
    expect(todayIn('Pacific/Kiritimati', new Date('2026-09-24T12:00:00Z'))).toBe('2026-09-25');
    expect(todayIn('Pacific/Pago_Pago', new Date('2026-09-24T09:00:00Z'))).toBe('2026-09-23');
  });

  it('lists the entities, and adds one with a country and a zone', async () => {
    const p = props();
    const { container } = render(<Organisation {...p} />);
    expect(screen.getByRole('cell', { name: /Acme Iberia SL/ })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
    const user = fast();
    await user.click(screen.getByRole('button', { name: 'Add legal entity' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a legal entity' });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(p.onCreateEntity).not.toHaveBeenCalled();
    expect(within(dialog).getByText('A name is needed.')).toBeInTheDocument();
    await user.type(within(dialog).getByRole('textbox', { name: /Name/ }), 'Acme UK Ltd');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    // Country and zone were defaulted from the first entity.
    expect(p.onCreateEntity).toHaveBeenCalledWith({
      name: 'Acme UK Ltd',
      country: 'ES',
      timeZone: 'Europe/Madrid',
    });
  });

  it('changes a location’s zone from today in the new zone', async () => {
    const p = props();
    render(<Organisation {...p} />);
    const user = fast();
    await user.click(screen.getByRole('tab', { name: 'Locations' }));
    await user.click(screen.getByRole('button', { name: 'Change the time zone of Madrid office' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'New time zone' }));
    await user.click(screen.getByRole('option', { name: 'Pacific/Kiritimati' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(p.onChangeZone).toHaveBeenCalledWith(
      MADRID,
      'Pacific/Kiritimati',
      todayIn('Pacific/Kiritimati'),
    );
  });

  it('shows People’s refusal and keeps the dialog open', async () => {
    const p = props({
      onSetNumbering: vi.fn(() => Promise.resolve({ ok: false as const, message: 'Not today' })),
    });
    render(<Organisation {...p} />);
    const user = fast();
    await user.click(screen.getByRole('tab', { name: 'Employee numbering' }));
    expect(screen.getByRole('cell', { name: 'ES-00042' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Set the numbering of Acme Iberia SL' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(p.onSetNumbering).toHaveBeenCalledWith(ACME, { prefix: 'ES-', digits: 5, start: 42 });
    expect(await within(dialog).findByText('Not today')).toBeInTheDocument();
  });

  it('never offers a lower cohort minimum', async () => {
    const p = props();
    render(<Organisation {...p} />);
    const user = fast();
    await user.click(screen.getByRole('tab', { name: 'Company' }));
    const minimum = screen.getByRole('spinbutton', { name: /Smallest group/ });
    await user.clear(minimum);
    await user.type(minimum, '5');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.clear(minimum);
    await user.type(minimum, '12');
    await user.tab();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(p.onUpdateSettings).toHaveBeenCalledWith({ cohortMinimum: 12 });
  });

  it('marks every unreviewed retention floor pending legal review (PEO-126)', async () => {
    const reviewed = state({
      retentionFloors: [
        { floor: 'es-labour', months: 48, status: 'unreviewed', reviewedBy: null, reviewedOn: null },
        { floor: 'de-labour', months: 72, status: 'reviewed', reviewedBy: 'A. Counsel', reviewedOn: '2026-10-01' },
      ],
    });
    const { container } = render(<Organisation {...props({ load: { status: 'ready', data: reviewed } })} />);
    await fast().click(screen.getByRole('tab', { name: 'Company' }));
    const table = screen.getByRole('table', { name: 'Statutory retention floors' });
    const spain = within(table).getByRole('row', { name: /Spain, labour records/ });
    expect(within(spain).getByText('48 months')).toBeInTheDocument();
    expect(within(spain).getByText('Pending legal review')).toBeInTheDocument();
    const germany = within(table).getByRole('row', { name: /Germany/ });
    expect(within(germany).getByText('Reviewed by A. Counsel on 2026-10-01')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/Nothing is erased automatically/);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('shows anybody else the settings without a control', async () => {
    const { container } = render(
      <Organisation {...props({ load: { status: 'ready', data: state({ canManage: false }) } })} />,
    );
    expect(screen.getByText('Only a People administrator can change these.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add legal entity' })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('People home (PEO-119)', () => {
  it('lists the settings a People administrator uses, and not to an employee', () => {
    const { unmount } = render(
      <PeopleHome load={{ status: 'ready', data: { hr: false, admin: true, finance: false } }} />,
    );
    const settings = screen.getByRole('navigation', { name: 'Settings' });
    for (const name of ['Employee fields', 'Roles', 'Integrations', 'Organisation']) {
      expect(within(settings).getByRole('link', { name })).toBeInTheDocument();
    }
    unmount();
    const hr = render(
      <PeopleHome load={{ status: 'ready', data: { hr: true, admin: false, finance: false } }} />,
    );
    // Add employee is the host's, beside every screen, and never repeated here.
    expect(screen.queryByRole('link', { name: 'Add employee' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Approvals' })).toBeInTheDocument();
    hr.unmount();
    render(<PeopleHome load={{ status: 'ready', data: { hr: false, admin: false, finance: false } }} />);
    expect(screen.queryByRole('link', { name: 'Integrations' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Add employee' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Directory' })).toHaveAttribute('href', '/people/directory');
  });

  it('turns an amount into minor units by moving digits, never through a float (PEO-078)', () => {
    expect(toMinorDigits('55000.5', 'EUR')).toBe('5500050');
    expect(toMinorDigits('55,000', 'EUR')).toBe('5500000');
    expect(toMinorDigits('0.1', 'EUR')).toBe('10');
    expect(toMinorDigits('1000', 'JPY')).toBe('1000');
    expect(toMinorDigits('10.5', 'JPY')).toBeNull();
    expect(toMinorDigits('1.005', 'EUR')).toBeNull();
    expect(toMinorDigits('0', 'EUR')).toBeNull();
    expect(toMinorDigits('4e6', 'EUR')).toBeNull();
  });

  it('shows pay bands only to whom People sent them, and corrects one in minor units (PEO-078)', async () => {
    const { unmount } = render(<Organisation {...props()} />);
    expect(screen.queryByRole('tab', { name: 'Pay bands' })).toBeNull();
    unmount();

    const band = {
      id: '00000000-0000-4000-8000-0000000000b1',
      grade: 'l3',
      currency: 'EUR',
      minimumMinor: '4000000',
      midpointMinor: '5000000',
      maximumMinor: '6000000',
      effectiveFrom: '2026-01-01',
      recordedAt: '2026-09-01T12:00:00.000Z',
      supersedes: null,
    };
    const p = props({
      load: { status: 'ready', data: state({ canManage: false, payBands: [band] }) },
      onSetPayBand: vi.fn(done),
    });
    const { container } = render(<Organisation {...p} />);
    const user = fast();
    await user.click(screen.getByRole('tab', { name: 'Pay bands' }));
    expect(screen.getByRole('cell', { name: '50,000.00 EUR' })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Correct l3 EUR from 2026-01-01' }));
    const dialog = screen.getByRole('dialog');
    const maximum = within(dialog).getByRole('textbox', { name: /Maximum/ });
    await user.clear(maximum);
    await user.type(maximum, '65000.50');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(p.onSetPayBand).toHaveBeenCalledWith({
      grade: 'l3',
      currency: 'EUR',
      minimumMinor: '4000000',
      midpointMinor: '5000000',
      maximumMinor: '6500050',
      effectiveFrom: '2026-01-01',
    });
  });
});
