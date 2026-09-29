import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it } from 'vitest';

import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from './popover';

let coarse = false;
beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({
      matches: query === '(pointer: coarse)' ? coarse : false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList;
});

function Columns({ sheetOnTouch }: { sheetOnTouch?: boolean }) {
  return (
    <Popover {...(sheetOnTouch === undefined ? {} : { sheetOnTouch })}>
      <PopoverTrigger>Columns</PopoverTrigger>
      <PopoverContent>
        <p>Pick the columns</p>
        <PopoverClose>Done</PopoverClose>
      </PopoverContent>
    </Popover>
  );
}

describe('<Popover>', () => {
  it('is an anchored, non-modal panel at a desk', async () => {
    coarse = false;
    render(<Columns />);
    await userEvent.click(screen.getByRole('button', { name: 'Columns' }));
    expect(screen.getByText('Pick the columns')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Columns' })).toBeNull();
  });

  it('is a sheet named by its trigger under a finger, and its close still closes', async () => {
    coarse = true;
    render(<Columns />);
    await userEvent.click(screen.getByRole('button', { name: 'Columns' }));
    expect(screen.getByRole('dialog', { name: 'Columns' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('Pick the columns')).toBeNull();
  });

  it('stays anchored under a finger when asked to', async () => {
    coarse = true;
    render(<Columns sheetOnTouch={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Columns' }));
    expect(screen.queryByRole('dialog', { name: 'Columns' })).toBeNull();
  });
});
