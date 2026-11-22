import type { Meta, StoryObj } from '@storybook/react-vite';

import { Country } from './country';

const meta = {
  title: 'Components/Country',
  component: Country,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'A country: its flag and its name in the reader’s language, from an ISO 3166-1 alpha-2 code.',
          '',
          'The name comes from the platform, so there is no list of countries to keep and it follows the page’s language. The flag is the system’s emoji; where a system has none (Windows) the two letters of the code are drawn in its place.',
          '',
          '`shape="rounded"` crops the flag to a circle, as beside a person’s name; `shape="boxed"` sets it on a tile so flags of different outlines line up down a column.',
          '',
          'Use `display="code"` in a tight table column and `display="flag"` beside something that already names the country. A code that is not two letters is shown as written, with no flag.',
        ].join('\n'),
      },
    },
  },
  args: { code: 'DE' },
} satisfies Meta<typeof Country>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Displays: Story = {
  render: () => (
    <div className="flex flex-col gap-3 text-sm text-fg">
      <Country code="IN" />
      <Country code="us" display="code" />
      <Country code="JP" display="flag" />
      <Country code="Somewhere else" />
    </div>
  ),
};

/** The flag as the system draws it, cropped to a circle, or set on a tile. */
export const Shapes: Story = {
  render: () => (
    <div className="flex flex-col gap-3 text-sm text-fg">
      <Country code="TW" />
      <Country code="TW" shape="rounded" />
      <Country code="TW" shape="boxed" />
      <span className="flex items-center gap-2">
        <Country code="NP" display="flag" shape="rounded" />
        <Country code="NP" display="flag" shape="boxed" />
      </span>
    </div>
  ),
};

export const InAColumn: Story = {
  render: () => (
    <ul className="flex w-40 flex-col gap-2 text-sm text-fg">
      {['GB', 'FR', 'BR', 'SJ'].map((code) => (
        <li key={code}>
          <Country code={code} className="w-full" />
        </li>
      ))}
    </ul>
  ),
};
