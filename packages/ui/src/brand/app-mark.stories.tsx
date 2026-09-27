import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../components/button/button';
import { AppMark } from './app-mark';

const meta = {
  title: 'Foundations/App marks',
  component: AppMark,
  args: { app: 'slack' },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Another product’s mark, where a screen connects to it. A mark and not an icon: it is the other company’s, drawn in its own colours as its guidelines ask, never recoloured and never redrawn in the icon stroke.',
          '',
          '`tone="mono"` follows `currentColor`, for a surface where full colour would fight. Beside the app’s name the mark is decoration; standing alone it takes a `title`.',
        ].join('\n'),
      },
    },
  },
} satisfies Meta<typeof AppMark>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Brand: Story = {};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-end gap-4">
      <AppMark {...args} className="size-4" />
      <AppMark {...args} className="size-5" />
      <AppMark {...args} className="size-8" />
      <AppMark {...args} className="size-12" title="Slack" />
    </div>
  ),
};

export const Mono: Story = { args: { tone: 'mono' }, render: (args) => <AppMark {...args} className="size-8 text-fg" /> };

/** Beside the name, on the control that connects it. */
export const InAButton: Story = {
  render: (args) => <Button startIcon={<AppMark {...args} />}>Add to Slack</Button>,
};
