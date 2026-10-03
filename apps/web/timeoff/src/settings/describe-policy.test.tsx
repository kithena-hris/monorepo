import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DescribePolicy as Framed } from '../index';
import { axeViolations } from '../test/axe';
import { berlinRead, BERLIN_TEXT } from './acme.fixture';
import { DescribePolicy, type PolicyReadData } from './describe-policy';

/**
 * Write a policy in plain words (T32) on Ada's paragraph for Berlin: the
 * rules Time Off understood, the question it asks, and Create draft.
 */

const ready = (data: PolicyReadData) => ({ status: 'ready' as const, data });
const understood = () =>
  within(
    screen.getByRole('heading', { name: 'Understood as' }).closest('.flex-col') as HTMLElement,
  );

describe('a policy in plain words (T32)', () => {
  it('shows the rules it understood and asks the one question the text leaves open', async () => {
    const { container } = render(<Framed load={ready(berlinRead())} />);
    expect(screen.getByRole('heading', { level: 1, name: 'New policy' })).toBeTruthy();
    expect(
      screen.getByRole('textbox', { name: 'The policy, as it is in the handbook' }),
    ).toHaveProperty('value', BERLIN_TEXT);
    const card = understood();
    expect(card.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Allowance28 days a year, given up front',
      'StartsFrom the first day',
      'Carry-overUp to 5 days, used by 31 Mar',
      'NegativeUp to 2 days, manager then HR',
    ]);
    expect(card.getByText('“28 days”, but which days?')).toBeTruthy();
    expect(card.queryByText('AI')).toBeNull();
    // A question still open: nothing to create yet.
    expect(screen.getByRole('button', { name: 'Create draft' })).toHaveProperty('disabled', true);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('answers the question, changes a rule and reads new text, each through the address', () => {
    const onAsk = vi.fn();
    render(<DescribePolicy load={ready(berlinRead())} onAsk={onAsk} />);
    fireEvent.click(screen.getByRole('button', { name: 'Calendar days' }));
    expect(onAsk).toHaveBeenLastCalledWith({ days: 'calendar' }, 'replace');
    fireEvent.click(screen.getByRole('button', { name: 'Change Carry-over' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Days carried over' }), {
      target: { value: '7' },
    });
    fireEvent.blur(screen.getByRole('spinbutton', { name: 'Days carried over' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use this' }));
    expect(onAsk).toHaveBeenLastCalledWith({ carry: '7' }, 'replace');
    const box = screen.getByRole('textbox', { name: 'The policy, as it is in the handbook' });
    fireEvent.change(box, { target: { value: 'Everyone gets 25 days a year.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read it' }));
    expect(onAsk).toHaveBeenLastCalledWith(
      {
        text: 'Everyone gets 25 days a year.',
        days: null,
        earning: null,
        allowance: null,
        probation: null,
        carry: null,
        negative: null,
      },
      'push',
    );
  });

  it('creates an ordinary draft once nothing is open, then opens it on its leave type', async () => {
    const onCreate = vi.fn(() => Promise.resolve({ ok: true as const, policyId: 'p-1' }));
    const onNavigate = vi.fn();
    const data = berlinRead({ question: null, ai: true });
    render(<DescribePolicy load={ready(data)} onCreate={onCreate} onNavigate={onNavigate} />);
    expect(understood().getByText('AI')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    expect(onCreate).toHaveBeenCalledWith(data.definition);
    await waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith('/settings/time-off/leave-types/vacation?policy=p-1');
    });
  });

  it('says what is missing, and why a draft was refused', async () => {
    const onCreate = vi.fn(() =>
      Promise.resolve({ ok: false as const, message: 'tenure bands climb, one start year each' }),
    );
    const { rerender } = render(
      <DescribePolicy
        load={ready(
          berlinRead({
            rules: [],
            question: null,
            definition: null,
            problems: [
              {
                path: 'allowance',
                message: 'The text does not say how many days a year people get.',
              },
            ],
          }),
        )}
      />,
    );
    expect(screen.getByText('The text does not say how many days a year people get.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create draft' })).toHaveProperty('disabled', true);
    rerender(<DescribePolicy load={ready(berlinRead({ question: null }))} onCreate={onCreate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    expect(await screen.findByText('tenure bands climb, one start year each')).toBeTruthy();
  });
});
