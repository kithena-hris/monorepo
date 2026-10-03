import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Approvals as Framed } from '../index';
import { axeViolations } from '../test/axe';
import { adam, adamsDecision, comingUp, deciding, leo, waiting, written } from './acme.fixture';
import { Approvals, type ApprovalsData } from './approvals';

/**
 * Requests for an approver (T16–T18, MT15, MT16) on Acme's demo data: Marco
 * on 1 October 2026, with Leo, Ravi and Hana clear and Adam and Omar to look
 * at. Every state passes axe.
 */

const ready = (data: ApprovalsData) => ({ status: 'ready' as const, data });
const ok = () => Promise.resolve({ ok: true as const });
const group = (name: RegExp) => {
  const section = screen.getByRole('heading', { name }).closest('section');
  if (section === null) throw new Error(`no group ${String(name)}`);
  return within(section);
};

describe('waiting for me (T16)', () => {
  it('splits the queue into clear and look closer, each row with its one line', async () => {
    const { container } = render(
      <Approvals load={ready(waiting())} path="/time-off/approvals/waiting" />,
    );
    const clear = group(/Clear to approve/);
    expect(clear.getAllByRole('listitem').map((li) => li.querySelector('a')?.textContent)).toEqual([
      'Leo Rossi',
      'Ravi Patel',
      'Hana Kim',
    ]);
    expect(clear.getByText('Vacation · 26–30 Oct · 5 days')).toBeTruthy();
    expect(clear.getByText('Self-certified, under the days that need a note.')).toBeTruthy();
    const closer = group(/Look closer/);
    expect(closer.getByText('Below the team minimum on Wed 21 Oct.')).toBeTruthy();
    expect(closer.getByText('Would take Omar to −1.5 days. Needs HR after you.')).toBeTruthy();
    expect(closer.getByRole('link', { name: 'Adam Novak' }).getAttribute('href')).toBe(
      `/time-off/approvals/waiting/${adam.requestId}`,
    );
    expect(screen.getByText(/The order never decides for you/)).toBeTruthy();
    expect(screen.getByText('Today 08:10')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('tags a line AI only where a model wrote it', () => {
    const data = waiting();
    render(
      <Approvals
        load={ready({
          ...data,
          why: data.why.map((w) =>
            w.requestId === leo.requestId
              ? { ...w, text: written('Leo is fine: 5 of 7 stay in.', true) }
              : w,
          ),
        })}
        path="/time-off/approvals/waiting"
      />,
    );
    const rows = group(/Clear to approve/).getAllByRole('listitem');
    expect(within(rows[0] as HTMLElement).getByText('AI')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).queryByText('AI')).toBeNull();
    expect(group(/Look closer/).queryByText('AI')).toBeNull();
  });

  it('tags What to know AI when a model wrote its closing line, and not otherwise', () => {
    const decision = adamsDecision();
    const { rerender } = render(
      <Approvals
        load={ready({ ...deciding(), decision })}
        path={`/time-off/approvals/waiting/${adam.requestId}`}
      />,
    );
    const card = () =>
      within(
        screen.getByRole('heading', { name: 'What to know' }).closest('.flex-col') as HTMLElement,
      );
    expect(card().queryByText('AI')).toBeNull();
    rerender(
      <Approvals
        load={ready({
          ...deciding(),
          decision: { ...decision, whatToKnow: written('Likely fine: Leo can ship both.', true) },
        })}
        path={`/time-off/approvals/waiting/${adam.requestId}`}
      />,
    );
    expect(card().getByText('Likely fine: Leo can ship both.')).toBeTruthy();
    expect(card().getByText('AI')).toBeTruthy();
  });

  it('approves all the clear ones and none of the rest, or the ones still ticked', async () => {
    const onApprove = vi.fn(ok);
    render(
      <Approvals
        load={ready(waiting())}
        path="/time-off/approvals/waiting"
        onApprove={onApprove}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve all 3' }));
    expect(onApprove).toHaveBeenLastCalledWith(waiting().clear.map((i) => i.requestId));
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Include Leo Rossi’s request in Approve all' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Approve 2' }));
    expect(onApprove).toHaveBeenLastCalledWith(
      waiting()
        .clear.filter((i) => i.requestId !== leo.requestId)
        .map((i) => i.requestId),
    );
  });

  it('decides one row, and says so when Time Off refuses', async () => {
    const onDecide = vi.fn(() =>
      Promise.resolve({ ok: false as const, message: 'Already decided' }),
    );
    render(
      <Approvals load={ready(waiting())} path="/time-off/approvals/waiting" onDecide={onDecide} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve Ravi Patel’s request' }));
    expect(onDecide).toHaveBeenCalledWith(waiting().clear[1]?.requestId, 'approve');
    expect(await screen.findByText('Already decided')).toBeTruthy();
  });

  it('says when nothing waits', async () => {
    const { container } = render(
      <Approvals
        load={ready({ ...waiting(), clear: [], lookCloser: [] })}
        path="/time-off/approvals/waiting"
      />,
    );
    expect(screen.getByText('Nothing is waiting for you')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('deciding one request (T17)', () => {
  it('shows the balance shift, the team around the dates and what to know', async () => {
    const { container } = render(
      <Approvals load={ready(deciding())} path={`/time-off/approvals/waiting/${adam.requestId}`} />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Adam Novak · vacation' })).toBeTruthy();
    expect(screen.getByText('Sent yesterday · decide by Mon 5 Oct')).toBeTruthy();
    expect(screen.getByText('19–23 Oct · 5 days')).toBeTruthy();
    expect(screen.getByText('Vacation balance')).toBeTruthy();
    expect(screen.getByText('6.5')).toBeTruthy();
    // en-GB's September is "Sept".
    expect(screen.getByText('4 Sept')).toBeTruthy();
    const team = screen.getByRole('region', { name: 'Platform around 19–23 Oct' });
    expect(within(team).getByText(/Wednesday 21 October: 4 of 7 in/)).toBeTruthy();
    expect(screen.getByText('Wed 21: 4 of 7 in')).toBeTruthy();
    expect(screen.getByText('Omar and Yuki are off. The team asks for 5.')).toBeTruthy();
    expect(screen.getByText('This might be fine if 4 people can cover on Wed 21.')).toBeTruthy();
    expect(screen.getByText('Suggest: swap Wed 21 for Mon 26')).toBeTruthy();
    expect(container.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe(
      `/time-off/approvals/waiting/${adam.requestId}`,
    );
    expect(screen.getByRole('link', { name: 'Suggest other dates' }).getAttribute('href')).toBe(
      `/time-off/approvals/waiting/${adam.requestId}/suggest`,
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it('approves, then goes back to the queue', async () => {
    const onDecide = vi.fn(ok);
    const onNavigate = vi.fn();
    render(
      <Approvals
        load={ready(deciding())}
        path={`/time-off/approvals/waiting/${adam.requestId}`}
        onDecide={onDecide}
        onNavigate={onNavigate}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onDecide).toHaveBeenCalledWith(adam.requestId, 'approve');
    await vi.waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith('/time-off/approvals/waiting');
    });
  });
});

describe('suggesting other dates (T18)', () => {
  it('offers the domain’s dates with their coverage, drafts the message and sends the choice', async () => {
    const onSuggest = vi.fn(ok);
    const onNavigate = vi.fn();
    render(
      <Framed
        load={ready(deciding())}
        path={`/time-off/approvals/waiting/${adam.requestId}/suggest`}
        onSuggest={onSuggest}
        onNavigate={onNavigate}
      />,
    );
    const dialog = within(screen.getByRole('dialog', { name: 'Suggest other dates to Adam' }));
    expect(dialog.getByRole('radio', { name: /19, 20, 22, 23 and 26 Oct/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(dialog.getAllByText('Keeps 5 of 7 in every day')).toHaveLength(2);
    expect(dialog.getByRole('radio', { name: /26–30 Oct/ })).toBeTruthy();
    expect(dialog.getByRole('textbox', { name: 'Message' })).toHaveProperty(
      'value',
      'Hi Adam, could you swap Wed 21 for Mon 26? Omar and Yuki are out on the day you asked. Happy to approve straight away if that works.',
    );
    fireEvent.click(dialog.getByRole('radio', { name: /26–30 Oct/ }));
    expect(dialog.getByRole('textbox', { name: 'Message' })).toHaveProperty(
      'value',
      'Hi Adam, could you take 26–30 Oct instead? Omar and Yuki are out on the day you asked. Happy to approve straight away if that works.',
    );
    fireEvent.click(dialog.getByRole('button', { name: 'Send suggestion' }));
    expect(onSuggest).toHaveBeenCalledWith(
      adam.requestId,
      [{ spans: [{ from: '2026-10-26', to: '2026-10-30' }] }],
      'Hi Adam, could you take 26–30 Oct instead? Omar and Yuki are out on the day you asked. Happy to approve straight away if that works.',
    );
    await vi.waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith('/time-off/approvals/waiting');
    });
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('closes back to the request', () => {
    const onNavigate = vi.fn();
    render(
      <Framed
        load={ready(deciding())}
        path={`/time-off/approvals/waiting/${adam.requestId}/suggest`}
        onNavigate={onNavigate}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onNavigate).toHaveBeenCalledWith(`/time-off/approvals/waiting/${adam.requestId}`);
  });
});

describe('coming up and decided', () => {
  it('lists the requests with their status', async () => {
    const { container } = render(
      <Approvals load={ready(comingUp())} path="/time-off/approvals/coming-up" />,
    );
    expect(screen.getByRole('link', { name: /^Omar Haddad/ }).getAttribute('href')).toMatch(
      /^\/time-off\/requests\//,
    );
    expect(screen.getAllByText('Approved')).toHaveLength(2);
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('the states around it', () => {
  it('loads in the shape of the tab, and fails with a way to try again', async () => {
    const { container, rerender } = render(
      <Approvals
        load={{ status: 'loading' }}
        path={`/time-off/approvals/waiting/${adam.requestId}`}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('Loading requests');
    expect(screen.getByRole('heading', { level: 1, name: 'Requests' })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
    const retry = vi.fn();
    rerender(<Approvals load={{ status: 'error', message: 'Time Off did not answer', retry }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });

  it('takes the host’s frame', () => {
    render(
      <Framed
        load={ready(waiting())}
        frame={{
          section: 'Requests',
          tabs: [
            {
              href: '/time-off/approvals/waiting',
              label: 'Waiting for me',
              current: true,
              count: 5,
            },
          ],
        }}
      />,
    );
    expect(screen.getByRole('navigation', { name: 'Requests tabs' })).toBeTruthy();
  });
});
