import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { KeyValues } from '../key-values/key-values.tsx';
import { useState } from 'react';
import { View } from 'react-native-css/components';

import { designNote, overlayDocs } from '../../docs/design.ts';
import { Stage, StandInField, settled } from '../../docs/stage.tsx';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../alert-dialog/alert-dialog.tsx';
import { Avatar } from '../avatar/avatar.tsx';
import { Button } from '../button/button.tsx';
import { Text } from '../text/text.tsx';
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './sheet.tsx';

const meta = {
  title: 'Components/Sheet',
  component: SheetContent,
  parameters: overlayDocs('sheet'),
  // axe runs after this, on the open sheet, not on its slide in.
  play: settled,
} satisfies Meta<typeof SheetContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => (
    <Sheet defaultOpen>
      <Stage
        trigger={
          <SheetTrigger asChild>
            <Button size="sm">Open Priya Shah</Button>
          </SheetTrigger>
        }
      >
        {(host) => (
          <SheetContent portalHost={host}>
            <SheetHeader>
              <SheetTitle>Priya Shah</SheetTitle>
            </SheetHeader>
            <KeyValues
              items={[
                { label: 'Team', value: 'Engineering' },
                { label: 'Manager', value: 'Jonas Weber' },
                { label: 'Location', value: 'Berlin' },
              ]}
            />
          </SheetContent>
        )}
      </Stage>
    </Sheet>
  ),
};

export const Sides: Story = {
  name: 'Every side',
  render: () => (
    <View className="gap-2.5">
      <Sheet defaultOpen>
        <Stage
          height={300}
          trigger={
            <SheetTrigger asChild>
              <Button size="sm">From the bottom</Button>
            </SheetTrigger>
          }
        >
          {(host) => (
            <SheetContent portalHost={host} label="Bottom sheet">
              <Text variant="subhead" tone="muted">
                Bottom · default on phones
              </Text>
            </SheetContent>
          )}
        </Stage>
      </Sheet>
      <Sheet defaultOpen>
        <Stage
          height={220}
          trigger={
            <SheetTrigger asChild>
              <Button size="sm">From the top</Button>
            </SheetTrigger>
          }
        >
          {(host) => (
            <SheetContent portalHost={host} side="top" label="Top sheet">
              <Text variant="subhead" tone="muted">
                Top · rare, for search
              </Text>
            </SheetContent>
          )}
        </Stage>
      </Sheet>
    </View>
  ),
};

export const RecordDetail: Story = {
  name: 'A record opened from a queue',
  render: () => (
    <Sheet defaultOpen>
      <Stage
        height={540}
        trigger={
          <SheetTrigger asChild>
            <Button size="sm">Open request</Button>
          </SheetTrigger>
        }
      >
        {(host) => (
          <SheetContent portalHost={host} label="Amara Okafor’s request">
            <View className="flex-row items-center gap-3">
              <Avatar name="Amara Okafor" size={44} />
              <View className="gap-0.5">
                <Text weight="bold">Amara Okafor</Text>
                <Text variant="subhead" tone="muted">
                  Vacation · 5 days
                </Text>
              </View>
            </View>
            <KeyValues
              items={[
                { label: 'Dates', value: '14–18 Oct' },
                { label: 'Balance after', value: '9.5 days' },
              ]}
            />
            <SheetFooter>
              <SheetClose asChild>
                <Button>Decline</Button>
              </SheetClose>
              <SheetClose asChild>
                <Button variant="primary">Approve</Button>
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        )}
      </Stage>
    </Sheet>
  ),
};

export const SwipeToDismiss: Story = {
  name: 'Swipe to dismiss',
  parameters: designNote('sheet', 'Swipe to dismiss'),
  render: () => (
    <Sheet defaultOpen>
      <Stage
        height={420}
        trigger={
          <SheetTrigger asChild>
            <Button size="sm">Choose a leave type</Button>
          </SheetTrigger>
        }
      >
        {(host) => (
          <SheetContent portalHost={host}>
            <SheetHeader showCloseButton={false}>
              <SheetTitle className="text-[18px]">Leave type</SheetTitle>
            </SheetHeader>
            <Text variant="subhead" tone="muted" className="leading-[1.5]">
              Drag it down. Past half its height, or on a fast flick, it closes.
            </Text>
          </SheetContent>
        )}
      </Stage>
    </Sheet>
  ),
};

export const UnsavedChanges: Story = {
  name: 'Guarding unsaved changes',
  render: function UnsavedChangesStory() {
    const [open, setOpen] = useState(true);
    const [title, setTitle] = useState('Staff Engineer');
    const [asking, setAsking] = useState(true);
    const dirty = title !== 'Senior Engineer';
    return (
      <Sheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setTitle('Senior Engineer');
        }}
      >
        <Stage
          trigger={
            <SheetTrigger asChild>
              <Button size="sm">Edit profile</Button>
            </SheetTrigger>
          }
        >
          {(host) => (
            <>
              <SheetContent
                portalHost={host}
                guard={() => {
                  if (dirty) setAsking(true);
                  return dirty;
                }}
              >
                <SheetHeader>
                  <SheetTitle>Edit profile</SheetTitle>
                </SheetHeader>
                <SheetBody>
                  <StandInField label="Job title" value={title} onChangeText={setTitle} focused />
                </SheetBody>
              </SheetContent>
              <AlertDialog open={asking} onOpenChange={setAsking}>
                <AlertDialogContent portalHost={host} width={300}>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Discard changes?</AlertDialogTitle>
                    <AlertDialogDescription>You changed the job title.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel asChild>
                      <Button>Keep editing</Button>
                    </AlertDialogCancel>
                    <AlertDialogAction asChild>
                      <Button
                        variant="danger"
                        onPress={() => {
                          setTitle('Senior Engineer');
                          setOpen(false);
                        }}
                      >
                        Discard
                      </Button>
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </Stage>
      </Sheet>
    );
  },
};
