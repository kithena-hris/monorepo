import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AppMark } from './app-mark';

describe('AppMark', () => {
  it('is decoration beside the app’s name, and named when it stands alone', () => {
    const { container } = render(<AppMark app="slack" />);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    render(<AppMark app="slack" title="Slack" />);
    expect(screen.getByRole('img', { name: 'Slack' })).toBeTruthy();
  });

  it('keeps the app’s own colours unless asked for one', () => {
    const { container, rerender } = render(<AppMark app="slack" />);
    const fills = () => [...container.querySelectorAll('path')].map((p) => p.getAttribute('fill'));
    expect(new Set(fills()).size).toBe(4);
    rerender(<AppMark app="slack" tone="mono" />);
    expect(new Set(fills())).toEqual(new Set(['currentColor']));
    expect(container.querySelector('svg')?.getAttribute('fill')).toBe('currentColor');
  });
});
