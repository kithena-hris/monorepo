import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Combobox } from './combobox';

const options = Array.from({ length: 400 }, (_, i) => ({
  value: `z${String(i)}`,
  label: `Zone ${String(i)}`,
}));

describe('<Combobox> with a long list', () => {
  it('opens as it mounts with what fits, and draws the rest on the next frame', async () => {
    render(
      <Combobox label="Time zone" options={options} value={null} onChange={vi.fn()} defaultOpen />,
    );
    expect(screen.getAllByRole('option')).toHaveLength(50);
    await act(
      () =>
        new Promise<void>((done) => {
          requestAnimationFrame(() => {
            done();
          });
        }),
    );
    expect(screen.getAllByRole('option')).toHaveLength(400);
  });
});
