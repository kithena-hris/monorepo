import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { december, october, opening } from './acme.fixture';
import { RequestTimeOff, type RequestData } from './request';

/**
 * Requesting time off (T3, T5) at a desk, on Acme's demo data: Adam on
 * 1 October 2026. The panel is portalled over the overview, so axe runs over
 * the whole document. The phone's steps are `test/screens.phone.test.tsx`.
 */

const ready = (data: RequestData) => ({ status: 'ready' as const, data });
const panel = () => within(screen.getByRole('dialog', { name: 'Request time off' }));

describe('requesting time off', () => {
  it('opens over the overview with each type and its balance, and nothing to send yet', async () => {
    render(<RequestTimeOff load={ready(opening())} />);
    const types = within(panel().getByRole('radiogroup', { name: 'Type' }));
    expect(types.getByRole('radio', { name: 'Vacation' })).toHaveAccessibleDescription(
      '11.5 days left',
    );
    expect(types.getByRole('radio', { name: 'Comp time' })).toHaveAccessibleDescription(
      '6h banked',
    );
    expect(panel().getByRole('link', { name: /Parental leave/ })).toHaveAttribute(
      'href',
      '/time-off/parental/plan',
    );
    expect(panel().getByText('Choose a type, then the dates, to see what they cost.')).toBeTruthy();
    expect(panel().getByRole('button', { name: 'Send request' })).toBeDisabled();
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('asks again as the type, the dates and the length change', () => {
    const onAsk = vi.fn();
    render(<RequestTimeOff load={ready(opening())} onAsk={onAsk} />);
    fireEvent.click(panel().getByRole('radio', { name: 'Vacation' }));
    expect(onAsk).toHaveBeenLastCalledWith({ type: 'vacation', step: null }, 'replace');
    fireEvent.click(panel().getByRole('button', { name: /19 October 2026/ }));
    expect(onAsk).toHaveBeenCalledTimes(1);
    fireEvent.click(panel().getByRole('button', { name: /23 October 2026/ }));
    expect(onAsk).toHaveBeenLastCalledWith({ from: '2026-10-19', to: '2026-10-23' }, 'replace');
    fireEvent.click(panel().getByRole('radio', { name: 'Half day' }));
    expect(onAsk).toHaveBeenLastCalledWith({ half: '1' }, 'replace');
  });

  it('shows T3’s consequences: the days, the balance after, the clash and who else is off', async () => {
    render(<RequestTimeOff load={ready(october())} />);
    expect(panel().getByText('Marco Ruiz approves.')).toBeTruthy();
    expect(panel().getByText('Mon 19 – Fri 23 Oct')).toBeTruthy();
    expect(panel().getByText('Vacation · 5 days · 9 days away')).toBeTruthy();
    expect(panel().getByText('6.5')).toBeTruthy();
    const clash = panel().getByRole('alert');
    expect(clash).toHaveTextContent('Wed 21 Oct: only 4 of 7 would be in');
    expect(clash).toHaveTextContent(
      'Omar and Yuki are already off that day. Marco can still approve it.',
    );
    const others = within(panel().getByRole('region', { name: 'Who else is off' }));
    expect(others.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'OHOmar Haddad19–21 OctVacation',
      'YSYuki Sato21 OctPersonal day',
    ]);
    expect(panel().getByRole('button', { name: 'Send to Marco' })).toBeEnabled();
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('sends with the note and opens the request it made', async () => {
    const onSend = vi.fn(() => Promise.resolve({ ok: true as const, requestId: 'r-19' }));
    const onNavigate = vi.fn();
    render(<RequestTimeOff load={ready(october())} onSend={onSend} onNavigate={onNavigate} />);
    fireEvent.change(panel().getByRole('textbox', { name: 'Note for Marco (optional)' }), {
      target: { value: 'Back for the release' },
    });
    fireEvent.click(panel().getByRole('button', { name: 'Send to Marco' }));
    expect(onSend).toHaveBeenCalledWith({
      leaveTypeKey: 'vacation',
      span: { from: '2026-10-19', to: '2026-10-23', startsHalfDay: false, endsHalfDay: false },
      note: 'Back for the release',
    });
    await vi.waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith('/time-off/requests/r-19');
    });
  });

  it('says why when Time Off refuses to send it', async () => {
    const onSend = vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        message: 'You already have time off on some of these dates',
      }),
    );
    render(<RequestTimeOff load={ready(october())} onSend={onSend} />);
    fireEvent.click(panel().getByRole('button', { name: 'Send to Marco' }));
    expect(
      await panel().findByText('You already have time off on some of these dates'),
    ).toBeTruthy();
  });

  it('closes back to the overview', () => {
    const onNavigate = vi.fn();
    render(<RequestTimeOff load={ready(october())} onNavigate={onNavigate} />);
    fireEvent.click(panel().getByRole('button', { name: 'Cancel' }));
    expect(onNavigate).toHaveBeenCalledWith('/time-off/overview');
  });

  it('loads in its shape over the overview’s, and fails with a way to try again', async () => {
    const { rerender } = render(<RequestTimeOff load={{ status: 'loading' }} />);
    expect(screen.getByText('Loading the request panel')).toBeTruthy();
    expect(screen.getByText('Loading your time off')).toBeTruthy();
    expect(await axeViolations(document.body)).toEqual([]);
    const retry = vi.fn();
    rerender(
      <RequestTimeOff
        load={{ status: 'error', message: 'Time Off did not answer in time', retry }}
      />,
    );
    fireEvent.click(panel().getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
    // Answered, though without the overview: nothing waits behind the panel.
    expect(screen.queryByText('Loading your time off')).toBeNull();
  });

  it('says plainly why somebody Time Off does not hold cannot request, with nothing loading behind', () => {
    const why =
      'Time Off does not have you as an employee yet, so there is no time off or attendance of yours here. There will be once HR hires you in People.';
    render(<RequestTimeOff load={{ status: 'error', message: why, refused: true }} />);
    expect(panel().getByText('You can’t request time off yet')).toBeTruthy();
    expect(panel().getByText(why)).toBeTruthy();
    expect(panel().queryByText('Could not load the request panel')).toBeNull();
    expect(panel().queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByText('Loading your time off')).toBeNull();
  });

  it('draws nothing behind the panel when Time Off sent no overview', () => {
    render(<RequestTimeOff load={ready({ ...opening(), overview: null })} />);
    expect(screen.queryByText('Loading your time off')).toBeNull();
    expect(panel().getByRole('radiogroup', { name: 'Type' })).toBeTruthy();
  });
});

