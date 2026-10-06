import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Ellipsis, Link, Mail, Share } from 'lucide-react-native';
import { ScrollView, View } from 'react-native-css/components';

import { overlayDocs } from '../../docs/design.ts';
import { PEOPLE } from '../../docs/people.ts';
import { Stage, settled } from '../../docs/stage.tsx';
import { Avatar } from '../avatar/avatar.tsx';
import { Button } from '../button/button.tsx';
import { Icon } from '../icon/icon.tsx';
import { Text } from '../text/text.tsx';
import {
  ActionSheet,
  ActionSheetContent,
  ActionSheetItem,
  ActionSheetTrigger,
} from './action-sheet.tsx';

const meta = {
  title: 'Components/Action sheet',
  component: ActionSheetContent,
  parameters: overlayDocs('action-sheet'),
  // axe runs after this, on the open sheet, not on its slide in.
  play: settled,
} satisfies Meta<typeof ActionSheetContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => (
    <ActionSheet defaultOpen>
      <Stage
        height={460}
        trigger={
          <ActionSheetTrigger asChild>
            <Button
              size="sm"
              startIcon={<Icon icon={Ellipsis} />}
              accessibilityLabel="Request actions"
              className="self-start"
            />
          </ActionSheetTrigger>
        }
      >
        {(host) => (
          <ActionSheetContent portalHost={host} label="Request actions">
            <ActionSheetItem>Edit request</ActionSheetItem>
            <ActionSheetItem>Duplicate</ActionSheetItem>
            <ActionSheetItem>Share</ActionSheetItem>
          </ActionSheetContent>
        )}
      </Stage>
    </ActionSheet>
  ),
};

export const WithATitleAndADestructiveAction: Story = {
  name: 'With a title and a destructive action',
  render: () => (
    <ActionSheet defaultOpen>
      <Stage
        height={460}
        trigger={
          <ActionSheetTrigger asChild>
            <Button size="sm">Manage request</Button>
          </ActionSheetTrigger>
        }
      >
        {(host) => (
          <ActionSheetContent
            portalHost={host}
            title="Vacation · 14–18 Oct"
            description="Deleting can’t be undone."
          >
            <ActionSheetItem>Archive</ActionSheetItem>
            <ActionSheetItem destructive>Delete request</ActionSheetItem>
          </ActionSheetContent>
        )}
      </Stage>
    </ActionSheet>
  ),
};

export const ShareSheet: Story = {
  name: 'Share',
  render: () => (
    <ActionSheet defaultOpen>
      <Stage
        trigger={
          <ActionSheetTrigger asChild>
            <Button size="sm" startIcon={<Icon icon={Share} />}>
              Share
            </Button>
          </ActionSheetTrigger>
        }
      >
        {(host) => (
          <ActionSheetContent
            portalHost={host}
            label="Share"
            header={
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                accessibilityLabel="Share with"
                className="border-b border-border"
                contentContainerClassName="gap-3.5 p-4"
              >
                {PEOPLE.slice(0, 5).map((person) => (
                  <View key={person.name} className="items-center gap-1.5">
                    <Avatar name={person.name} size={52} decorative />
                    <Text className="text-[11px] leading-none font-medium">
                      {person.name.split(' ')[0]}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            }
          >
            <ActionSheetItem icon={Link}>Copy link</ActionSheetItem>
            <ActionSheetItem icon={Mail}>Email</ActionSheetItem>
          </ActionSheetContent>
        )}
      </Stage>
    </ActionSheet>
  ),
};
