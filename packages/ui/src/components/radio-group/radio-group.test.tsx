import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { RadioCard, RadioGroup, RadioGroupItem } from './radio-group';

function Group({ deselectable, cards }: { deselectable: boolean; cards?: boolean }) {
  const [value, setValue] = useState('meets');
  const Option = cards === true ? RadioCard : RadioGroupItem;
  return (
    <RadioGroup
      aria-label="Rating"
      deselectable={deselectable}
      value={value}
      onValueChange={setValue}
    >
      <Option value="meets">Meets</Option>
      <Option value="exceeds">Exceeds</Option>
    </RadioGroup>
  );
}

describe('<RadioGroup deselectable>', () => {
  it('clears the choice when the chosen option is pressed again', async () => {
    render(<Group deselectable />);
    await userEvent.click(screen.getByRole('radio', { name: 'Meets' }));
    expect(screen.getByRole('radio', { name: 'Meets' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Exceeds' })).not.toBeChecked();
  });

  it('clears a card the same way, and by Space', async () => {
    render(<Group deselectable cards />);
    screen.getByRole('radio', { name: 'Meets' }).focus();
    await userEvent.keyboard(' ');
    expect(screen.getByRole('radio', { name: 'Meets' })).not.toBeChecked();
  });

  it('keeps the choice without it, as a radio group always has', async () => {
    render(<Group deselectable={false} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Meets' }));
    expect(screen.getByRole('radio', { name: 'Meets' })).toBeChecked();
  });

  it('still moves the choice to another option', async () => {
    const onValueChange = vi.fn();
    render(
      <RadioGroup aria-label="Rating" deselectable value="meets" onValueChange={onValueChange}>
        <RadioGroupItem value="meets">Meets</RadioGroupItem>
        <RadioGroupItem value="exceeds">Exceeds</RadioGroupItem>
      </RadioGroup>,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Exceeds' }));
    expect(onValueChange).toHaveBeenCalledWith('exceeds');
  });
});
