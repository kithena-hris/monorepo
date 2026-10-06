import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Lock, Pencil } from 'lucide-react-native';
import { Text as CssText, View } from 'react-native-css/components';

import { designDocs } from '../../docs/design.ts';
import { Avatar } from '../avatar/avatar.tsx';
import { Badge } from '../badge/badge.tsx';
import { Button } from '../button/button.tsx';
import { Card } from '../card/card.tsx';
import { Icon } from '../icon/icon.tsx';
import { Money } from '../money/money.tsx';
import { Text } from '../text/text.tsx';
import { KeyValues } from './key-values.tsx';

const meta = {
  title: 'Components/KeyValues',
  component: KeyValues,
  parameters: designDocs('key-values'),
  args: {
    items: [
      { label: 'Team', value: 'Engineering' },
      { label: 'Manager', value: 'Jonas Weber' },
      { label: 'Location', value: 'Berlin' },
      { label: 'Start date', value: '2 Sep 2024' },
    ],
  },
} satisfies Meta<typeof KeyValues>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const InACard: Story = {
  name: 'In A Card',
  render: () => (
    <Card className="gap-2">
      <View className="flex-row items-center justify-between">
        <Text variant="title3" weight="bold">
          Employment
        </Text>
        <Button variant="ghost" size="sm" startIcon={<Icon icon={Pencil} />}>
          Edit
        </Button>
      </View>
      <KeyValues
        items={[
          { label: 'Contract', value: 'Permanent' },
          { label: 'Hours', value: '40 per week' },
          { label: 'Notice', value: '3 months' },
        ]}
      />
    </Card>
  ),
};

export const RichValues: Story = {
  name: 'Rich Values',
  render: () => (
    <KeyValues
      items={[
        {
          label: 'Manager',
          value: (
            <>
              <Avatar name="Jonas Weber" size={24} decorative />
              <CssText className="text-callout font-medium text-fg">Jonas Weber</CssText>
            </>
          ),
        },
        {
          label: 'Status',
          value: (
            <Badge tone="success" size="sm" dot>
              Active
            </Badge>
          ),
        },
        {
          label: 'Email',
          value: (
            <Button variant="link" size="sm" href="mailto:priya@reach.co">
              priya@reach.co
            </Button>
          ),
        },
        {
          label: 'Skills',
          value: (
            <View className="flex-row gap-1">
              {['React', 'TypeScript', 'Figma'].map((skill) => (
                <Badge key={skill} size="sm">
                  {skill}
                </Badge>
              ))}
            </View>
          ),
        },
        {
          label: 'Salary',
          value: (
            <>
              <Badge size="sm" icon={Lock}>
                Private
              </Badge>
              <Money
                minorUnits="9200000"
                currency="EUR"
                locale="en-GB"
                className="text-callout font-medium"
              />
            </>
          ),
        },
      ]}
    />
  ),
};
