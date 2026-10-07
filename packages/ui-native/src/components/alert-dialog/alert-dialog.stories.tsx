import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Check, UserX } from 'lucide-react-native';
import { useRef, useState } from 'react';
import type { TextInput } from 'react-native';
import { View } from 'react-native-css/components';

import { designNote, overlayDocs } from '../../docs/design.ts';
import { Stage, settled } from '../../docs/stage.tsx';
import { Button } from '../button/button.tsx';
import { Icon } from '../icon/icon.tsx';
import { Input } from '../input/input.tsx';
import { Text } from '../text/text.tsx';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogIcon,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './alert-dialog.tsx';
import { DialogFooter, dialogTitleClass } from '../dialog/dialog.tsx';

const meta = {
  title: 'Components/AlertDialog',
  component: AlertDialogContent,
  parameters: overlayDocs('alert-dialog'),
  // axe runs after this, on the open dialog, not on its fade in.
  play: settled,
} satisfies Meta<typeof AlertDialogContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => (
    <AlertDialog defaultOpen>
      <Stage
        trigger={
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="danger-soft">
              Delete draft
            </Button>
          </AlertDialogTrigger>
        }
      >
        {(host) => (
          <AlertDialogContent portalHost={host}>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
              <AlertDialogDescription>Your dates and note will be lost.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel asChild>
                <Button>Cancel</Button>
              </AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button variant="danger">Delete</Button>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </Stage>
    </AlertDialog>
  ),
};

const CONSEQUENCES = [
  'His access ends on 31 Oct at 18:00',
  '3 direct reports move to Tom Fischer',
  'His final payslip includes 4.5 unused days',
];

export const ConsequencesSpelledOut: Story = {
  name: 'Consequences spelled out',
  render: () => (
    <AlertDialog defaultOpen>
      <Stage
        height={560}
        trigger={
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="danger-soft">
              Offboard
            </Button>
          </AlertDialogTrigger>
        }
      >
        {(host) => (
          <AlertDialogContent portalHost={host}>
            <AlertDialogIcon icon={UserX} tone="danger" />
            <AlertDialogHeader>
              <AlertDialogTitle>Offboard Diego Alvarez?</AlertDialogTitle>
            </AlertDialogHeader>
            {/* The list is the description, so a screen reader reads it with the title. */}
            <AlertDialogDescription asChild className="-mt-1.5">
              <View>
                {CONSEQUENCES.map((line) => (
                  <View key={line} className="flex-row">
                    <Text variant="subhead" tone="muted" className="w-[18px] leading-[1.55]">
                      •
                    </Text>
                    <Text variant="subhead" tone="muted" className="flex-1 leading-[1.55]">
                      {line}
                    </Text>
                  </View>
                ))}
              </View>
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel asChild>
                <Button>Cancel</Button>
              </AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button variant="danger">Offboard</Button>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </Stage>
    </AlertDialog>
  ),
};

export const TypeToConfirm: Story = {
  name: 'Type to confirm',
  parameters: {
    docs: {
      description: {
        story:
          'For the few actions that are catastrophic rather than merely irreversible. The friction turns a reflex into a decision; on anything less it is theatre.',
      },
    },
  },
  render: function TypeToConfirmStory() {
    const [typed, setTyped] = useState('Desi');
    const field = useRef<TextInput>(null);
    return (
      <AlertDialog
        defaultOpen
        onOpenChange={(open) => {
          if (!open) setTyped('');
        }}
      >
        <Stage
          height={540}
          trigger={
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="danger-soft">
                Delete team
              </Button>
            </AlertDialogTrigger>
          }
        >
          {(host) => (
            <AlertDialogContent portalHost={host} initialFocus={field}>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete the Design team?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes 28 people from the team and deletes its 14 documents. Type{' '}
                  <Text variant="subhead" weight="bold">
                    Design
                  </Text>{' '}
                  to confirm.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Input
                ref={field}
                value={typed}
                onChangeText={setTyped}
                autoCapitalize="words"
                accessibilityLabel="Type Design to confirm"
              />
              <AlertDialogFooter>
                <AlertDialogCancel asChild>
                  <Button>Cancel</Button>
                </AlertDialogCancel>
                <AlertDialogAction asChild>
                  <Button variant="danger" disabled={typed !== 'Design'}>
                    Delete team
                  </Button>
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          )}
        </Stage>
      </AlertDialog>
    );
  },
};

export const WhenAnUndoIsBetter: Story = {
  name: 'When an undo is better',
  parameters: designNote('alert-dialog', 'When an undo is better'),
  render: function UndoStory() {
    const [archived, setArchived] = useState(true);
    return (
      <View className="gap-4">
        {/*
          The dialog this replaces, faded: a picture of what not to do, so it
          is hidden from assistive technology and inert on the web.
        */}
        <View
          aria-hidden
          pointerEvents="none"
          ref={(node: unknown) => {
            // The DOM's `inert`; a story renders on the web only.
            if (typeof node === 'object' && node !== null && 'inert' in node) {
              (node as { inert: boolean }).inert = true;
            }
          }}
          className="w-[280px] gap-3.5 rounded-[30px] bg-surface-raised p-[22px] opacity-55 shadow-xl"
        >
          <Text className={dialogTitleClass}>Archive this note?</Text>
          <DialogFooter>
            <Button size="sm">Cancel</Button>
            <Button size="sm" variant="primary">
              Archive
            </Button>
          </DialogFooter>
        </View>
        {archived ? (
          <View
            accessibilityRole="alert"
            className="w-[300px] flex-row items-center gap-3 rounded-[20px] bg-invert py-3 pr-2 pl-3.5 shadow-lg"
          >
            <View className="size-6 items-center justify-center rounded-full bg-success">
              <Icon icon={Check} size={14} tone="on-accent" />
            </View>
            <Text variant="subhead" tone="on-invert" weight="semibold" className="flex-1">
              Note archived
            </Text>
            <Button
              size="xs"
              variant="invert"
              onPress={() => {
                setArchived(false);
              }}
            >
              Undo
            </Button>
          </View>
        ) : (
          <Button
            className="self-start"
            onPress={() => {
              setArchived(true);
            }}
          >
            Archive note
          </Button>
        )}
      </View>
    );
  },
};
