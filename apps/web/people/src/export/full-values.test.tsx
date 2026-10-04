import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { fast } from '../test/user';
import { WebhookLog } from '../settings/integrations/webhook-log';
import { renderReview } from '../review/review.fixture';
import type { FullValuesRequest, FullValuesState } from './full-values';

const pending: FullValuesRequest = {
  id: 'r1',
  state: 'pending',
  mine: false,
  requestedBy: 'Adam Ruiz',
  reason: 'September payroll',
  fields: ['NIF / NIE'],
  requestedAt: '2026-09-24T09:00:00.000Z',
  expiresAt: '2026-10-01T09:00:00.000Z',
  note: null,
  link: null,
};

const state = (over: Partial<FullValuesState> = {}): FullValuesState => ({
  canRequest: false,
  canDecide: false,
  fields: [],
  requests: [],
  ...over,
});

const done = () => Promise.resolve({ ok: true as const });

const FINANCE = { hr: false, admin: false, finance: true };

describe('full values in Review (PEO-121, design E4, E11)', () => {
  it('lets finance ask for masked fields, with a reason', async () => {
    const onRequestFullValues = vi.fn(done);
    const { container } = renderReview(
      {
        roles: FINANCE,
        fullValues: state({ canRequest: true, fields: [{ key: 'es_nif', label: 'NIF / NIE' }] }),
      },
      { onRequestFullValues },
    );
    expect(await axeViolations(container)).toEqual([]);
    const user = fast();
    await user.click(screen.getByRole('button', { name: 'Ask HR' }));
    expect(onRequestFullValues).not.toHaveBeenCalled();
    expect(screen.getByText('Choose at least one field.')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'NIF / NIE' }));
    await user.type(screen.getByRole('textbox', { name: /Reason/ }), 'September payroll');
    await user.click(screen.getByRole('button', { name: 'Ask HR' }));
    expect(onRequestFullValues).toHaveBeenCalledWith(['es_nif'], 'September payroll');
    expect(await screen.findByText(/HR has seven days/)).toBeInTheDocument();
  });

  it('gives the requester the one download', () => {
    renderReview({
      roles: FINANCE,
      fullValues: state({
        canRequest: true,
        requests: [{ ...pending, mine: true, state: 'issued', link: 'https://files.test/x' }],
      }),
    });
    expect(screen.getByRole('link', { name: 'Download, once' })).toHaveAttribute(
      'href',
      'https://files.test/x',
    );
  });

  it('gives HR the decision, in the same pane as every other kind, confirmed in a dialog', async () => {
    const onDecideFullValues = vi.fn(done);
    renderReview(
      { fullValues: state({ canDecide: true, requests: [pending] }) },
      { kind: 'access', onDecideFullValues },
    );
    expect(screen.queryByRole('link')).toBeNull();
    const detail = screen.getByRole('region', { name: /Adam Ruiz/ });
    expect(within(detail).getByText('These values are masked everywhere else')).toBeInTheDocument();
    const user = fast();
    await user.click(screen.getByRole('button', { name: 'Approve the request from Adam Ruiz' }));
    const dialog = screen.getByRole('dialog', { name: 'Allow the request' });
    expect(await axeViolations(document.body)).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Allow' }));
    expect(onDecideFullValues).toHaveBeenCalledWith('r1', true, null);
  });

  it('says when nothing waits to be decided', () => {
    renderReview({ fullValues: state({ canDecide: true }) }, { kind: 'access' });
    expect(screen.getByText('Nothing to decide')).toBeInTheDocument();
  });
});

describe('the webhook delivery log (PEO-121)', () => {
  it('shows a failed delivery and replays it', async () => {
    const onReplay = vi.fn(done);
    const { container } = render(
      <WebhookLog
        load={{
          status: 'ready',
          data: {
            endpoint: { id: 'e1', url: 'https://hooks.example.com/people', enabled: true },
            deliveries: [
              {
                id: 'd1',
                eventName: 'people.person.hired',
                status: 'failed',
                attempts: 12,
                lastResponse: 500,
                createdAt: '2026-09-24T09:00:00.000Z',
                deliveredAt: null,
                replayOf: null,
              },
            ],
            next: null,
          },
        }}
        onReplay={onReplay}
      />,
    );
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('HTTP 500')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
    await fast().click(screen.getByRole('button', { name: /^Replay people\.person\.hired/ }));
    expect(onReplay).toHaveBeenCalledWith('d1');
    expect(await screen.findByText(/Replayed\./)).toBeInTheDocument();
  });

  it('loads older deliveries as it scrolls, from the last page’s cursor, with no Older button', async () => {
    const delivery = (id: string, eventName: string) => ({
      id,
      eventName,
      status: 'delivered',
      attempts: 1,
      lastResponse: 200,
      createdAt: '2026-09-24T09:00:00.000Z',
      deliveredAt: '2026-09-24T09:00:01.000Z',
      replayOf: null,
    });
    const endpoint = { id: 'e1', url: 'https://hooks.example.com/people', enabled: true };
    const onLoadMore = vi.fn(() =>
      Promise.resolve({
        endpoint,
        deliveries: [delivery('d2', 'people.person.terminated')],
        next: null,
      }),
    );
    render(
      <WebhookLog
        load={{
          status: 'ready',
          data: { endpoint, deliveries: [delivery('d1', 'people.person.hired')], next: 'seq-1' },
        }}
        onReplay={vi.fn(done)}
        onLoadMore={onLoadMore}
      />,
    );
    expect(await screen.findByText('people.person.terminated')).toBeInTheDocument();
    expect(onLoadMore).toHaveBeenCalledWith('seq-1');
    expect(screen.queryByRole('button', { name: 'Older' })).toBeNull();
  });
});
