import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Bold, Italic, Link, List, ListOrdered } from 'lucide-react-native';
import { View } from 'react-native-css/components';

import { designDocs } from '../../docs/design.ts';
import { Button } from '../button/button.tsx';
import { CardTitle } from '../card/card.tsx';
import { Icon } from '../icon/icon.tsx';
import { Inline, Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import { Separator } from './separator.tsx';

const meta = {
  title: 'Components/Separator',
  component: Separator,
  parameters: designDocs('separator'),
} satisfies Meta<typeof Separator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => (
    <Stack gap={3}>
      <Text>Above</Text>
      <Separator />
      <Text>Below</Text>
    </Stack>
  ),
};

export const InAToolbar: Story = {
  name: 'Between groups of actions',
  render: () => (
    <Inline gap={0} className="gap-0.5" wrap={false}>
      <Button variant="ghost" startIcon={<Icon icon={Bold} />} accessibilityLabel="Bold" />
      <Button variant="ghost" startIcon={<Icon icon={Italic} />} accessibilityLabel="Italic" />
      <Separator orientation="vertical" className="h-6 self-center" />
      <Button variant="ghost" startIcon={<Icon icon={List} />} accessibilityLabel="Bulleted list" />
      <Button
        variant="ghost"
        startIcon={<Icon icon={ListOrdered} />}
        accessibilityLabel="Numbered list"
      />
      <Separator orientation="vertical" className="h-6 self-center" />
      <Button variant="ghost" startIcon={<Icon icon={Link} />} accessibilityLabel="Link" />
    </Inline>
  ),
};

function Facts({ rows }: { rows: readonly (readonly [string, string])[] }): React.JSX.Element {
  return (
    <View>
      {rows.map(([key, value], i) => (
        <View key={key}>
          {i > 0 ? <Separator /> : null}
          <Inline justify="between" wrap={false} className="min-h-[52px] py-2.5">
            <Text variant="callout" tone="muted">
              {key}
            </Text>
            <Text variant="callout" weight="medium">
              {value}
            </Text>
          </Inline>
        </View>
      ))}
    </View>
  );
}

export const ASectionBreak: Story = {
  name: 'A real section break',
  parameters: {
    docs: {
      description: {
        story:
          'Between two sections a listener should hear apart, the line is not decorative: `decorative={false}`.',
      },
    },
  },
  render: () => (
    <Stack gap={2} className="gap-2.5">
      <CardTitle>Personal</CardTitle>
      <Facts
        rows={[
          ['Name', 'Priya Shah'],
          ['Pronouns', 'She/her'],
        ]}
      />
      <Separator decorative={false} weight="strong" className="my-2" />
      <CardTitle>Employment</CardTitle>
      <Facts
        rows={[
          ['Team', 'Engineering'],
          ['Start', '2 Sep 2024'],
        ]}
      />
    </Stack>
  ),
};

export const WhitespaceInstead: Story = {
  name: 'When space is the better answer',
  render: () => (
    <Inline gap={3} wrap={false} align="start">
      <View className="flex-1 rounded-sm bg-danger-subtle p-3">
        <Stack gap={1} className="gap-1.5">
          <Text variant="footnote">Name</Text>
          <Separator />
          <Text variant="footnote">Email</Text>
          <Separator />
          <Text variant="footnote">Phone</Text>
        </Stack>
        <Text variant="caption" weight="semibold" tone="danger" className="mt-2">
          Too many lines
        </Text>
      </View>
      <View className="flex-1 rounded-sm bg-success-subtle p-3">
        <Stack gap={3} className="gap-3.5">
          <Text variant="footnote">Name</Text>
          <Text variant="footnote">Email</Text>
          <Text variant="footnote">Phone</Text>
        </Stack>
        <Text variant="caption" weight="semibold" tone="success" className="mt-2">
          Space does it
        </Text>
      </View>
    </Inline>
  ),
};
