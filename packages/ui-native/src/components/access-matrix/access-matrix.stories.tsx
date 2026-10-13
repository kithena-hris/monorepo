import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { useState } from 'react';

import { designDocs } from '../../docs/design.ts';
import { Stack } from '../layout/layout.tsx';
import { ListItem } from '../list-item/list-item.tsx';
import { Switch } from '../switch/switch.tsx';
import { AccessMatrix, type AccessAudience, type AccessValue } from './access-matrix.tsx';

const meta = {
  title: 'Forms/Access matrix',
  component: AccessMatrix,
  parameters: designDocs('access-matrix'),
} satisfies Meta<typeof AccessMatrix>;

export default meta;
// Every story renders its own; no args are shared.
type Story = StoryObj;

const audiences: readonly AccessAudience[] = [
  { id: 'self', label: 'The employee' },
  { id: 'manager', label: 'Manager', description: 'Their direct manager' },
  { id: 'above', label: 'Line managers', description: 'Managers above', canChange: false },
  { id: 'hr', label: 'HR' },
  { id: 'finance', label: 'Finance', description: 'For payroll' },
];

function Live({
  initial,
  everyone = false,
}: {
  initial: AccessValue;
  everyone?: boolean;
}): React.JSX.Element {
  const [value, setValue] = useState(initial);
  const [all, setAll] = useState(everyone);
  return (
    <Stack gap={3}>
      <ListItem
        listitem={false}
        description="Ticks every See box"
        trailing={
          <Switch checked={all} accessibilityLabel="Everyone can see it" onCheckedChange={setAll} />
        }
      >
        Everyone can see it
      </ListItem>
      <AccessMatrix audiences={audiences} value={value} allSee={all} onChange={setValue} />
    </Stack>
  );
}

export const Playground: Story = {
  render: () => <Live initial={{ see: ['self', 'manager'], change: ['hr'] }} />,
};

export const EveryoneCanSeeIt: Story = {
  name: 'Everyone can see it',
  render: () => <Live initial={{ see: ['self'], change: ['self', 'hr'] }} everyone />,
};
