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
          'Where you are in a long list: a map of it, its count, and a way back to the top.',
          '',
          "The map is the list on its side: the track is every row there is, the wash the rows loaded so far, the bright segment the rows on screen, gliding as the reader scrolls. The count runs up as pages land. `DataTable` and `VirtualList` float it at the window's foot over a long list and set it under a short one (`ScrollPositionRail`); place it by hand only over a list of your own. Without a `total` it says how many so far. Not a live region: it changes with every page loaded, and the list announces its own loads.",
        ].join('\n'),
      },
    },
  },
  args: { from: 41, to: 60, loaded: 200, total: 1003 },
} satisfies Meta<typeof ScrollPosition>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { onBackToTop: fn(), className: 'shadow-lg' } };

/** At the top: nowhere to go back to. */
export const AtTheTop: Story = { args: { from: 1, to: 20 } };

/** Every row loaded. */
export const AllLoaded: Story = {
  args: { from: 980, to: 1003, loaded: 1003, onBackToTop: fn() },
};

/** Nobody has counted the rows yet. */
export const Uncounted: Story = {
  args: { total: null, onBackToTop: fn() },
};
