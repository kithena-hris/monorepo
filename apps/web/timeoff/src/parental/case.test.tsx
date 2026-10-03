import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ParentalCase as Framed } from '../index';
import { axeViolations } from '../test/axe';
import { adamCase, sentPlan } from './acme.fixture';
import { ParentalCase, type ParentalCaseData } from './case';

/** HR's view of Adam's case (T11) in each state it can be handed. Every state passes axe. */

/** Lets a write the screen started resolve, and React draw what came back. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
const ready = (data: ParentalCaseData) => ({ status: 'ready' as const, data });
const part = (name: string) =>
  within(screen.getByRole('heading', { name }).closest('section') ?? document.body);

describe('HR’s view of the case', () => {
  it('shows the plan, the checklist with the other modules’ steps linked, and who sees it', async () => {
    const { container } = render(<ParentalCase load={ready(adamCase())} onApprove={vi.fn()} />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Adam Novak · parental leave' }),
    ).toBeTruthy();
    expect(screen.getByText('Sent 1 Oct · due 14 Jan 2027 · back 12 May 2027')).toBeTruthy();
    const checklist = part('Checklist');
    expect(checklist.getByText('2 of 6')).toBeTruthy();
    expect(checklist.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Entitlement checked19 weeks by law, 2 weeks from the company.Done',
      'Marco toldSent the plan on 1 Oct.Done',
      'Company certificate for Social SecurityDrafted from Adam’s pay history once you confirm it. Needs your signature.To do',
      'Pause salary in Payroll14 Jan – 11 May, for the weeks Social Security pays.Payroll module',
      'Add the baby as a dependentHealth insurance in Benefits, after the birth certificate.Benefits module',
      'Birth certificateTime Off asks Adam for it on 17 Jan, 3 days after the due date.Scheduled',
    ]);
    const who = part('Who can see this');
    expect(who.getByText('Dates and handover')).toBeTruthy();
    expect(who.getByText('“Parental leave”, dates')).toBeTruthy();
    expect(who.getByText('Everything, plus documents')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('runs the rules check from Time Off: what passed, and the notice each block owes', () => {
    render(<ParentalCase load={ready(adamCase())} />);
    const rules = part('Checked against the rules');
    expect(rules.getByText('Flexible weeks are taken in whole weeks')).toBeTruthy();
    expect(rules.getByText('Flexible weeks end before 14 Jan 2028')).toBeTruthy();
    expect(rules.getByText('The block from 2 Aug needs 15 days’ notice')).toBeTruthy();
    expect(rules.getByText('Adam is reminded on 18 Jul. Nothing to do now.')).toBeTruthy();
  });

  it('names a broken rule in the domain’s words', () => {
    render(
      <ParentalCase
        load={ready(
          adamCase({
            canApprove: false,
            plan: sentPlan({
              problems: [
                { code: 'FLEXIBLE_DEADLINE', message: 'Flexible weeks end before 2028-01-14' },
              ],
            }),
          }),
        )}
      />,
    );
    expect(
      part('Checked against the rules').getByText('Flexible weeks end before 2028-01-14'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve plan' })).toBeNull();
  });

  it('approves when Time Off says HR may, and says why when it is refused', async () => {
    const onApprove = vi.fn(() => Promise.resolve({ ok: false as const, message: 'Refused' }));
    render(<ParentalCase load={ready(adamCase())} onApprove={onApprove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve plan' }));
    await settle();
    expect(onApprove).toHaveBeenCalledWith('0189aaaa-0000-7000-8000-0000000000aa');
    expect(screen.getByText('The plan was not approved')).toBeTruthy();
  });

  it('shows an approved plan as approved', async () => {
    const { container } = render(
      <ParentalCase
        load={ready(
          adamCase({
            canApprove: false,
            plan: sentPlan({ status: 'approved', approvedAt: '2026-10-02T09:00:00.000Z' }),
          }),
        )}
      />,
    );
    expect(screen.getByText('Approved')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('loads in its shape, and is framed by the host', async () => {
    const { container, unmount } = render(<ParentalCase load={{ status: 'loading' }} />);
    expect(screen.getByText('Loading this parental leave case')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
    unmount();
    render(<Framed load={ready(adamCase())} frame={{ section: 'Requests' }} />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Adam Novak · parental leave' }),
    ).toBeTruthy();
  });
});
