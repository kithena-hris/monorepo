import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../test/axe';
import { adaCases } from './acme.fixture';
import { ParentalCases } from './cases';

/** HR's parental cases (TOF-099c): the plans sent, waiting first, each opening its case. */

describe('HR’s parental cases', () => {
  it('lists each sent plan with who, when and where it stands, linking to its case', async () => {
    const { container } = render(<ParentalCases load={{ status: 'ready', data: adaCases() }} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Parental leave' })).toBeTruthy();
    expect(screen.getByText('1 waiting for you · 1 approved')).toBeTruthy();
    const rows = within(screen.getByRole('list', { name: 'Parental leave plans' }));
    expect(rows.getAllByRole('listitem').map((r) => r.textContent)).toEqual([
      expect.stringMatching(/Adam Novak.*Waiting for you/),
      expect.stringMatching(/Hana Kim.*Approved/),
    ]);
    expect(rows.getByText(/Platform · 14 Jan – 9 May, back Mon 10 May/)).toBeTruthy();
    expect(rows.getByRole('link', { name: /Adam Novak/ }).getAttribute('href')).toBe(
      '/time-off/parental/cases/0199a000-0000-7000-8000-0000000000f1',
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it('says when nobody has sent one, and loads in the list’s shape', async () => {
    const { unmount } = render(<ParentalCases load={{ status: 'ready', data: { cases: [] } }} />);
    expect(screen.getByText('Nobody has sent a parental leave plan yet.')).toBeTruthy();
    unmount();
    const { container } = render(<ParentalCases load={{ status: 'loading' }} />);
    expect(screen.getByRole('status').textContent).toBe('Loading the parental cases');
    expect(await axeViolations(container)).toEqual([]);
  });
});
