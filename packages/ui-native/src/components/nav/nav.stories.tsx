import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import {
  Calendar,
  ChartColumn,
  Folder,
  House,
  Network,
  Settings,
  Users,
  Wallet,
} from 'lucide-react-native';
import { useState } from 'react';

import { designDocs } from '../../docs/design.ts';
import { Nav, NavGroup, NavItem } from './nav.tsx';

const meta = {
  title: 'Components/Nav',
  component: Nav,
  parameters: designDocs('nav'),
} satisfies Meta<typeof Nav>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SectionNavigation: Story = {
  name: 'Section Navigation',
  args: { label: 'Main' },
  render: function SectionStory() {
    const [current, setCurrent] = useState('People');
    const item = (label: string, icon: typeof House, count?: number): React.JSX.Element => (
      <NavItem
        icon={icon}
        count={count}
        current={current === label}
        onPress={() => {
          setCurrent(label);
        }}
      >
        {label}
      </NavItem>
    );
    return (
      <Nav label="Main">
        {item('Home', House)}
        {item('People', Users)}
        {item('Time off', Calendar, 3)}
        {item('Payroll', Wallet)}
        {item('Insights', ChartColumn)}
        <NavGroup label="Workspace">{item('Settings', Settings)}</NavGroup>
      </Nav>
    );
  },
};

export const SectionsOnDemand: Story = {
  name: 'Sections On Demand',
  args: { label: 'People' },
  render: () => (
    <Nav label="People">
      <NavItem icon={Users} current>
        People
      </NavItem>
      <NavGroup label="Teams" collapsible>
        <NavItem level={2}>Engineering</NavItem>
        <NavItem level={2}>Design</NavItem>
        <NavItem level={2}>Sales</NavItem>
      </NavGroup>
      <NavGroup label="Locations" collapsible defaultOpen={false} count={6}>
        <NavItem level={2}>Berlin</NavItem>
        <NavItem level={2}>London</NavItem>
      </NavGroup>
    </Nav>
  ),
};

export const DescribedMenu: Story = {
  name: 'Described Menu',
  args: { label: 'People' },
  render: () => (
    <Nav label="People">
      <NavItem icon={Users} description="Everyone at Reach" current chevron>
        Directory
      </NavItem>
      <NavItem icon={Network} description="Who reports to whom" chevron>
        Org chart
      </NavItem>
      <NavItem icon={Folder} description="Policies and contracts" chevron>
        Documents
      </NavItem>
    </Nav>
  ),
};
