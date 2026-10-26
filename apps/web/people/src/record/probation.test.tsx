import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { fast } from '../test/user';
import { AttributeInput, periodEnd, StartDate } from './attribute-input';
import type { RecordField } from './model';

/* A hire made outside Kithena: probation typed, or set as a length after the start. */

const probation: RecordField = {
  key: 'probation_end',
  label: 'Probation end',
  description: null,
  dataType: 'date',
  options: [],
  required: false,
  readOnly: false,
};

describe('a probation end', () => {
  it('ends the day before the same date a length on, as Recruiting counts it', () => {
    expect(periodEnd('2026-11-02', 6, 'months')).toBe('2027-05-01');
    expect(periodEnd('2027-01-31', 1, 'months')).toBe('2027-02-27');
    expect(periodEnd('2026-11-02', 2, 'weeks')).toBe('2026-11-15');
    expect(periodEnd('2026-11-02', 90, 'days')).toBe('2027-01-30');
  });

  it('is set by typing a length after the start date', async () => {
    const onChange = vi.fn();
    render(
      <StartDate value="2026-11-02">
        <AttributeInput field={probation} value={null} onChange={onChange} />
      </StartDate>,
    );
    await fast().type(screen.getByRole('spinbutton', { name: 'Length of probation' }), '6');
    expect(onChange).toHaveBeenLastCalledWith('2027-05-01');
  });

  it('is only typed where the start is not known', () => {
    render(<AttributeInput field={probation} value={null} onChange={vi.fn()} />);
    expect(screen.queryByRole('spinbutton')).toBeNull();
  });
});
