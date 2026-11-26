import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { SignaturePad } from './signature-pad';

it('takes back the last stroke, and clears them all', () => {
  const onValueChange = vi.fn();
  render(
    <SignaturePad
      label="Draw your signature"
      value="M 1 1 L 2 2 M 3 3 L 4 4"
      onValueChange={onValueChange}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(onValueChange).toHaveBeenLastCalledWith('M 1 1 L 2 2');
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(onValueChange).toHaveBeenLastCalledWith('');
});
