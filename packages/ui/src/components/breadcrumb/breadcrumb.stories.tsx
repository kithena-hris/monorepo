import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChevronsUpDown, House, Slash } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../button/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../dropdown-menu/dropdown-menu';

import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbMenu,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from './breadcrumb';

const meta = {
  title: 'Components/Breadcrumb',
  component: Breadcrumb,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Where this record sits, and how to get back up.',
          '',
          '### Three details that are usually wrong',
          '',
          '1. **The separators are `aria-hidden`.** A screen reader should read "People, Engineering, Grace Hopper", not "People slash Engineering slash Grace Hopper".',
          '2. **The last crumb is not a link.** A link to the page you are already on is a dead control. It renders as a `<span aria-current="page">`.',
          '3. **The whole thing is a `<nav aria-label="Breadcrumb">` wrapping an `<ol>`.** The order is the meaning, and the landmark is how a screen-reader user jumps straight to it.',
          '',
          '### On narrow screens',
          '',
          'A deep trail wraps to three lines on a phone, which pushes the page title below the fold. Mark the middle crumbs `collapsible` and they hide when the trail has less than 24rem, leaving the first and last, the two that actually carry the navigation: plus an ellipsis so the reader knows something folded.',
          '',
          'The width is the trail’s own, not the window’s, so the phone copy beside each story shows it folded.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    children: {
      description: 'A `BreadcrumbList` containing the items and separators.',
      control: false,
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
    'aria-label': {
      description:
        'Overrides the default landmark name. Change it only when a page has two breadcrumb trails, which is itself a design smell.',
      control: 'text',
      table: {
        type: { summary: 'string' },
        defaultValue: { summary: 'Breadcrumb' },
        category: 'Accessibility',
      },
    },
  },
  args: {},
} satisfies Meta<typeof Breadcrumb>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <Breadcrumb {...args}>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="#">People</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink href="#">Engineering</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Grace Hopper</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
};

export const Collapsing: Story = {
  name: 'Collapsing on a phone',
  parameters: {
    docs: {
      description: {
        story:
          'The middle three crumbs are `collapsible`, so in a narrow trail it becomes "People … Bank details": narrow the canvas to see it. The ellipsis carries a screen-reader-only "Collapsed levels", so the fold is announced rather than silently dropping context.\n\nOn a phone only the back link remains, "‹ Payroll", the parent of the page. The phone copy shows it.',
      },
    },
  },
  render: () => (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="#" aria-label="Home">
            <House className="size-3.5" aria-hidden />
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink href="#">People</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbItem className="hidden @max-sm:inline-flex">
          <BreadcrumbEllipsis />
        </BreadcrumbItem>
        <BreadcrumbSeparator className="@max-sm:hidden" />
        <BreadcrumbItem collapsible>
          <BreadcrumbLink href="#">Engineering</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator className="@max-sm:hidden" />
        <BreadcrumbItem collapsible>
          <BreadcrumbLink href="#">Grace Hopper</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator className="@max-sm:hidden" />
        <BreadcrumbItem collapsible>
          <BreadcrumbLink href="#">Payroll</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Bank details</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
};

export const CustomSeparator: Story = {
  name: 'A different separator',
  parameters: {
    docs: {
      description: {
        story:
          'The separator takes children. Whatever goes in stays `aria-hidden`, so a slash, a chevron or a dot are all purely visual choices.',
      },
    },
  },
  render: () => (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="#">Payroll</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator>
          <Slash className="size-3" />
        </BreadcrumbSeparator>
        <BreadcrumbItem>
          <BreadcrumbLink href="#">August 2026</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator>
          <Slash className="size-3" />
        </BreadcrumbSeparator>
        <BreadcrumbItem>
          <BreadcrumbPage>Register</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
};

export const LongLabels: Story = {
  name: 'With a long label',
  parameters: {
    docs: {
      description: {
        story:
          'Every crumb truncates rather than wrapping, and the list itself can wrap as a last resort. A breadcrumb that grows to two lines moves the page title, which is worse than an ellipsis.',
      },
    },
  },
  render: () => (
    <div className="max-w-sm">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="#">Organisations</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem className="max-w-[10rem]">
            <BreadcrumbLink href="#">Northern European Manufacturing Holdings BV</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Legal entities</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  ),
};

export const WithSiblingSwitcher: Story = {
  name: 'With Sibling Switcher',
  parameters: {
    docs: {
      description: {
        story:
          'A crumb can switch between siblings: the team here is a `DropdownMenu` behind a small secondary button, so moving from Engineering to Design does not mean going up a level and down again.',
      },
    },
  },
  render: function Render() {
    const [team, setTeam] = useState('Engineering');
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="#">People</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="xs" endIcon={<ChevronsUpDown />}>
                  {team}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup value={team} onValueChange={setTeam}>
                  {['Engineering', 'Design', 'Sales'].map((name) => (
                    <DropdownMenuRadioItem key={name} value={name}>
                      {name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Priya Shah</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  },
};

/**
 * The last crumb as a menu of its siblings: the next section over is one step
 * away, without going back up first. Still `aria-current`; the items are links.
 */
export const WithSectionMenu: Story = {
  name: 'With Section Menu',
  render: () => (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="#people">People</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbMenu
            label="Directory"
            menuLabel="People sections"
            groups={[
              {
                label: 'Workspace',
                items: [
                  { href: '#overview', label: 'Overview' },
                  { href: '#directory', label: 'Directory', current: true },
                  { href: '#approvals', label: 'Approvals' },
                ],
              },
              {
                label: 'Records',
                items: [
                  { href: '#completeness', label: 'Data completeness' },
                  { href: '#import', label: 'Import' },
                ],
              },
            ]}
          />
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
};
