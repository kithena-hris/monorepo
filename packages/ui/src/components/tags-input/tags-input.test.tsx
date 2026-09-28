import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type JSX } from 'react';
import { describe, expect, it } from 'vitest';

import { TagsInput, isEmailish } from './tags-input';

function Harness({ initial }: { initial: readonly string[] }): JSX.Element {
  const [value, setValue] = useState(initial);
  return (
    <TagsInput
      label="Invite"
      value={value}
      onChange={setValue}
      validate={(input) => (isEmailish(input) ? null : `${input} is not an address.`)}
    />
  );
}

describe('<TagsInput>', () => {
  it('keeps remove buttons out of the tab order, so Tab leaves the field', () => {
    render(<Harness initial={['ada@acme.example']} />);
    expect(screen.getByRole('button', { name: 'Remove ada@acme.example' })).toHaveAttribute(
      'tabindex',
      '-1',
    );
  });

  it('marks a value handed in that validate would refuse, in words', () => {
    render(<Harness initial={['ada@acme.example', 'jonas@']} />);
    expect(screen.getByText(', jonas@ is not an address.')).toBeInTheDocument();
  });

  it('points at the existing tag a duplicate ran into', async () => {
    render(<Harness initial={['ada@acme.example', 'grace@acme.example']} />);
    await userEvent.type(screen.getByRole('textbox'), 'ada@acme.example{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('already in the list');
    const chip = screen.getByText('ada@acme.example').parentElement;
    expect(chip).toHaveAttribute('data-selected');
  });

  it('selects the last tag on the first Backspace and removes it on the second', async () => {
    render(<Harness initial={['ada@acme.example', 'grace@acme.example']} />);
    await userEvent.type(screen.getByRole('textbox'), '{Backspace}');
    expect(screen.getByText('grace@acme.example').parentElement).toHaveAttribute('data-selected');
    await userEvent.type(screen.getByRole('textbox'), '{Backspace}');
    expect(screen.queryByText('grace@acme.example')).not.toBeInTheDocument();
  });
});
