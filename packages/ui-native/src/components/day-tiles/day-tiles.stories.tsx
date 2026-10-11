import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import { designDocs } from '../../docs/design.ts';
import { Avatar, AvatarGroup } from '../avatar/avatar.tsx';
import { DayTiles } from './day-tiles.tsx';

const meta = {
  title: 'Components/DayTiles',
  component: DayTiles,
  parameters: designDocs('day-tiles'),
  args: {
    days: [
      { id: 'mon', label: 'Mon', value: '6', footer: 'All in' },
      { id: 'tue', label: 'Tue', value: '6', footer: <AvatarGroup size={24} max={2}><Avatar name="Omar Haddad" decorative /></AvatarGroup> },
      {
        id: 'wed',
        label: 'Wed',
        value: '4',
        attention: true,
        footer: <AvatarGroup size={24} max={2}><Avatar name="Omar Haddad" decorative /><Avatar name="Yuki Sato" decorative /></AvatarGroup>,
      },
      { id: 'thu', label: 'Thu', value: '6', today: true, footer: <AvatarGroup size={24} max={2}><Avatar name="Lucía Fernández" decorative /></AvatarGroup> },
      { id: 'fri', label: 'Fri', value: '5', footer: <AvatarGroup size={24} max={2}><Avatar name="Marco Ruiz" decorative /><Avatar name="Lucía Fernández" decorative /></AvatarGroup> },
    ],
  },
} satisfies Meta<typeof DayTiles>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
