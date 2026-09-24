import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { fast } from '../test/user';
import { WebhookLog } from '../settings/integrations/webhook-log';
import { FullValues, type FullValuesRequest, type FullValuesState } from './full-values';

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

describe('full values (PEO-121)', () => {
  it('lets finance ask for masked fields, with a reason', async () => {
    const onRequest = vi.fn(done);
    const { container } = render(
      <FullValues
        load={{
          status: 'ready',
          data: state({ canRequest: true, fields: [{ key: 'es_nif', label: 'NIF / NIE' }] }),
        }}
        onRequest={onRequest}
        onDecide={vi.fn(done)}
      />,
    );
    expect(await axeViolations(container)).toEqual([]);
    const user = fast();
    await user.click(screen.getByRole('button', { name: 'Ask HR' }));
    expect(onRequest).not.toHaveBeenCalled();
    await user.click(screen.getByRole('checkbox', { name: 'NIF / NIE' }));
    await user.type(screen.getByRole('textbox', { name: /Reason/ }), 'September payroll');
    await user.click(screen.getByRole('button', { name: 'Ask HR' }));
    expect(onRequest).toHaveBeenCalledWith(['es_nif'], 'September payroll');
    expect(await screen.findByText(/HR has seven days/)).toBeInTheDocument();
  });

  it('gives the requester the one download, and HR the decision', async () => {
    const onDecide = vi.fn(done);
    const { rerender } = render(
      <FullValues
        load={{
          status: 'ready',
          data: state({
            canRequest: true,
            requests: [{ ...pending, mine: true, state: 'issued', link: 'https://files.test/x' }],
          }),
        }}
        onRequest={vi.fn(done)}
        onDecide={onDecide}
      />,
    );
    expect(screen.getByRole('link', { name: 'Download, once' })).toHaveAttribute(
      'href',
      'https://files.test/x',
    );

    rerender(
      <FullValues
        load={{ status: 'ready', data: state({ canDecide: true, requests: [pending] }) }}
        onRequest={vi.fn(done)}
        onDecide={onDecide}
      />,
    );
    expect(screen.queryByRole('link')).toBeNull();
    const user = fast();
    await user.click(screen.getByRole('button', { name: 'Approve the request from Adam Ruiz' }));
    const dialog = screen.getByRole('dialog', { name: 'Approve the request' });
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    expect(onDecide).toHaveBeenCalledWith('r1', true, null);
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
});
