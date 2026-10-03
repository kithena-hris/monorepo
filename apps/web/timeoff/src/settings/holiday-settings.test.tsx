import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { holidays } from './acme.fixture';
import { HolidaySettings } from './holiday-settings';

/**
 * Holiday calendars (T36) on Acme's settings for 2026: Madrid keeps Spain,
 * the Madrid region and the city; Barcelona keeps Spain, Catalonia and its
 * city. Spain's pack is not reviewed yet. Every state passes axe.
 */

const ready = <T,>(data: T) => ({ status: 'ready' as const, data });

describe('holiday calendars', () => {
  it('lists the locations and the first one’s year, layer by layer', async () => {
    const { container } = render(<HolidaySettings load={ready(holidays())} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Holidays' })).toBeTruthy();
    expect(screen.getByText('Spain’s rules are not reviewed yet')).toBeTruthy();
    const places = within(screen.getByRole('list', { name: 'Work locations' }));
    const barcelona = places.getByRole('link', { name: /^Barcelona/ });
    expect(barcelona.getAttribute('aria-current')).toBe('page');
    expect(within(barcelona).getByText('Spain + Catalonia + Barcelona city')).toBeTruthy();
    expect(places.getByRole('link', { name: /^Madrid/ }).getAttribute('href')).toBe(
      '/settings/time-off/holidays/2026?location=madrid',
    );
    expect(screen.getByRole('heading', { name: 'Barcelona in 2026' })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('shows the location the address names, its days in order with the layer each comes from', () => {
    render(<HolidaySettings load={ready({ ...holidays(), location: 'madrid' })} />);
    const days = within(screen.getByRole('list', { name: 'Holidays in Madrid' }));
    const items = days.getAllByRole('listitem');
    expect(items).toHaveLength(14);
    expect(items[0]?.textContent).toBe('Año NuevoThu 1 JanSpain');
    expect(items[6]?.textContent).toBe('San IsidroFri 15 MayMadrid city');
    expect(items[2]?.textContent).toBe('Jueves SantoThu 2 AprMadrid region');
  });

  it('ticks the calendars a location keeps, and saves them most general first (TOF-099a)', () => {
    const onAssign = vi.fn(() => Promise.resolve({ ok: true as const }));
    render(
      <HolidaySettings load={ready({ ...holidays(), location: 'madrid' })} onAssign={onAssign} />,
    );
    const keeps = within(
      screen
        .getByRole('heading', { name: 'Calendars Madrid keeps' })
        .closest('section') as HTMLElement,
    );
    expect(keeps.getByRole('checkbox', { name: /^Madrid city/ })).toHaveProperty(
      'ariaChecked',
      'true',
    );
    fireEvent.click(keeps.getByRole('checkbox', { name: /^Madrid city/ }));
    fireEvent.click(keeps.getByRole('checkbox', { name: /^Catalonia/ }));
    fireEvent.click(keeps.getByRole('button', { name: 'Save calendars' }));
    expect(onAssign).toHaveBeenCalledWith('madrid', ['es', 'es_md', 'es_ct']);
  });

  it('adds a calendar with its days, and edits one (TOF-099a)', async () => {
    const onSave = vi.fn(() => Promise.resolve({ ok: true as const }));
    const { unmount } = render(
      <HolidaySettings
        load={ready({ ...holidays(), calendar: 'new' })}
        onSaveCalendar={onSave}
        onAsk={vi.fn()}
      />,
    );
    const dialog = within(screen.getByRole('dialog', { name: 'Add a calendar' }));
    fireEvent.change(dialog.getByRole('textbox', { name: /^Name/ }), {
      target: { value: 'Valencia city' },
    });
    fireEvent.change(dialog.getByLabelText('Date'), { target: { value: '2026-03-19' } });
    fireEvent.change(dialog.getByRole('textbox', { name: /^Holiday/ }), {
      target: { value: 'San José' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Add day' }));
    expect(dialog.getByRole('list', { name: 'Days in 2026' }).textContent).toContain('San José');
    fireEvent.click(dialog.getByRole('button', { name: 'Save calendar' }));
    expect(onSave).toHaveBeenCalledWith('valencia_city', {
      name: 'Valencia city',
      level: 'city',
      weekendRule: 'none',
      holidays: [{ date: '2026-03-19', name: 'San José' }],
    });
    expect(await axeViolations(document.body)).toEqual([]);
    unmount();

    render(
      <HolidaySettings
        load={ready({ ...holidays(), calendar: 'barcelona' })}
        onSaveCalendar={onSave}
        onRemoveCalendar={vi.fn()}
        onAsk={vi.fn()}
      />,
    );
    const edit = within(screen.getByRole('dialog', { name: 'Barcelona city' }));
    fireEvent.click(edit.getByRole('button', { name: 'Remove La Mercè' }));
    fireEvent.click(edit.getByRole('button', { name: 'Save calendar' }));
    expect(onSave).toHaveBeenLastCalledWith('barcelona', expect.objectContaining({ holidays: [] }));
  });

  it('switches between this year and the next', () => {
    const onYear = vi.fn();
    render(<HolidaySettings load={ready(holidays())} onYear={onYear} />);
    const years = within(screen.getByRole('radiogroup', { name: 'Year' }));
    expect(years.getAllByRole('radio').map((r) => r.textContent)).toEqual(['2026', '2027']);
    fireEvent.click(years.getByRole('radio', { name: '2027' }));
    expect(onYear).toHaveBeenCalledWith(2027);
  });

  it('says when a year has no days yet', () => {
    const empty = {
      ...holidays(),
      year: 2027,
      locations: holidays().locations.map((l) => ({ ...l, holidays: [] })),
    };
    render(<HolidaySettings load={ready(empty)} />);
    expect(
      screen.getByText(
        'No holidays for 2027 yet. Each year’s calendars are published in the autumn before it.',
      ),
    ).toBeTruthy();
  });

  it('loads in the page’s shape, and says what Time Off refused', async () => {
    const { container, rerender } = render(<HolidaySettings load={{ status: 'loading' }} />);
    expect(screen.getByRole('status').textContent).toBe('Loading holidays');
    expect(await axeViolations(container)).toEqual([]);
    rerender(<HolidaySettings load={{ status: 'error', message: 'Only HR can do that' }} />);
    expect(screen.getByText('Could not load the holiday calendars')).toBeTruthy();
  });
});
