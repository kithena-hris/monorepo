import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { fast } from '../test/user';
import { AttributeInput } from './attribute-input';
import { DisplayValue } from './display';
import { INDEFINITE, type AttributeValue, type RecordField } from './model';

/* A contract end date is a date, or no end at all: two answers, never a blank. */

const contractEnd: RecordField = {
  key: 'contract_end',
  label: 'Contract end date',
  description: null,
  dataType: 'date',
  options: [],
  required: true,
  readOnly: false,
  openEnded: true,
};

function Editor({ onChange }: { readonly onChange: (v: AttributeValue) => void }) {
  const [value, setValue] = useState<AttributeValue>('2027-03-22');
  return (
    <AttributeInput
      field={contractEnd}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe('an open-ended date', () => {
  it('can be set to no end date, and back to a date', async () => {
    const user = fast();
    const onChange = vi.fn();
    render(<Editor onChange={onChange} />);
    const none = screen.getByRole('checkbox', { name: 'No end date (indefinite)' });
    await user.click(none);
    expect(onChange).toHaveBeenLastCalledWith(INDEFINITE);
    expect(none).toBeChecked();
    await user.click(none);
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('reads Indefinite on the record', () => {
    render(<DisplayValue field={contractEnd} value={INDEFINITE} />);
    expect(screen.getByText('Indefinite')).toBeInTheDocument();
  });

  it('offers no such choice on an ordinary date', () => {
    render(
      <AttributeInput
        field={{ ...contractEnd, openEnded: false }}
        value={null}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
