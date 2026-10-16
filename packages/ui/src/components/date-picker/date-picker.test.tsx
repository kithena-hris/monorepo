import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Calendar, type IsoDate } from '../calendar/calendar';
import { DatePicker } from './date-picker';

/*
 * Going far: a date decades away is a few presses on the calendar's heading,
 * or one typed line in the picker, never hundreds of "previous month".
 */

describe('Calendar, zoomed out', () => {
  it('reaches March 1996 from 2026 in a few presses', () => {
    const onSelect = vi.fn();
    render(<Calendar today="2026-10-12" onSelect={onSelect} label="Birthday" />);
    fireEvent.click(screen.getByRole('button', { name: /October 2026, choose a month/u }));
    fireEvent.click(screen.getByRole('button', { name: /2026, choose a year/u }));
    // Twelve years a page: 2016–2027, then two pages back to 1992–2003.
    fireEvent.click(screen.getByRole('button', { name: 'Previous twelve years' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous twelve years' }));
    fireEvent.click(screen.getByRole('button', { name: '1996' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mar' }));
    expect(screen.getByRole('button', { name: /March 1996, choose a month/u })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /14 March 1996/u }));
    expect(onSelect).toHaveBeenCalledWith('1996-03-14');
  });

  it('opens on what is chosen, not on today', () => {
    render(<Calendar today="2026-10-12" selected="1996-03-14" label="Birthday" />);
    expect(screen.getByRole('button', { name: /March 1996, choose a month/u })).toBeTruthy();
  });

  it('keeps years and months outside the bounds out of reach', () => {
    render(<Calendar today="2026-10-12" min="2026-01-01" label="Leave" />);
    fireEvent.click(screen.getByRole('button', { name: /choose a month/u }));
    fireEvent.click(screen.getByRole('button', { name: /choose a year/u }));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '2025' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '2026' }).disabled).toBe(false);
  });
});

function Picker({ onChange }: { readonly onChange: (v: IsoDate | null) => void }) {
  const [value, setValue] = useState<IsoDate | null>(null);
  return (
    <DatePicker
      label="Birthday"
      today="2026-10-12"
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
    />
  );
}

describe('DatePicker, typed', () => {
  it('chooses a typed date and closes', async () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    const trigger = screen.getByRole('button', { name: /^Birthday: / });
    // Label in Name (WCAG 2.5.3): what the trigger shows is part of its name.
    expect(trigger.getAttribute('aria-label')).toContain(trigger.textContent);
    fireEvent.click(trigger);
    const field = await screen.findByLabelText('Type birthday');
    fireEvent.change(field, { target: { value: '14/03/1996' } });
    act(() => {
      fireEvent.keyDown(field, { key: 'Enter' });
    });
    expect(onChange).toHaveBeenCalledWith('1996-03-14');
  });

  it('says what it could not read', async () => {
    render(<Picker onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Birthday: / }));
    const field = await screen.findByLabelText('Type birthday');
    fireEvent.change(field, { target: { value: '31/02/1996' } });
    act(() => {
      fireEvent.keyDown(field, { key: 'Enter' });
    });
    expect(screen.getByRole('alert').textContent).toContain('Type a date like 14/03/1996');
  });
});
