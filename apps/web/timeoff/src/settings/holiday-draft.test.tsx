import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { holidays } from './acme.fixture';
import { HolidaySettings, type HolidayDraft, type HolidaySettingsData } from './holiday-settings';

/**
 * T36's assistant card (TOF-112): Ada pastes Madrid city's list for 2027, and
 * Time Off drafts it, one day still to be confirmed by the council.
 */

const ready = (data: HolidaySettingsData) => ({ status: 'ready' as const, data });
const draft = (over: Partial<HolidayDraft> = {}): HolidayDraft => ({
  layerKey: 'madrid',
  layerName: 'Madrid city',
  year: 2027,
  days: [
    { date: '2027-05-15', name: 'San Isidro', confirmed: true, known: false },
    { date: '2027-11-09', name: 'La Almudena', confirmed: false, known: false },
  ],
  skipped: ['Fiestas locales de Madrid 2027'],
  summary: {
    text: 'Read 2 days for Madrid city in 2027 from the list you supplied; 1 is not confirmed yet and stays with you.',
    ai: false,
  },
  ai: false,
  ...over,
});
const card = (name: RegExp) =>
  within(screen.getByRole('heading', { name }).closest('.flex-col') as HTMLElement);

describe('drafting a year from a list (TOF-112)', () => {
  it('takes the calendar and the list HR pastes, through the address', async () => {
    const onDraft = vi.fn();
    const { container } = render(
      <HolidaySettings load={ready({ ...holidays(), year: 2027 })} onDraft={onDraft} />,
    );
    const c = card(/Draft 2027 from a list/);
    fireEvent.change(c.getByRole('textbox', { name: 'The official list' }), {
      target: { value: '15 de mayo — San Isidro' },
    });
    fireEvent.click(c.getByRole('button', { name: 'Draft 2027' }));
    expect(onDraft).toHaveBeenCalledWith({ layerKey: 'es', source: '15 de mayo — San Isidro' });
    expect(await axeViolations(container)).toEqual([]);
  });

  it('shows the draft with the days to confirm, and saves only the confirmed ones, added to the calendar', async () => {
    const onSaveCalendar = vi.fn(() => Promise.resolve({ ok: true as const }));
    const data = { ...holidays(), year: 2027, draft: draft() };
    const { container } = render(<HolidaySettings load={ready(data)} onSaveCalendar={onSaveCalendar} />);
    const c = card(/Madrid city for 2027 is ready to review/);
    expect(c.getByText(/1 is not confirmed yet and stays with you/)).toBeTruthy();
    expect(c.queryByText('AI')).toBeNull();
    const rows = c.getAllByRole('listitem').map((li) => li.textContent);
    expect(rows).toEqual(['San IsidroSat 15 May', 'La AlmudenaTue 9 NovTo confirm']);
    expect(c.getByText('Not read: Fiestas locales de Madrid 2027')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.click(c.getByRole('button', { name: 'Save 1 confirmed day' }));
    const city = data.layers.find((l) => l.key === 'madrid');
    expect(onSaveCalendar).toHaveBeenCalledWith('madrid', {
      name: 'Madrid city',
      level: 'city',
      weekendRule: 'none',
      holidays: [...(city?.holidays ?? []), { date: '2027-05-15', name: 'San Isidro' }].toSorted(
        (a, b) => a.date.localeCompare(b.date),
      ),
    });
    await waitFor(() => {
      expect(c.getByText('Saved to Madrid city')).toBeTruthy();
    });
  });

  it('tags the draft AI only when a model judged the lines or wrote the line, and starts again', () => {
    const onDraft = vi.fn();
    render(
      <HolidaySettings
        load={ready({ ...holidays(), year: 2027, draft: draft({ ai: true }) })}
        onDraft={onDraft}
      />,
    );
    const c = card(/2027 is ready to review/);
    expect(c.getByText('AI')).toBeTruthy();
    fireEvent.click(c.getByRole('button', { name: 'Start again' }));
    expect(onDraft).toHaveBeenCalledWith(null);
  });
});
