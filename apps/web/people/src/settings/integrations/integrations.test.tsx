import { TooltipProvider } from '@reach/ui';
import { render as mount, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { fast } from '../../test/user';
import { axeViolations } from '../../test/axe';
import { Integrations, type IntegrationsProps, type IntegrationsState } from './integrations';

/** The shell wraps every screen in a TooltipProvider; `CopyField` needs one. */
const render = (ui: ReactElement) => mount(ui, { wrapper: TooltipProvider });

const state: IntegrationsState = {
  schemaVersion: 4,
  deliveries24h: 1284,
  events: ['people.person.hired', 'people.person.profile_updated'],
  fields: [
    { key: 'hire_date', label: 'Hire date', refused: null },
    { key: 'cost_centre', label: 'Cost centre', refused: null },
    { key: 'bank_account', label: 'Bank account', refused: 'encrypted' },
    { key: 'accommodation_notes', label: 'Accommodation notes', refused: 'special-category' },
  ],
  endpoints: [
    {
      id: 'e1',
      url: 'https://api.nominacloud.es/hooks/kithena',
      enabled: true,
      events: ['people.person.hired'],
      allowlist: ['hire_date'],
      retrying: 0,
      problem: null,
      lastDelivery: '40s ago',
      secretRotated: '4 days ago',
    },
    {
      id: 'e2',
      url: 'https://acme.okta.com/scim/v2',
      enabled: true,
      events: ['people.person.profile_updated'],
      allowlist: [],
      retrying: 3,
      problem: 'Okta answered 503 at 14:02. Next attempt in 8 minutes.',
      lastDelivery: null,
      secretRotated: null,
    },
  ],
};

function props(over: Partial<IntegrationsProps> = {}): IntegrationsProps {
  return {
    load: { status: 'ready', data: state },
    onCreate: vi.fn(() => Promise.resolve({ ok: true as const, secret: 'whsec_once' })),
    onUpdate: vi.fn(() => Promise.resolve({ ok: true as const })),
    onRotate: vi.fn(() => Promise.resolve({ ok: true as const, secret: 'whsec_rotated' })),
    ...over,
  };
}

const allowlistOf = (url: string) => {
  const section = screen.getByRole('region', { name: url });
  return within(section).getByRole('button', { name: 'Fields this endpoint receives' });
};

describe('Integrations', () => {
  it('shows each endpoint, its health and what it receives', async () => {
    const { container } = render(<Integrations {...props()} />);
    expect(
      screen.getByText(/2 endpoints · 1,284 deliveries in the last day · schema version 4/),
    ).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.getByText('3 retrying')).toBeInTheDocument();
    expect(screen.getByText(/Okta answered 503/)).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('offers every field of the schema, and none that may never be sent', async () => {
    const user = fast();
    const onUpdate = vi.fn(() => Promise.resolve({ ok: true as const }));
    render(<Integrations {...props({ onUpdate })} />);
    await user.click(allowlistOf('https://api.nominacloud.es/hooks/kithena'));
    expect(await screen.findByRole('option', { name: /Accommodation notes/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('option', { name: /Bank account/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('saves an allowed field', async () => {
    const user = fast();
    const onUpdate = vi.fn(() => Promise.resolve({ ok: true as const }));
    render(<Integrations {...props({ onUpdate })} />);
    await user.click(allowlistOf('https://api.nominacloud.es/hooks/kithena'));
    await user.click(await screen.findByRole('option', { name: /Cost centre/ }));
    await user.keyboard('{Escape}');
    const section = screen.getByRole('region', {
      name: 'https://api.nominacloud.es/hooks/kithena',
    });
    await user.click(within(section).getByRole('button', { name: 'Save changes' }));
    expect(onUpdate).toHaveBeenCalledWith('e1', {
      events: ['people.person.hired'],
      allowlist: ['hire_date', 'cost_centre'],
    });
  });

  it('shows a new signing secret once, to copy', async () => {
    const user = fast();
    render(<Integrations {...props()} />);
    const section = screen.getByRole('region', {
      name: 'https://api.nominacloud.es/hooks/kithena',
    });
    await user.click(within(section).getByRole('button', { name: 'Rotate signing secret' }));
    expect(await screen.findByText('whsec_rotated')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy the signing secret' })).toBeInTheDocument();
  });

  it('says why when People refuses a change', async () => {
    const user = fast();
    render(
      <Integrations
        {...props({
          onUpdate: () => Promise.resolve({ ok: false, message: 'hooks.example is not public' }),
        })}
      />,
    );
    const section = screen.getByRole('region', { name: 'https://acme.okta.com/scim/v2' });
    await user.click(within(section).getByRole('switch', { name: 'Enabled' }));
    expect(await within(section).findByText('hooks.example is not public')).toBeInTheDocument();
  });

  it('will not add an endpoint without an address to alert, and sends the one given (PEO-093)', async () => {
    const user = fast();
    const onCreate = vi.fn(() => Promise.resolve({ ok: true as const, secret: 'whsec_once' }));
    render(<Integrations {...props({ onCreate })} />);
    await user.click(screen.getByRole('button', { name: 'Add endpoint' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(
      within(dialog).getByRole('textbox', { name: /URL/ }),
      'https://hooks.example.com/in',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Events' }));
    await user.click(await screen.findByRole('option', { name: /Person hired/ }));
    await user.keyboard('{Escape}');
    await user.click(within(dialog).getByRole('button', { name: 'Add endpoint' }));
    expect(onCreate).not.toHaveBeenCalled();
    expect(within(dialog).getByText('An email address to tell.')).toBeVisible();

    await user.type(
      within(dialog).getByRole('textbox', { name: /Alert email/ }),
      'ops@acme.example',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Add endpoint' }));
    expect(onCreate).toHaveBeenCalledWith({
      url: 'https://hooks.example.com/in',
      events: ['people.person.hired'],
      allowlist: [],
      alertEmail: 'ops@acme.example',
    });
  });

  it('has loading, error and empty states', async () => {
    const { container, rerender } = render(
      <Integrations {...props({ load: { status: 'loading' } })} />,
    );
    expect(screen.getByText('Loading the integrations')).toBeInTheDocument();
    rerender(<Integrations {...props({ load: { status: 'error', message: 'Down' } })} />);
    expect(screen.getByText('Down')).toBeInTheDocument();
    rerender(
      <Integrations {...props({ load: { status: 'ready', data: { ...state, endpoints: [] } } })} />,
    );
    expect(screen.getByText('No third-party tools connected')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('shows Kithena’s own modules as connected, apart from third-party tools', () => {
    const { rerender } = render(
      <Integrations {...props({ builtIn: ['Time off', 'Documents'] })} />,
    );
    const built = screen
      .getByRole('heading', { name: 'Built into Kithena' })
      .closest('section') as HTMLElement;
    expect(within(built).getByText('Time off')).toBeInTheDocument();
    expect(within(built).getAllByText('Connected')).toHaveLength(2);
    expect(
      screen.getByRole('heading', { name: 'Webhooks to third-party tools' }),
    ).toBeInTheDocument();
    rerender(<Integrations {...props()} />);
    expect(screen.getByText(/connected here automatically/)).toBeInTheDocument();
  });
});
