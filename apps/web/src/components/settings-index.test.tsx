// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingsIndex, type SettingsModule } from './settings-index';

/*
 * Settings: the area on show is in the address, so a setting's crumb and the
 * browser's Back open the area it was opened from, not always the first.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const area = (key: string, title: string, setting: string): SettingsModule => ({
  key,
  title,
  description: `${title}’s settings`,
  settings: [{ path: `/settings/${key}/${setting}`, label: setting, now: null, attention: null }],
});

const modules = [
  area('people', 'People', 'Roles'),
  area('time-off', 'Time off', 'Leave types'),
  area('documents', 'Documents', 'Document types'),
];

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/settings');
});

describe('Settings, by area', () => {
  it('opens the area the address names', () => {
    window.history.replaceState(null, '', '/settings?area=documents');
    render(<SettingsIndex modules={modules} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Documents' })).toBeTruthy();
    expect(screen.getByText('Document types')).toBeTruthy();
  });

  it('opens the first area when the address names none', () => {
    window.history.replaceState(null, '', '/settings');
    render(<SettingsIndex modules={modules} />);
    expect(screen.getByRole('heading', { level: 2, name: 'People' })).toBeTruthy();
  });

  it('puts the area chosen in the address, without loading the page', () => {
    window.history.replaceState(null, '', '/settings');
    render(<SettingsIndex modules={modules} />);
    const link = screen.getByRole('link', { name: 'Time off' });
    expect(link.getAttribute('href')).toBe('?area=time-off');
    fireEvent.click(link);
    expect(window.location.search).toBe('?area=time-off');
  });
});
