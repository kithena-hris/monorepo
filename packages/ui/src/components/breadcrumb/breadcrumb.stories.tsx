import type { Meta, StoryObj } from '@storybook/react-vite';
import { Home, Slash } from 'lucide-react';

import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
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
          'A deep trail wraps to three lines on a phone, which pushes the page title below the fold. Mark the middle crumbs `collapsible` and they hide below `sm`, leaving the first and last, the two that actually carry the navigation: plus an ellipsis so the reader knows something folded.',
          '',
          'Resize the canvas, or switch the toolbar to an iPhone viewport, to watch it happen.',
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
          'The middle three crumbs are `collapsible`, so below `sm` the trail becomes "People … Bank details". Narrow the canvas to see it. The ellipsis carries a screen-reader-only "Collapsed levels", so the fold is announced rather than silently dropping context.',
      },
    },
  },
  render: () => (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="#" aria-label="Home">
            <Home className="size-3.5" aria-hidden />
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink href="#">People</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbEllipsis />
        <BreadcrumbSeparator className="max-sm:hidden" />
        <BreadcrumbItem collapsible>
          <BreadcrumbLink href="#">Engineering</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator className="max-sm:hidden" />
        <BreadcrumbItem collapsible>
          <BreadcrumbLink href="#">Grace Hopper</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator className="max-sm:hidden" />
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
