import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  ArrowRight,
  Ban,
  Copy,
  Download,
  Mail,
  Pencil,
  Star,
  Trash2,
  UserMinus,
} from 'lucide-react';
import { useState, type JSX } from 'react';

import { Avatar } from '../avatar/avatar';
import { Badge } from '../badge/badge';
import { Button } from '../button/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../dropdown-menu/dropdown-menu';
import { Money } from '../money/money';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../table/table';
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from './context-menu';

const meta = {
  title: 'Components/ContextMenu',
  component: ContextMenuContent,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'The right-click menu.',
          '',
          '### The rule that decides whether you may use one',
          '',
          '**Every command in a context menu must exist somewhere else too.** A right-click is undiscoverable: new users never find it, and on a touch device it is a long-press competing with text selection and with the browser\'s own menu. It is an *accelerator* for people who already know the command exists, never the only route to it. If "Terminate employment" lives only here. It does not exist.',
          '',
          "The usual pairing, shown in the table story: the same commands in a row's `DropdownMenu`, and a context menu on the row for whoever works that queue all day.",
          '',
          '### Keyboard',
          '',
          'Radix opens on the platform context-menu key (**Shift+F10**, or the menu key) as well as on right-click, with arrow keys, typeahead and Escape all behaving. That is more than most implementations manage, and it still does not make the menu discoverable, which is why the rule above holds.',
          '',
          '### Touch',
          '',
          'A long-press opens it and the synthetic click is suppressed. On iOS the same long-press also raises the system selection callout, which cannot be prevented without breaking selection everywhere, so the trigger sets `select-none`, a trade that is only correct on a surface whose text nobody needs to copy.',
          '',
          '### Details',
          '',
          '- The panel grows from the pointer (`--radix-context-menu-content-transform-origin`), which ties it to the thing that was clicked rather than to a corner.',
          '- Items get the 44px floor on a coarse pointer: a long-press that opens a menu of 28px rows is a menu you cannot then hit.',
          '- `destructive` colours an item, and colour is not consent: confirm separately.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    collisionPadding: {
      description:
        'Minimum distance kept from the viewport edge. Without it, a menu opened near the bottom of a phone renders under the browser chrome where nothing can scroll it into view.',
      control: { type: 'range', min: 0, max: 48, step: 4 },
      table: { type: { summary: 'number' }, defaultValue: { summary: '12' }, category: 'Position' },
    },
    loop: {
      description: 'Whether arrowing past the last item wraps to the first.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'Behaviour',
      },
    },
    onCloseAutoFocus: {
      description: 'Where focus goes on close. By default back to the trigger, which is correct.',
      control: false,
      table: { type: { summary: '(event: Event) => void' }, category: 'Behaviour' },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: { collisionPadding: 12 },
} satisfies Meta<typeof ContextMenuContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <ContextMenu>
      <ContextMenuTrigger className="grid h-40 max-w-md place-items-center rounded-lg border border-dashed border-border bg-surface-sunken text-sm text-fg-muted">
        Right-click here, or press Shift+F10
      </ContextMenuTrigger>
      <ContextMenuContent {...args}>
        <ContextMenuLabel>Grace Hopper</ContextMenuLabel>
        <ContextMenuSeparator />
        <ContextMenuItem shortcut="⏎">
          <Pencil aria-hidden />
          Open record
        </ContextMenuItem>
        <ContextMenuItem shortcut="⌘C">
          <Copy aria-hidden />
          Copy employee id
        </ContextMenuItem>
        <ContextMenuItem>
          <Mail aria-hidden />
          Send a message
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem destructive>
          <UserMinus aria-hidden />
          Start offboarding
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  ),
};

export const WithSubmenus: Story = {
  name: 'Submenus and state',
  parameters: {
    docs: {
      description: {
        story:
          'Checkbox and radio items report `aria-checked` and hold their state, so a context menu can carry a view setting as well as commands. Keep the depth to one submenu: a nested menu on a right-click is a pointer path most people cannot hold.',
      },
    },
  },
  render: function SubmenuStory(args) {
    const [density, setDensity] = useState('comfortable');
    const [showSalary, setShowSalary] = useState(true);
    const [showLocation, setShowLocation] = useState(false);

    return (
      <div className="space-y-3">
        <ContextMenu>
          <ContextMenuTrigger className="grid h-40 max-w-md place-items-center rounded-lg border border-dashed border-border bg-surface-sunken text-sm text-fg-muted">
            Right-click the table area
          </ContextMenuTrigger>
          <ContextMenuContent {...args} className="w-56">
            <ContextMenuLabel>View</ContextMenuLabel>
            <ContextMenuRadioGroup value={density} onValueChange={setDensity}>
              <ContextMenuRadioItem value="compact">Compact</ContextMenuRadioItem>
              <ContextMenuRadioItem value="comfortable">Comfortable</ContextMenuRadioItem>
              <ContextMenuRadioItem value="spacious">Spacious</ContextMenuRadioItem>
            </ContextMenuRadioGroup>
            <ContextMenuSeparator />
            <ContextMenuLabel>Columns</ContextMenuLabel>
            <ContextMenuCheckboxItem checked={showSalary} onCheckedChange={setShowSalary}>
              Base salary
            </ContextMenuCheckboxItem>
            <ContextMenuCheckboxItem checked={showLocation} onCheckedChange={setShowLocation}>
              Location
            </ContextMenuCheckboxItem>
            <ContextMenuSeparator />
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Download aria-hidden />
                Export
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem>CSV</ContextMenuItem>
                <ContextMenuItem>Excel</ContextMenuItem>
                <ContextMenuItem>PDF register</ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
          </ContextMenuContent>
        </ContextMenu>

        <p aria-live="polite" className="text-sm text-fg-muted">
          Density <span className="font-medium text-fg">{density}</span> · columns{' '}
          <span className="font-medium text-fg">
            {[showSalary && 'salary', showLocation && 'location'].filter(Boolean).join(', ') ||
              'none'}
          </span>
        </p>
      </div>
    );
  },
};

