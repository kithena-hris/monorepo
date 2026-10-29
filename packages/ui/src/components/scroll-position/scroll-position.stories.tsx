import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { ScrollPosition } from './scroll-position';

const meta = {
  title: 'Components/Scroll position',
  component: ScrollPosition,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: [
          'Where you are in a long list that keeps loading: a ring filling as the reader goes, the count beside it, and a way back to the start.',
          '',
          '`DataTable` and `VirtualList` pin it over a list the window scrolls by themselves, rising into the list\'s top corner once its header pins; place it by hand only over a list of your own. Without a `total` the count is out of what has loaded ("150 of 200+"). The count is deliberately not a live region: it changes on every page of a scroll, and the list announces its own loads.',
        ].join('\n'),
      },
    },
  },
  args: { seen: 150, total: 388 },
} satisfies Meta<typeof ScrollPosition>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { onBackToTop: fn() } };

export const CountOnly: Story = { args: { seen: 50 } };

/** Nobody has counted the rows yet: out of what has loaded, until the last page lands. */
export const Uncounted: Story = {
  args: { seen: 150, total: null, loaded: 200, onBackToTop: fn() },
};
