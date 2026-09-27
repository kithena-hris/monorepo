import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AvatarUploader } from './image-uploader';

describe('<AvatarUploader controls="menu">', () => {
  it('is the photo alone, and pressing it offers Replace and Remove', async () => {
    const onChange = vi.fn();
    render(
      <AvatarUploader
        label="Photo"
        hint="PNG or JPEG"
        controls="menu"
        src="/photo.png"
        value={[]}
        onChange={onChange}
      />,
    );
    // No hint and no buttons beside it.
    expect(screen.queryByText('PNG or JPEG')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Photo: replace or remove' }));
    expect(screen.getByRole('menuitem', { name: 'Replace' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('opens the file picker when there is no photo yet', () => {
    render(<AvatarUploader label="Photo" controls="menu" value={[]} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Photo')).toHaveAttribute('type', 'file');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
