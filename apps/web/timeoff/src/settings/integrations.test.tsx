import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { TooltipProvider } from '@reach/ui';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { Integrations, type IntegrationsData } from './integrations';

/** T35 for Acme's HR: Microsoft connected, Google ready, Slack waiting for its app, Teams to come. */
const acme = (): IntegrationsData => ({
  integrations: [
    {
      provider: 'google',
      kind: 'calendar',
      available: true,
      configured: true,
      connected: false,
      connectedAt: null,
      account: null,
    },
    {
      provider: 'microsoft',
      kind: 'calendar',
      available: true,
      configured: true,
      connected: true,
      connectedAt: '2026-09-14T09:00:00.000Z',
      account: null,
    },
    {
      provider: 'slack',
      kind: 'chat',
      available: true,
      configured: false,
      connected: false,
      connectedAt: null,
      account: null,
    },
    {
      provider: 'teams',
      kind: 'chat',
      available: false,
      configured: false,
      connected: false,
      connectedAt: null,
      account: null,
    },
  ],
  kiosks: [
    {
      id: 'k-1',
      name: 'Main entrance',
      locationKey: 'madrid',
      lastSeenAt: '2026-10-01T06:52:00.000Z',
      revokedAt: null,
    },
  ],
  locations: [{ locationKey: 'madrid', name: 'Madrid office' }],
  packs: [
    { country: 'ES', reviewed: false, inUse: true },
    { country: 'DE', reviewed: false, inUse: false },
    { country: 'GB', reviewed: false, inUse: false },
  ],
  modules: [
    { key: 'payroll', events: ['timeoff.period.closed'] },
    { key: 'benefits', events: ['timeoff.parental.birth_recorded'] },
    { key: 'projects', events: ['timeoff.request.approved'] },
  ],
  chatAnswers: { namesPrivateLeave: false },
});

const ready = () => ({ status: 'ready' as const, data: acme() });

describe('integrations (T35)', () => {
  it('names each group by what it is, and a vendor only on its own row', async () => {
    const { container } = render(<Integrations load={ready()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Integrations' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Calendar' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Chat apps' })).toBeTruthy();
    for (const heading of screen.getAllByRole('heading')) {
      expect(heading.textContent).not.toMatch(/Google|Outlook|Slack|Teams/u);
    }
    const calendars = within(screen.getByRole('list', { name: 'Calendars' }));
    expect(calendars.getByText('Google Calendar')).toBeTruthy();
    expect(calendars.getByText('Microsoft Outlook')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('says what each provider needs: connected, ready, credentials, or not built yet', () => {
    render(<Integrations load={ready()} />);
    const row = (name: string) => screen.getByText(name).closest('li')?.textContent ?? '';
    expect(row('Microsoft Outlook')).toContain('Connected');
    expect(row('Microsoft Outlook')).toContain('Since 14 Sept');
    expect(row('Google Calendar')).toContain('Not connected');
    expect(row('Slack')).toContain('Needs credentials');
    expect(row('Microsoft Teams')).toContain('Follows Slack');
    expect(screen.queryAllByRole('button', { name: 'Connect' })).toHaveLength(1);
  });

  it('marks the modules that would read Time Off as Kithena modules', () => {
    render(<Integrations load={ready()} />);
    const modules = within(screen.getByRole('list', { name: 'Kithena modules' }));
    expect(modules.getAllByText('Kithena module')).toHaveLength(3);
    expect(modules.getByText('Payroll')).toBeTruthy();
    const countries = within(screen.getByRole('list', { name: 'Countries' }));
    expect(countries.getByText('Germany')).toBeTruthy();
    expect(countries.getAllByText('Not reviewed yet')).toHaveLength(3);
  });

  it('goes to the provider’s consent page to connect', async () => {
    const onConnect = vi.fn(() =>
      Promise.resolve({ ok: true as const, url: 'https://accounts.example/consent' }),
    );
    const onLeave = vi.fn();
    render(<Integrations load={ready()} onConnect={onConnect} onLeave={onLeave} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
      await Promise.resolve();
    });
    expect(onConnect).toHaveBeenCalledWith('google');
    expect(onLeave).toHaveBeenCalledWith('https://accounts.example/consent');
  });

  it('says so when a provider comes back connected', () => {
    render(<Integrations load={ready()} query={{ connected: 'microsoft' }} />);
    expect(screen.getByText('Microsoft Outlook is connected')).toBeTruthy();
  });

  it('adds a kiosk and shows its link once', async () => {
    const onRegisterKiosk = vi.fn(() =>
      Promise.resolve({ ok: true as const, deviceId: 'k-2', token: 'kk_shown-once' }),
    );
    render(
      <TooltipProvider>
        <Integrations load={ready()} onRegisterKiosk={onRegisterKiosk} />
      </TooltipProvider>,
    );
    expect(screen.getByText('Main entrance')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add a kiosk' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Add a kiosk' }));
    fireEvent.change(dialog.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Back door' },
    });
    await act(async () => {
      fireEvent.click(dialog.getByRole('button', { name: 'Add kiosk' }));
      await Promise.resolve();
    });
    expect(onRegisterKiosk).toHaveBeenCalledWith({ name: 'Back door', locationKey: 'madrid' });
    const shown = within(screen.getByRole('dialog', { name: 'Open this on the tablet' }));
    expect(shown.getByText(/\/kiosk\/k-2#token=kk_shown-once$/u)).toBeTruthy();
  });

  it('lets HR name people on private leave in chat answers, behind the warning (AST-029a)', async () => {
    const onChatAnswers = vi.fn(() => Promise.resolve({ ok: true as const }));
    const { container } = render(<Integrations load={ready()} onChatAnswers={onChatAnswers} />);
    const toggle = screen.getByRole('switch', {
      name: 'Name people on private leave in chat answers',
    });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(/health data is stored by your chat provider/u)).toBeTruthy();
    await act(async () => {
      fireEvent.click(toggle);
      await Promise.resolve();
    });
    expect(onChatAnswers).toHaveBeenCalledWith({ namesPrivateLeave: true });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('puts the switch back when Time Off refuses it', async () => {
    const onChatAnswers = vi.fn(() =>
      Promise.resolve({ ok: false as const, message: 'Only HR can change this.' }),
    );
    render(<Integrations load={ready()} onChatAnswers={onChatAnswers} />);
    const toggle = screen.getByRole('switch', {
      name: 'Name people on private leave in chat answers',
    });
    await act(async () => {
      fireEvent.click(toggle);
      await Promise.resolve();
    });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Only HR can change this.')).toBeTruthy();
  });

  it('draws its loading state in the page’s shape', async () => {
    const { container } = render(<Integrations load={{ status: 'loading' }} />);
    expect(screen.getByText('Loading integrations')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });
});
