import { TooltipProvider } from '@reach/ui';
import { render as mount, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { fast } from '../../test/user';
import { axeViolations } from '../../test/axe';
import { Provisioning, type ProvisioningProps, type ScimState } from './provisioning';

/** The shell wraps every screen in a TooltipProvider; `CopyField` needs one. */
const render = (ui: ReactElement) => mount(ui, { wrapper: TooltipProvider });

const EXT = 'urn:kithena:scim:schemas:extension:people:2.0:User';

const scim: ScimState = {
  url: 'https://api.acme.test/scim/v2',
  paths: ['userName', 'name.givenName', 'name.familyName'],
  extension: EXT,
  mappable: [
    { key: 'given_name', label: 'Given name' },
    { key: 'family_name', label: 'Family name' },
    { key: 't_shirt_size', label: 'T-shirt size' },
  ],
  connections: [
    {
      id: 'c1',
      system: 'Okta',
      createdAt: '2026-09-20T10:00:00.000Z',
      tokenRotatedAt: null,
      revokedAt: null,
      linked: 412,
      mapping: [
        { path: 'name.givenName', key: 'given_name' },
        { path: `${EXT}:t_shirt_size`, key: 't_shirt_size' },
      ],
    },
    {
      id: 'c2',
      system: 'Workday',
      createdAt: '2026-01-01T00:00:00.000Z',
      tokenRotatedAt: null,
      revokedAt: '2026-06-01T00:00:00.000Z',
      linked: 0,
      mapping: [],
    },
  ],
};

function props(over: Partial<ProvisioningProps> = {}): ProvisioningProps {
  return {
    scim,
    onConnect: vi.fn(() => Promise.resolve({ ok: true as const, token: 'kps_once' })),
    onRotateToken: vi.fn(() => Promise.resolve({ ok: true as const, token: 'kps_rotated' })),
    onDisconnect: vi.fn(() => Promise.resolve({ ok: true as const })),
    onSetMapping: vi.fn(() => Promise.resolve({ ok: true as const })),
    ...over,
  };
}

describe('Provisioning (PEO-072, PEO-073)', () => {
  it('says which fields each system keeps, and who it provisions', async () => {
    const { container } = render(<Provisioning {...props()} />);
    const okta = screen.getByRole('region', { name: 'Okta' });
    expect(within(okta).getByText('Connected')).toBeInTheDocument();
    expect(within(okta).getByText(/412 people provisioned/)).toBeInTheDocument();
    const table = within(okta).getByRole('table', { name: 'Fields kept in Okta' });
    expect(within(table).getByText('Given name')).toBeInTheDocument();
    expect(within(table).getByText('People: t_shirt_size')).toBeInTheDocument();
    const workday = screen.getByRole('region', { name: 'Workday' });
    expect(within(workday).getByText('Disconnected')).toBeInTheDocument();
    expect(within(workday).queryByRole('button')).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('warns that saving makes the mapped fields read-only here, then saves', async () => {
    const user = fast();
    const onSetMapping = vi.fn(() => Promise.resolve({ ok: true as const }));
    render(<Provisioning {...props({ onSetMapping })} />);
    const okta = screen.getByRole('region', { name: 'Okta' });
    expect(within(okta).getByRole('button', { name: 'Save mapping' })).toBeDisabled();
    await user.click(
      within(okta).getByRole('button', { name: 'Stop keeping T-shirt size in Okta' }),
    );
    expect(within(okta).getByText(/every mapped field read-only in People/)).toBeInTheDocument();
    await user.click(within(okta).getByRole('button', { name: 'Save mapping' }));
    expect(onSetMapping).toHaveBeenCalledWith('c1', [{ path: 'name.givenName', key: 'given_name' }]);
  });

  it('shows a new token once, to copy', async () => {
    const user = fast();
    render(<Provisioning {...props()} />);
    await user.click(screen.getByRole('button', { name: 'Connect a system' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: /System/ }), 'Entra');
    await user.click(within(dialog).getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('kps_once')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy the SCIM token' })).toBeInTheDocument();
  });

  it('says why when People refuses a mapping', async () => {
    const user = fast();
    render(
      <Provisioning
        {...props({
          onSetMapping: () =>
            Promise.resolve({ ok: false, message: 'given_name is already kept in Workday' }),
        })}
      />,
    );
    const okta = screen.getByRole('region', { name: 'Okta' });
    await user.click(within(okta).getByRole('button', { name: 'Stop keeping Given name in Okta' }));
    await user.click(within(okta).getByRole('button', { name: 'Save mapping' }));
    expect(await within(okta).findByText('given_name is already kept in Workday')).toBeInTheDocument();
  });
});
