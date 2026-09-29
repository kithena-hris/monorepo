import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../components/button/button';
import { ReachMark } from './reach-logo';

/**
 * The app mark: the glyph reversed out of a tile.
 *
 * It is the mark wherever the product needs an icon rather than a name: a
 * home screen, a browser tab, the corner of a sidebar, a "continue with"
 * button. `<ReachMark tile />` draws it; the lockup on the Brand page pairs it
 * with the word.
 */
const meta = {
  title: 'Foundations/App marks',
  component: ReachMark,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The Reach app icon. Always the squircle, never stretched, never recoloured outside the palette. The corner is 9/32 of the side at every size, so a 16px favicon and a 96px home-screen icon are one shape scaled.',
      },
    },
  },
  args: { tile: true },
} satisfies Meta<typeof ReachMark>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Brand: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The accent tile, and its inverse for a surface where the accent would compete with the content around it.',
      },
    },
  },
  render: () => (
    <div className="flex flex-wrap gap-5">
      <ReachMark tile title="Reach" className="size-24" />
      <ReachMark tile="invert" title="Reach, inverted" className="size-24" />
    </div>
  ),
};

/*
 * The sizes an app mark is actually asked for, from a browser tab to a home
 * screen. Written out rather than interpolated, so Tailwind can see each class.
 */
const sizes = [
  { size: 'size-4', label: '16' },
  { size: 'size-5', label: '20' },
  { size: 'size-6', label: '24' },
  { size: 'size-8', label: '32' },
  { size: 'size-12', label: '48' },
  { size: 'size-16', label: '64' },
  { size: 'size-24', label: '96' },
] as const;

export const Sizes: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The tile holds the glyph together at 16px, where the bare glyph needs `compact` to stop the gap closing up.',
      },
    },
  },
  render: () => (
    <div className="flex flex-wrap items-end gap-4">
      {sizes.map((entry) => (
        <div key={entry.label} className="flex flex-col items-center gap-2">
          <ReachMark tile className={entry.size} />
          <span className="font-mono text-2xs text-fg-muted">{entry.label}</span>
        </div>
      ))}
    </div>
  ),
};

export const Mono: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'One colour, for print, a fax, an embroidery machine, or a ground too busy for the accent. `tile="invert"` follows the theme, ink on paper in light and paper on ink in dark; the bare glyph takes `currentColor`.',
      },
    },
  },
  render: () => (
    <div className="flex flex-wrap gap-3">
      <span className="inline-flex rounded-md bg-surface p-4 shadow-sm">
        <ReachMark tile="invert" className="size-14" />
      </span>
      <span className="inline-flex rounded-md bg-invert p-4 text-fg-on-invert">
        <ReachMark className="size-14" />
      </span>
      <span className="inline-flex rounded-md bg-surface-sunken p-4 text-fg">
        <ReachMark className="size-14" />
      </span>
    </div>
  ),
};

export const InAButton: Story = {
  name: 'In a button',
  parameters: {
    docs: {
      description: {
        story:
          'Where a control hands the person over to the product, the mark leads the label. On the accent button the tile turns light, so the mark is not an accent square on an accent field. Full width under a finger, like any primary action on a phone.',
      },
    },
  },
  render: () => (
    <div className="flex flex-col items-start gap-3 touch:items-stretch">
      <Button variant="primary" size="lg" startIcon={<ReachMark tile="light" />}>
        Continue with Reach
      </Button>
      <Button variant="secondary" size="lg" startIcon={<ReachMark tile />}>
        Open in Reach
      </Button>
    </div>
  ),
};