describe('going below zero', () => {
  it('offers T5’s choice: borrow, suggested; unpaid, not yet; or shorten to what fits', async () => {
    const onAsk = vi.fn();
    render(<RequestTimeOff load={ready(december())} onAsk={onAsk} />);
    expect(panel().getByText('This takes you 1.5 days below zero')).toBeTruthy();
    expect(panel().getByText('Your 2027 allowance starts at 23.5')).toBeTruthy();
    expect(panel().getByText('Marco and HR, in that order.')).toBeTruthy();
    const instead = within(panel().getByRole('radiogroup', { name: 'Or instead' }));
    expect(instead.getByRole('radio', { name: 'Borrow 1.5 days from 2027' })).toBeChecked();
    expect(instead.getByRole('radio', { name: 'Make 1.5 days unpaid' })).toBeDisabled();
    fireEvent.click(instead.getByRole('radio', { name: /Shorten to 14–22 Dec/ }));
    expect(onAsk).toHaveBeenLastCalledWith({ to: '2026-12-22', half: '1' }, 'replace');
    expect(panel().getByRole('button', { name: 'Send to Marco and HR' })).toBeEnabled();
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('refuses past the limit, with the limit, and offers to shorten', () => {
    const data = december();
    const preview = data.preview;
    if (preview === null) throw new Error('fixture');
    render(
      <RequestTimeOff
        load={ready({
          ...data,
          preview: {
            ...preview,
            negative: {
              ...preview.negative,
              kind: 'refused',
              limit: '3.000',
              days: null,
              nextYearStartsAt: null,
            },
          },
        })}
      />,
    );
    expect(panel().getByText('This goes past the 3 days you can go below zero')).toBeTruthy();
    expect(panel().getByRole('radio', { name: /Shorten to/ })).toBeTruthy();
    expect(panel().getByRole('button', { name: 'Send to Marco and HR' })).toBeDisabled();
  });
});
