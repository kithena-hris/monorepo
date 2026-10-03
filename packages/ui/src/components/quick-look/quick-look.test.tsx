import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { QuickLook } from './quick-look';

describe('<QuickLook>', () => {
  it('moves to the next and previous record from inside, never with the arrows a field owns', () => {
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    render(
      <QuickLook title="Lena Moreau" onNext={onNext} onPrevious={onPrevious} onClose={vi.fn()}>
        <input aria-label="Note" />
        <div role="listbox" aria-label="Choice" tabIndex={0} />
      </QuickLook>,
    );
    const close = screen.getByRole('button', { name: 'Close' });
    fireEvent.keyDown(close, { key: 'ArrowDown' });
    fireEvent.keyDown(close, { key: 'ArrowUp' });
    expect(onNext).toHaveBeenCalledOnce();
    expect(onPrevious).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Note' }), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('listbox', { name: 'Choice' }), { key: 'ArrowUp' });
    expect(onNext).toHaveBeenCalledOnce();
    expect(onPrevious).toHaveBeenCalledOnce();
  });
});
