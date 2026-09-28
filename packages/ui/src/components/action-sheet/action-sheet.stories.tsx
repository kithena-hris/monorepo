import type { Meta, StoryObj } from '@storybook/react-vite';
import { Copy, Ellipsis, Link, Mail, Pencil, Share, Trash2 } from 'lucide-react';

import { Avatar } from '../avatar/avatar';
import { Button } from '../button/button';
import {
  ActionSheet,
  ActionSheetContent,
  ActionSheetItem,
  ActionSheetTrigger,
} from './action-sheet';

const meta = {
  title: 'Components/Action sheet',
  component: ActionSheet,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: [
          'A short list of actions that slides up from the bottom. The destructive action is red, and Cancel always sits apart.',
          '',
          'The touch version of a menu. Under a finger it is an action sheet; at a desk the same parts render as a `DropdownMenu` anchored to the trigger. The switch is the pointer, never the width. Open one here in the web column and in the phone beside it to see both.',
          '',
          'It mirrors `DropdownMenu`’s parts (`ActionSheetTrigger`, `ActionSheetContent`, `ActionSheetItem`), so a menu becomes an action sheet by renaming them.',
        ].join('\n'),
      },
    },
  },
} satisfies Meta<typeof ActionSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => (
    <ActionSheet>
      <ActionSheetTrigger asChild>
        <Button startIcon={<Ellipsis aria-hidden="true" />} aria-label="Request actions" />
      </ActionSheetTrigger>
      <ActionSheetContent label="Request actions">
        <ActionSheetItem>Edit request</ActionSheetItem>
        <ActionSheetItem>Duplicate</ActionSheetItem>
        <ActionSheetItem>Share</ActionSheetItem>
      </ActionSheetContent>
    </ActionSheet>
  ),
};

export const WithATitleAndADestructiveAction: Story = {
  name: 'With a title and a destructive action',
  render: () => (
    <ActionSheet>
      <ActionSheetTrigger asChild>
        <Button>Manage request</Button>
      </ActionSheetTrigger>
      <ActionSheetContent title="Vacation · 14–18 Oct" description="Deleting can’t be undone.">
        <ActionSheetItem>Archive</ActionSheetItem>
        <ActionSheetItem destructive>Delete request</ActionSheetItem>
      </ActionSheetContent>
    </ActionSheet>
  ),
};

const people = ['Priya Shah', 'Jonas Weber', 'Amara Okafor', 'Mei Tanaka', 'Lucas Martin'];

export const ShareSheet: Story = {
  name: 'Share',
  render: () => (
    <ActionSheet>
      <ActionSheetTrigger asChild>
        <Button startIcon={<Share aria-hidden="true" />}>Share</Button>
      </ActionSheetTrigger>
      <ActionSheetContent
        label="Share"
        header={
          <ul
            aria-label="Share with"
            className="flex gap-3.5 overflow-x-auto p-4 shadow-[inset_0_-1px_0_var(--color-border)] [scrollbar-width:none]"
          >
            {people.map((name) => (
              <li key={name} className="flex shrink-0 flex-col items-center gap-1.5">
                <Avatar name={name} size="xl" />
                <span className="text-2xs font-medium">{name.split(' ')[0]}</span>
              </li>
            ))}
          </ul>
        }
      >
        <ActionSheetItem icon={<Link aria-hidden="true" />}>Copy link</ActionSheetItem>
        <ActionSheetItem icon={<Mail aria-hidden="true" />}>Email</ActionSheetItem>
      </ActionSheetContent>
    </ActionSheet>
  ),
};

export const OnLargerScreens: Story = {
  name: 'On larger screens',
  parameters: {
    docs: {
      description: {
        story:
          'At a desk the items keep their icons and the menu opens beside the button that asked for it. Under a finger the icons sit before each centred label.',
      },
    },
  },
  render: () => (
    <ActionSheet>
      <ActionSheetTrigger asChild>
        <Button startIcon={<Ellipsis aria-hidden="true" />} aria-label="More actions" />
      </ActionSheetTrigger>
      <ActionSheetContent label="More actions">
        <ActionSheetItem icon={<Pencil aria-hidden="true" />}>Edit request</ActionSheetItem>
        <ActionSheetItem icon={<Copy aria-hidden="true" />}>Duplicate</ActionSheetItem>
        <ActionSheetItem icon={<Trash2 aria-hidden="true" />} destructive>
          Delete request
        </ActionSheetItem>
      </ActionSheetContent>
    </ActionSheet>
  ),
};
