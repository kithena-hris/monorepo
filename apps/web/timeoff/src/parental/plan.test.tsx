import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ParentalPlan as Framed } from '../index';
import { axeViolations } from '../test/axe';
import { draftPlan, entitlement, parental, sentPlan } from './acme.fixture';
import { ParentalPlan, type ParentalData } from './plan';

/**
 * Planning parental leave (T8–T10, MT11, MT12) in each state it can be
 * handed, on Adam's plan. Every state passes axe.
 */

/** Lets a write the screen started resolve, and React draw what came back. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
const ready = (data: ParentalData) => ({ status: 'ready' as const, data });
const ok = () => Promise.resolve({ ok: true as const });

describe('plan parental leave', () => {
  it('T8: asks the four questions first when there is no plan, whatever the step', async () => {
    const { container } = render(
      <ParentalPlan load={ready(parental({ plan: null, step: 'plan' }))} onAnswer={vi.fn()} />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Plan parental leave' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'You are' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Family' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'What your team sees' })).toBeTruthy();
    expect(
      screen.getByText('HR and Marco always see the type. You can change this later.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next: your plan' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByText(/Say who you are and the date/)).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('T8: shows the entitlement in plain numbers and saves the answers, then lays the plan out', async () => {
    const onPreview = vi.fn(() => Promise.resolve({ ok: true as const, entitlement }));
    const onAnswer = vi.fn(ok);
    const onNavigate = vi.fn();
    render(
      <ParentalPlan
        load={ready(parental({ step: 'about', plan: draftPlan() }))}
        onPreview={onPreview}
        onAnswer={onAnswer}
        onNavigate={onNavigate}
      />,
    );
    await waitFor(() => {
      expect(onPreview).toHaveBeenCalledWith({
        role: 'other_parent',
        childDate: '2027-01-14',
        singleParent: false,
        children: 1,
      });
    });
    const card = within(
      screen.getByRole('heading', { name: 'What you’re entitled to' }).closest('section') ??
        document.body,
    );
    expect(card.getByText('Any time before 14 Jan 2028')).toBeTruthy();
    expect(card.getByText('Any time before your child turns 8')).toBeTruthy();
    expect(card.getByText('19 weeks, paid at 100% by Social Security')).toBeTruthy();
    expect(card.getByText('Your company adds 2 weeks, paid')).toBeTruthy();
    expect(card.getByText('You keep earning vacation')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'Just “Away”' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next: your plan' }));
    await settle();
    expect(onAnswer).toHaveBeenCalledWith({
      role: 'other_parent',
      childDate: '2027-01-14',
      singleParent: false,
      children: 1,
      teamSees: 'away',
    });
    expect(onNavigate).toHaveBeenCalledWith('/time-off/parental/plan');
  });

  it('T9: lays the plan out on its track, with pay, the reasons and the notice reminders', async () => {
    const { container } = render(<ParentalPlan load={ready(parental())} onBlocks={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Your plan · 21 weeks' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Next: handover' }).getAttribute('href')).toBe(
      '/time-off/parental/handover',
    );
    expect(screen.getAllByText('6 weeks · 14 Jan – 24 Feb').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2 weeks until 2035').length).toBeGreaterThan(0);
    const pay = within(
      screen.getByRole('heading', { name: 'Pay while you’re away' }).closest('section') ??
        document.body,
    );
    expect(pay.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Social Security100% of your regulatory base14 Jan – 21 Apr',
      'Your companyNormal pay22 Apr – 11 May',
      'Social Security100% of your regulatory base2–22 Aug',
    ]);
    expect(
      screen.getByText(
        '8 of your 11 flexible weeks follow the mandatory 6, so you’re home until Tue 11 May 2027.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Each flexible block needs 15 days’ notice. You’re reminded on 10 Feb, 18 Jul.',
      ),
    ).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('T9: a block dragged a week along the track is saved with every other block as it was', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 0, width: 790, height: 40 }),
    );
    const onBlocks = vi.fn(ok);
    render(<ParentalPlan load={ready(parental())} onBlocks={onBlocks} />);
    const bar = screen.getByRole('button', { name: /3 weeks · 2–22 Aug/ });
    bar.focus();
    for (const code of ['Space', 'ArrowRight', 'Space']) {
      fireEvent.keyDown(bar, { code });
      // oxlint-disable-next-line no-await-in-loop -- each key after dnd-kit's next tick, in order
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    }
    expect(onBlocks).toHaveBeenCalledWith('0189aaaa-0000-7000-8000-0000000000aa', [
      { kind: 'mandatory', from: '2027-01-14', to: '2027-02-24' },
      { kind: 'flexible', from: '2027-02-25', to: '2027-04-21' },
      { kind: 'vacation', from: '2027-04-22', to: '2027-04-27' },
      { kind: 'company', from: '2027-04-28', to: '2027-05-11' },
      { kind: 'flexible', from: '2027-08-09', to: '2027-08-29' },
    ]);
    // The mandatory weeks are pinned to the birth.
    expect(screen.queryByRole('button', { name: /Mandatory, 6 weeks/ })).toBeNull();
    vi.restoreAllMocks();
  });

  it('MT11: lists the blocks down the page, one per period', () => {
    render(<ParentalPlan load={ready(parental())} />);
    const list = within(screen.getByRole('list', { name: 'Your plan, block by block' }));
    expect(list.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '6 weeks, mandatoryFrom the birth · due 14 Jan14 Jan – 24 Feb · full time',
      '8 weeks flexible25 Feb – 21 AprGive notice by 10 Feb',
      '6 days of vacation22–27 AprNormal pay',
      '2 weeks from your company28 Apr – 11 MayNormal pay',
      '3 weeks flexible2–22 AugGive notice by 18 Jul',
      '2 weeks kept for laterUntil 2035Book any time',
    ]);
  });

  it('says which rule a dragged block breaks, from Time Off', () => {
    render(
      <ParentalPlan
        load={ready(
          parental({
            plan: draftPlan({
              problems: [
                { code: 'WHOLE_WEEKS', message: 'Flexible weeks are taken in whole weeks' },
              ],
            }),
          }),
        )}
      />,
    );
    expect(screen.getByText('This plan can’t be sent yet')).toBeTruthy();
    expect(screen.getByText('Flexible weeks are taken in whole weeks')).toBeTruthy();
  });

  it('T10: hands work over, shows the integrations off, and saves before the summary', async () => {
    const onHandover = vi.fn(ok);
    const onNavigate = vi.fn();
    const { container } = render(
      <ParentalPlan
        load={ready(parental({ step: 'handover' }))}
        onHandover={onHandover}
        onNavigate={onNavigate}
      />,
    );
    expect(screen.getByText('Billing v2 code reviews')).toBeTruthy();
    for (const name of ['Out-of-office reply', 'Chat status', 'Recurring meetings']) {
      expect(screen.getByRole('switch', { name })).toHaveProperty('disabled', true);
    }
    expect(screen.getByText(/Needs the chat integration/)).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Work' }), {
      target: { value: 'On-call, week of 1 Feb' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Covered by' }), {
      target: { value: 'Omar Haddad' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Next: send' }));
    await settle();
    expect(onHandover).toHaveBeenCalledWith(
      '0189aaaa-0000-7000-8000-0000000000aa',
      [
        { work: 'Billing v2 code reviews', coveredBy: 'Leo Rossi' },
        { work: 'On-call, week of 1 Feb', coveredBy: 'Omar Haddad' },
      ],
      'type',
    );
    expect(onNavigate).toHaveBeenCalledWith('/time-off/parental/send');
  });

  it('T10: sends a plan that keeps the rules, private until then', async () => {
    const onSend = vi.fn(ok);
    const { container } = render(
      <ParentalPlan load={ready(parental({ step: 'send' }))} onSend={onSend} />,
    );
    expect(screen.getByText('Private until you send it')).toBeTruthy();
    expect(screen.getByText('The dates follow the birth')).toBeTruthy();
    expect(screen.getByText('19 weeks + 2 weeks from your company')).toBeTruthy();
    expect(screen.getByText('Wed 12 May 2027')).toBeTruthy();
    expect(screen.getByText('HR, Marco Ruiz. Team sees “Parental leave”')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Send to HR and Marco' }));
    await settle();
    expect(onSend).toHaveBeenCalledWith('0189aaaa-0000-7000-8000-0000000000aa');
  });

  it('will not send a plan that breaks a rule', () => {
    render(
      <ParentalPlan
        load={ready(
          parental({
            step: 'send',
            plan: draftPlan({ problems: [{ code: 'OVERLAP', message: 'Two blocks overlap' }] }),
          }),
        )}
        onSend={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Send to HR and Marco' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('shows a sent plan as sent, with the birth to record', async () => {
    const onBirth = vi.fn(ok);
    const { container } = render(
      <ParentalPlan
        load={ready(parental({ step: 'about', plan: sentPlan() }))}
        onBirth={onBirth}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Your parental leave' })).toBeTruthy();
    expect(screen.getByText('With HR and Marco')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Record the birth' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.queryByRole('radiogroup', { name: 'You are' })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('says so when the person is not a member, or their country has no pack', () => {
    const { unmount } = render(<ParentalPlan load={ready(parental({ member: null }))} />);
    expect(screen.getByText(/Plans belong to the person taking the leave/)).toBeTruthy();
    unmount();
    render(<ParentalPlan load={ready(parental({ supported: false }))} />);
    expect(screen.getByText(/The law where you work isn’t in Time Off yet/)).toBeTruthy();
  });

  it('loads in its shape, and says what failed', async () => {
    const { container, unmount } = render(<ParentalPlan load={{ status: 'loading' }} />);
    expect(screen.getByText('Loading your parental leave plan')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
    unmount();
    render(<ParentalPlan load={{ status: 'error', message: 'Time Off is not answering' }} />);
    expect(screen.getByText('Could not load your parental leave plan')).toBeTruthy();
  });

  it('is framed by the host', () => {
    render(<Framed load={ready(parental())} frame={{ section: 'Overview' }} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Plan parental leave' })).toBeTruthy();
  });
});
