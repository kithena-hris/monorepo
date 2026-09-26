import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { fast } from '../test/user';
import { axeViolations } from '../test/axe';
import { Directory, type DirectoryProps, type DirectoryState } from './directory';

const state: DirectoryState = {
  active: 412,
  incomplete: 88,
  columns: [
    { key: 'job_title', label: 'Job title' },
    { key: 'cost_centre', label: 'Cost centre' },
  ],
  filterable: [
    {
      key: 'cost_centre',
      label: 'Cost centre',
      options: [
        { value: 'ENG-204', label: 'ENG-204' },
        { value: 'ENG-201', label: 'ENG-201' },
      ],
    },
  ],
  people: [
    {
      id: 'a',
      name: 'Adam Reyes',
      email: 'adam@acme.example',
      avatarUrl: null,
      values: { job_title: 'Support Engineer', cost_centre: 'ENG-204' },
      missing: 0,
    },
    {
      id: 'l',
      name: 'Lena Moreau',
      email: 'lena@acme.example',
      avatarUrl: null,
      values: { job_title: 'Staff Engineer', cost_centre: 'ENG-204' },
      missing: 2,
    },
  ],
};

function props(over: Partial<DirectoryProps> = {}): DirectoryProps {
  return {
    load: { status: 'ready', data: state },
    search: '',
    onSearchChange: vi.fn(),
    filters: {},
    onFiltersChange: vi.fn(),
    onOpen: vi.fn(),
    ...over,
  };
}

describe('Directory', () => {
  it('draws columns from the schema and completeness as a count', async () => {
    const { container } = render(<Directory {...props()} />);
    expect(screen.getByText('412 active · 88 incomplete')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Cost centre/ })).toBeInTheDocument();
    expect(screen.getByText('2 missing')).toBeInTheDocument();
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.queryByText(/%/)).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('asks the shell to filter, rather than filtering what it was given', async () => {
    const user = fast();
    const onFiltersChange = vi.fn();
    render(<Directory {...props({ onFiltersChange })} />);
    await user.click(screen.getByRole('combobox', { name: 'Cost centre' }));
    await user.click(await screen.findByRole('option', { name: 'Cost centre: ENG-201' }));
    expect(onFiltersChange).toHaveBeenCalledWith({ cost_centre: 'ENG-201' });
  });

  it('opens a person', async () => {
    const user = fast();
    const onOpen = vi.fn();
    render(<Directory {...props({ onOpen })} />);
    await user.click(screen.getByText('Lena Moreau'));
    expect(onOpen).toHaveBeenCalledWith('l');
  });

  it('lets HR choose people and edit them together, and nobody else choose at all (PEO-071)', async () => {
    const user = fast();
    const onBulkEdit = vi.fn();
    const { rerender } = render(<Directory {...props()} />);
    expect(screen.queryByRole('checkbox', { name: 'Select Adam Reyes' })).toBeNull();
    rerender(<Directory {...props({ onBulkEdit })} />);
    await user.click(screen.getByRole('checkbox', { name: 'Select Adam Reyes' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Lena Moreau' }));
    await user.click(screen.getByRole('button', { name: 'Edit together' }));
    expect(onBulkEdit).toHaveBeenCalledWith(['a', 'l']);
  });

  it('has loading, error and empty states', async () => {
    const { container, rerender } = render(
      <Directory {...props({ load: { status: 'loading' } })} />,
    );
    expect(screen.getByText('Loading the directory')).toBeInTheDocument();
    rerender(<Directory {...props({ load: { status: 'error', message: 'Timed out' } })} />);
    expect(screen.getByText('Timed out')).toBeInTheDocument();
    rerender(
      <Directory
        {...props({ search: 'zz', load: { status: 'ready', data: { ...state, people: [] } } })}
      />,
    );
    expect(screen.getByText('Nobody matches')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('says there is nobody yet, and offers HR adding and importing people', async () => {
    const user = fast();
    const onAdd = vi.fn();
    const onImport = vi.fn();
    const empty = { status: 'ready', data: { ...state, people: [] } } as const;
    const { container, rerender } = render(
      <Directory {...props({ load: empty, onAdd, onImport })} />,
    );
    expect(screen.getByText('No employees yet')).toBeInTheDocument();
    // In the header and in the empty state: always a way to add somebody.
    const adds = screen.getAllByRole('button', { name: 'Add employee' });
    expect(adds).toHaveLength(2);
    await user.click(adds[1] as HTMLElement);
    expect(onAdd).toHaveBeenCalledOnce();
    await user.click(screen.getAllByRole('button', { name: 'Import' })[1] as HTMLElement);
    expect(onImport).toHaveBeenCalledOnce();
    expect(await axeViolations(container)).toEqual([]);

    // Anybody else: the same news, and nothing to press.
    rerender(<Directory {...props({ load: empty })} />);
    expect(screen.getByText('No employees yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add employee' })).toBeNull();
  });

  it('asks the shell for the next page and back to the first, never paging itself', async () => {
    const user = fast();
    const onNextPage = vi.fn();
    const onFirstPage = vi.fn();
    const { container, rerender } = render(<Directory {...props()} />);
    // One page and nothing after it: no pager at all.
    expect(screen.queryByRole('navigation', { name: 'Pages of people' })).toBeNull();

    rerender(<Directory {...props({ onNextPage, onFirstPage })} />);
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await user.click(screen.getByRole('button', { name: 'First page' }));
    expect(onNextPage).toHaveBeenCalledTimes(1);
    expect(onFirstPage).toHaveBeenCalledTimes(1);
    expect(await axeViolations(container)).toEqual([]);

    rerender(<Directory {...props({ onFirstPage })} />);
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
  });

  it('applies a saved segment through the shell, and saves the filters as one (PEO-068)', async () => {
    const user = fast();
    const onSegmentChange = vi.fn();
    const onSaveSegment = vi.fn(() => Promise.resolve({ ok: true as const }));
    const withSegments = { ...state, segments: [{ id: 'seg-1', name: 'Madrid engineering' }] };
    const { container, rerender } = render(
      <Directory
        {...props({
          load: { status: 'ready', data: withSegments },
          onSegmentChange,
          onSaveSegment,
        })}
      />,
    );
    // Nothing to save until a filter is set.
    expect(screen.queryByRole('button', { name: 'Save as segment' })).toBeNull();
    await user.click(screen.getByRole('combobox', { name: 'Segment' }));
    await user.click(await screen.findByRole('option', { name: 'Segment: Madrid engineering' }));
    expect(onSegmentChange).toHaveBeenCalledWith('seg-1');

    rerender(
      <Directory
        {...props({
          load: { status: 'ready', data: withSegments },
          filters: { cost_centre: 'ENG-204' },
          onSegmentChange,
          onSaveSegment,
        })}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Save as segment' }));
    await user.type(screen.getByRole('textbox', { name: /^Name/ }), 'ENG-204');
    await user.click(screen.getByRole('switch', { name: 'Share with everybody in the company' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSaveSegment).toHaveBeenCalledWith({ name: 'ENG-204', shared: true });
    expect(await axeViolations(container)).toEqual([]);
  });
});
