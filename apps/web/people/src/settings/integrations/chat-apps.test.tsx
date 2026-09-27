import { TooltipProvider } from '@reach/ui';
import { render as mount, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { fast } from '../../test/user';
import { axeViolations } from '../../test/axe';
import { ChatApps, type ChatAppsProps, type ChatAppsState } from './chat-apps';

const render = (ui: ReactElement) => mount(ui, { wrapper: TooltipProvider });

const state = (over: Partial<ChatAppsState> = {}): ChatAppsState => ({
  apps: [{ key: 'slack', name: 'Slack', canConnect: true, connection: null }],
  notices: [
    {
      key: 'approval_requested',
      label: 'A change needs approval',
      description: 'With buttons.',
      to: 'Approvers',
      action: 'Approve or reject',
      on: false,
    },
  ],
  fields: { on: [{ key: 'location_id', label: 'Work location' }], shareable: 9 },
  ...over,
});

const props = (over: Partial<ChatAppsProps> = {}): ChatAppsProps => ({
  onConnect: vi.fn(() =>
    Promise.resolve({ ok: false as const, message: 'Slack is not set up here.' }),
  ),
  onDisconnect: vi.fn(() => Promise.resolve({ ok: true as const })),
  onNotice: vi.fn(() => Promise.resolve({ ok: true as const })),
  fieldsHref: '/settings/people/fields',
  ...over,
});

describe('ChatApps', () => {
  it('offers to add an app that is not connected, and says why when it cannot', async () => {
    const p = props();
    render(<ChatApps {...p} state={state()} />);
    const slack = screen.getByRole('region', { name: 'Slack' });
    expect(within(slack).getByText('Not connected')).toBeTruthy();
    await fast().click(within(slack).getByRole('button', { name: 'Add to Slack' }));
    expect(p.onConnect).toHaveBeenCalledWith('slack');
    expect(await within(slack).findByText('Slack is not set up here.')).toBeTruthy();
  });

  it('names the workspace a connected app is in', () => {
    render(
      <ChatApps
        {...props()}
        state={state({
          apps: [
            {
              key: 'slack',
              name: 'Slack',
              canConnect: true,
              connection: { workspace: 'Dunder Mifflin', connectedAt: '2026-09-27T10:00:00Z' },
            },
          ],
        })}
      />,
    );
    expect(screen.getByText(/Connected to Dunder Mifflin/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
  });

  it('turns a notice on, and back off when it was not saved', async () => {
    const onNotice = vi.fn(() =>
      Promise.resolve({ ok: false as const, message: 'Only an administrator' }),
    );
    render(<ChatApps {...props({ onNotice })} state={state()} />);
    const toggle = screen.getByRole('switch', { name: 'A change needs approval' });
    await fast().click(toggle);
    expect(onNotice).toHaveBeenCalledWith('approval_requested', true);
    expect(await screen.findByText('Only an administrator')).toBeTruthy();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('has no axe violations', async () => {
    const { container } = render(<ChatApps {...props()} state={state()} />);
    expect(await axeViolations(container)).toEqual([]);
  });
});