export const OnTableRows: Story = {
  name: 'On table rows, with the same commands elsewhere',
  parameters: {
    docs: {
      description: {
        story:
          'The pairing the rule demands. Right-click any row for the accelerator; the ⋯ button at the end of the row carries the identical commands for everyone who never right-clicks, which is most people, and every touch user. Building only one of the two is the mistake.',
      },
    },
  },
  render: function RowsStory(args) {
    const [starred, setStarred] = useState<string[]>(['Ada Lovelace']);
    const [log, setLog] = useState<string | null>(null);

    const people = [
      ['Grace Hopper', 'Platform', 'EMP-004182', '1420000'],
      ['Ada Lovelace', 'Platform', 'EMP-004183', '1285000'],
      ['Radia Perlman', 'Payroll', 'EMP-004184', '1360000'],
    ] as const;

    const commands = (
      name: string,
    ): { label: string; icon: JSX.Element; destructive?: boolean }[] => [
      { label: 'Open record', icon: <ArrowRight aria-hidden /> },
      { label: 'Copy employee id', icon: <Copy aria-hidden /> },
      { label: starred.includes(name) ? 'Unstar' : 'Star', icon: <Star aria-hidden /> },
      { label: 'Start offboarding', icon: <UserMinus aria-hidden />, destructive: true },
    ];

    const run = (name: string, label: string): void => {
      if (label === 'Star' || label === 'Unstar') {
        setStarred((current) =>
          current.includes(name) ? current.filter((entry) => entry !== name) : [...current, name],
        );
      }
      setLog(`${label}, ${name}`);
    };

    return (
      <div className="space-y-3">
        <Table aria-label="People">
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Team</TableHead>
              <TableHead numeric>Base salary</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {people.map(([name, team, id, salary]) => (
              <ContextMenu key={id}>
                <ContextMenuTrigger asChild>
                  <TableRow interactive>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <Avatar size="sm" name={name} />
                        <span className="font-medium">{name}</span>
                        {starred.includes(name) ? (
                          <Badge size="sm" tone="warning">
                            Starred
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-fg-muted">{team}</TableCell>
                    <TableCell numeric>
                      <Money minorUnits={salary} currency="EUR" locale="en-IE" />
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="ghost" aria-label={`Actions for ${name}`}>
                            ⋯
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {commands(name).map((command) => (
                            <DropdownMenuItem
                              key={command.label}
                              destructive={command.destructive ?? false}
                              onSelect={() => {
                                run(name, command.label);
                              }}
                            >
                              {command.icon}
                              {command.label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                </ContextMenuTrigger>
                <ContextMenuContent {...args}>
                  <ContextMenuLabel>{name}</ContextMenuLabel>
                  <ContextMenuSeparator />
                  {commands(name).map((command) => (
                    <ContextMenuItem
                      key={command.label}
                      destructive={command.destructive ?? false}
                      onSelect={() => {
                        run(name, command.label);
                      }}
                    >
                      {command.icon}
                      {command.label}
                    </ContextMenuItem>
                  ))}
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </TableBody>
        </Table>

        <p aria-live="polite" className="text-sm text-fg-muted">
          {log ?? 'Right-click a row, or use the ⋯ button. Both run the same commands.'}
        </p>
      </div>
    );
  },
};

export const Disabled: Story = {
  name: 'Unavailable commands',
  parameters: {
    docs: {
      description: {
        story:
          'A command the current user may not run stays visible and disabled rather than disappearing. A menu whose contents change per row teaches nobody what the product can do, and "you do not have permission" is information, while a missing item reads as a bug.',
      },
    },
  },
  render: (args) => (
    <ContextMenu>
      <ContextMenuTrigger
        hint
        className="inline-block rounded-md border border-border bg-surface px-3 py-2 text-base text-fg"
      >
        Katherine Johnson: offboarding
      </ContextMenuTrigger>
      <ContextMenuContent {...args}>
        <ContextMenuItem>
          <ArrowRight aria-hidden />
          Open record
        </ContextMenuItem>
        <ContextMenuItem disabled>
          <Pencil aria-hidden />
          Edit compensation
        </ContextMenuItem>
        <ContextMenuItem disabled>
          <Ban aria-hidden />
          Reactivate, the leaving date has passed
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem destructive>
          <Trash2 aria-hidden />
          Delete draft offer
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  ),
};
