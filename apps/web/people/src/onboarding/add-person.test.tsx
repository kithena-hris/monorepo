import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { fast } from '../test/user';
import { AddPerson } from './add-person';

describe('AddPerson', () => {
  it('asks for a name and a work email before adding anybody', async () => {
    const user = fast();
    const onAdd = vi.fn(() => Promise.resolve({ ok: true as const }));
    const { container } = render(<AddPerson onAdd={onAdd} />);
    await user.click(screen.getByRole('button', { name: 'Add employee' }));
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByText('Enter their first name.')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);

    await user.type(screen.getByRole('textbox', { name: /Legal first name/ }), ' Lena ');
    await user.type(screen.getByRole('textbox', { name: /Legal family name/ }), 'Moreau');
    await user.type(screen.getByRole('textbox', { name: /Work email/ }), 'lena@acme.example');
    await user.click(screen.getByRole('button', { name: 'Add employee' }));
    expect(onAdd).toHaveBeenCalledWith({
      given_name: 'Lena',
      family_name: 'Moreau',
      work_email: 'lena@acme.example',
    });
  });

  it('says why People refused, and keeps what was typed', async () => {
    const user = fast();
    const onAdd = vi.fn(() =>
      Promise.resolve({ ok: false as const, message: 'Work email is already in use' }),
    );
    render(<AddPerson onAdd={onAdd} />);
    await user.type(screen.getByRole('textbox', { name: /Legal first name/ }), 'Lena');
    await user.type(screen.getByRole('textbox', { name: /Legal family name/ }), 'Moreau');
    await user.type(screen.getByRole('textbox', { name: /Work email/ }), 'lena@acme.example');
    await user.click(screen.getByRole('button', { name: 'Add employee' }));
    expect(await screen.findByText('Work email is already in use')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Work email/ })).toHaveValue('lena@acme.example');
  });
});
