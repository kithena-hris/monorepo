import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DescribeRequest as Framed } from '../index';
import { axeViolations } from '../test/axe';
import { described } from './acme.fixture';
import { DescribeRequest, type DescribeData } from './describe';

/**
 * Describe it (T4, MT8) on Acme's data: Adam's sentence, what Time Off read it
 * as, and the three dates it found. Nothing is sent from here.
 */

const ready = (data: DescribeData) => ({ status: 'ready' as const, data });
const dialog = () => within(screen.getByRole('dialog', { name: 'Request time off' }));

describe('describe it (T4)', () => {
  it('shows what the sentence was understood as and the dates found, best first', async () => {
    render(<Framed load={ready(described())} />);
    const d = dialog();
    const chips = within(d.getByRole('group', { name: 'Understood as' }));
    expect(chips.getByText('Vacation')).toBeTruthy();
    expect(chips.getByText('About 5 days')).toBeTruthy();
    expect(chips.getByText('October')).toBeTruthy();
    expect(chips.getByText('Next to a holiday')).toBeTruthy();
    expect(chips.getByText('Below team minimum')).toBeTruthy();
    // Read by Time Off's rules: no AI tag anywhere.
    expect(d.queryByText('AI')).toBeNull();
    const options = within(d.getByRole('radiogroup', { name: 'Dates to ask for' })).getAllByRole(
      'radio',
    );
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveAttribute('aria-checked', 'true');
    expect(
      within((options[0] as HTMLElement).closest('label') as HTMLElement).getByText('Best value'),
    ).toBeTruthy();
    expect(d.getByText('4 days for 9 days away, with Fiesta Nacional.')).toBeTruthy();
    expect(d.getByText('Uses 4 · away 9 · 5 of 7 in every day')).toBeTruthy();
    expect(d.getByText('Uses 5 · away 9 · Wed 21 Oct: 4 of 7 in, below minimum')).toBeTruthy();
    expect(d.getByText('Vacation after 13–16 Oct: 7.5 days')).toBeTruthy();
    expect(d.getByRole('link', { name: 'Request 13–16 Oct' }).getAttribute('href')).toBe(
      '/time-off/request?type=vacation&from=2026-10-13&to=2026-10-16',
    );
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('asks again for a new sentence, and for each choice changed or removed', () => {
    const onAsk = vi.fn();
    render(<DescribeRequest load={ready(described())} onAsk={onAsk} />);
    const d = dialog();
    fireEvent.click(d.getByRole('button', { name: 'Remove Prefer Next to a holiday' }));
    expect(onAsk).toHaveBeenLastCalledWith({ holiday: '0' }, 'replace');
    fireEvent.click(d.getByRole('button', { name: 'Remove When October' }));
    expect(onAsk).toHaveBeenLastCalledWith({ month: 'none' }, 'replace');
    fireEvent.click(d.getByRole('button', { name: 'Change' }));
    fireEvent.click(d.getByRole('switch', { name: 'Not when the team is short' }));
    expect(onAsk).toHaveBeenLastCalledWith({ team: '0' }, 'replace');
    const box = d.getByRole('textbox', { name: 'Message' });
    fireEvent.change(box, { target: { value: 'two weeks in December' } });
    fireEvent.submit(box.closest('form') as HTMLFormElement);
    expect(onAsk).toHaveBeenLastCalledWith(
      {
        q: 'two weeks in December',
        type: null,
        days: null,
        month: null,
        holiday: null,
        team: null,
      },
      'push',
    );
  });

  it('picks other dates for the request, and tags only what a model wrote', () => {
    const data = described();
    render(
      <DescribeRequest
        load={ready({
          ...data,
          understood: { ...data.understood, ai: true },
          options: data.options.map((o, i) =>
            i === 1 ? { ...o, line: { text: 'A clean week after the release.', ai: true } } : o,
          ),
        })}
      />,
    );
    const d = dialog();
    expect(within(d.getByRole('group', { name: 'Understood as' })).getByText('AI')).toBeTruthy();
    const options = within(d.getByRole('radiogroup', { name: 'Dates to ask for' })).getAllByRole(
      'radio',
    );
    expect(
      within((options[0] as HTMLElement).closest('label') as HTMLElement).queryByText('AI'),
    ).toBeNull();
    expect(
      within((options[1] as HTMLElement).closest('label') as HTMLElement).getByText('AI'),
    ).toBeTruthy();
    fireEvent.click(options[1] as HTMLElement);
    expect(d.getByRole('link', { name: 'Request 26–30 Oct' }).getAttribute('href')).toBe(
      '/time-off/request?type=vacation&from=2026-10-26&to=2026-10-30',
    );
  });

  it('goes to picking dates by hand, and closes to the overview', () => {
    const onNavigate = vi.fn();
    render(<DescribeRequest load={ready(described())} onNavigate={onNavigate} />);
    fireEvent.click(dialog().getByRole('radio', { name: 'Pick dates' }));
    expect(onNavigate).toHaveBeenCalledWith('/time-off/request');
  });

  it('waits in its shape, and says so when Time Off does not answer', () => {
    const retry = vi.fn();
    const { rerender } = render(<DescribeRequest load={{ status: 'loading' }} />);
    expect(screen.getByText('Finding dates')).toBeTruthy();
    rerender(<DescribeRequest load={{ status: 'error', message: 'Time Off is asleep', retry }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });
});
