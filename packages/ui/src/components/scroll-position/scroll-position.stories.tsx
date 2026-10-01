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
          'Where you are in a long list that keeps loading: a count, and a way back to the start.',
          '',
          'Pin it over the list at the trailing edge once the reader has scrolled, and leave `onBackToTop` out near the top, where it goes nowhere. The count is deliberately not a live region: it changes on every page of a scroll, and the list announces its own loads.',
        ].join('\n'),
      },
    },
  },
  args: { children: '150 of 388' },
} satisfies Meta<typeof ScrollPosition>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { onBackToTop: fn() } };

export const CountOnly: Story = { args: { children: '50 of 388' } };
