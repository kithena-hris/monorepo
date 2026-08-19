import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../select/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../table/table';
import { Pagination } from './pagination';

const meta = {
  title: 'Components/Pagination',
  component: Pagination,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Offset pagination, with the page window elided.',
          '',
          '### The trade, stated rather than hidden',
          '',
          '`LIMIT/OFFSET` over a table that is being written to shows duplicates and skips rows as the pages move, and `OFFSET 40000` is a sequential scan. For a directory that the user has already filtered down to a few hundred rows. That is fine, and being able to jump to page 12 is worth more than the theoretical correctness.',
          '',
          'For an audit log, an event stream, or anything ordered by time and still growing, use **keyset** pagination and an infinite list instead: there is a working one on the Patterns page.',
          '',
          '### Elision',
          '',
          '900 page buttons is not a navigation control, and every one of them is a tab stop. The window shows the first page, the last page, the current page and its `siblings`, with ellipses standing in for the rest.',
          '',
          '### On a phone',
          '',
          'The numbered window is hidden below `sm` and replaced by a live "Page 3 of 46". Twelve 32px targets do not fit on a 375px screen, and shrinking them below 44px makes them unhittable. Previous and Next survive, because those are the two anyone uses on a phone anyway.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    page: {
      description: 'The current page, 1-based.',
      control: { type: 'number', min: 1 },
      table: { type: { summary: 'number' }, category: 'State' },
    },
    pageCount: {
      description: 'Total number of pages. Derive it from the row count, not the other way round.',
      control: { type: 'number', min: 1 },
      table: { type: { summary: 'number' }, category: 'State' },
    },
    onPageChange: {
      description: 'Fires with the requested page. The component holds no state of its own.',
      control: false,
      table: { type: { summary: '(page: number) => void' }, category: 'State' },
    },
    siblings: {
      description:
        'How many pages to show either side of the current one before eliding. 1 is right for most tables; 2 for a very wide toolbar.',
      control: { type: 'range', min: 0, max: 4, step: 1 },
      table: {
        type: { summary: 'number' },
        defaultValue: { summary: '1' },
        category: 'Appearance',
      },
    },
    totalItems: {
      description:
        'Row count, for the "Showing 21–40 of 912" summary. Omit both this and `pageSize` to hide it.',
      control: { type: 'number' },
      table: { type: { summary: 'number' }, category: 'Content' },
    },
    pageSize: {
      description: 'Rows per page, used only for the summary arithmetic.',
      control: { type: 'number' },
      table: { type: { summary: 'number' }, category: 'Content' },
    },
    label: {
      description: 'Accessible name for the `<nav>`. Change it when a page has two pagers.',
      control: 'text',
      table: {
        type: { summary: 'string' },
        defaultValue: { summary: 'Pagination' },
        category: 'Accessibility',
      },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {
    // Required, so it belongs in `args`; the stateful stories replace it.
    onPageChange: () => undefined,
    page: 6,
    pageCount: 46,
    siblings: 1,
    totalItems: 912,
    pageSize: 20,
  },
} satisfies Meta<typeof Pagination>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: function PlaygroundStory(args) {
    const [page, setPage] = useState(args.page);
    return <Pagination {...args} page={page} onPageChange={setPage} />;
  },
};

export const Elision: Story = {
  name: 'How the window elides',
  parameters: {
    docs: {
      description: {
        story:
          'The same 46-page set at four positions. Near the ends the window slides rather than centring, so the control never renders a leading ellipsis that hides only one page, an ellipsis standing in for a single number is worse than the number.',
      },
    },
  },
  render: (args) => (
    <div className="space-y-6">
      {[1, 4, 23, 46].map((page) => (
        <div key={page} className="space-y-1.5">
          <p className="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
            Page {page}
          </p>
          <Pagination
            {...args}
            page={page}
            label={`Pagination example, page ${String(page)}`}
            onPageChange={() => undefined}
          />
        </div>
      ))}
    </div>
  ),
};

export const FewPages: Story = {
  name: 'Few enough not to elide',
  args: { page: 2, pageCount: 5, totalItems: 92, pageSize: 20 },
  parameters: {
    docs: {
      description: {
        story:
          'Below `siblings * 2 + 5` pages there is nothing worth hiding, so every page is rendered. The elided form would be longer than the full one.',
      },
    },
  },
  render: function FewStory(args) {
    const [page, setPage] = useState(args.page);
    return <Pagination {...args} page={page} onPageChange={setPage} />;
  },
};

export const WithATable: Story = {
  name: 'Under a table',
  parameters: {
    docs: {
      description: {
        story:
          'Working, over a real 92-row set. The page size selector is part of the pattern rather than of the component: changing it has to reset the page, and only the screen knows what "reset" means for its data.',
      },
    },
  },
  render: function TableStory() {
    const rows = Array.from({ length: 92 }, (_, i) => ({
      id: i + 1,
      name: `Employee ${String(i + 1).padStart(3, '0')}`,
      team: ['Platform', 'Payroll', 'People Ops', 'Support'][i % 4] ?? 'Platform',
      status: ['Active', 'On leave', 'Active', 'Active'][i % 4] ?? 'Active',
    }));

    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const pageCount = Math.ceil(rows.length / pageSize);
    const visible = rows.slice((page - 1) * pageSize, page * pageSize);

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-end gap-2">
          <label htmlFor="page-size" className="text-sm text-fg-muted">
            Rows per page
          </label>
          <Select
            value={String(pageSize)}
            onValueChange={(next) => {
              setPageSize(Number(next));
              // Page 8 of 10 does not exist once the page size trebles.
              setPage(1);
            }}
          >
            <SelectTrigger id="page-size" size="sm" className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['10', '25', '50'].map((size) => (
                <SelectItem key={size} value={size}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Table aria-label="Employees">
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Team</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.name}</TableCell>
                <TableCell className="text-fg-muted">{row.team}</TableCell>
                <TableCell className="text-fg-muted">{row.status}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <Pagination
          page={page}
          pageCount={pageCount}
          onPageChange={setPage}
          totalItems={rows.length}
          pageSize={pageSize}
        />
      </div>
    );
  },
};
