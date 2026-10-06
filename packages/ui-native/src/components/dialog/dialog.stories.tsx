import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { ChevronsUpDown, Trash2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';

import { overlayDocs } from '../../docs/design.ts';
import { Stage, StandInCheck, StandInField, StandInProgress, settled } from '../../docs/stage.tsx';
import { Badge } from '../badge/badge.tsx';
import { Button } from '../button/button.tsx';
import { Icon } from '../icon/icon.tsx';
import { Inline, Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogIcon,
  DialogTitle,
  DialogTrigger,
} from './dialog.tsx';

const meta = {
  title: 'Components/Dialog',
  component: DialogContent,
  parameters: overlayDocs('dialog'),
  // axe runs after this, on the open dialog, not on its fade in.
  play: settled,
} satisfies Meta<typeof DialogContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => (
    <Dialog defaultOpen>
      <Stage
        trigger={
          <DialogTrigger asChild>
            <Button size="sm">Edit working hours</Button>
          </DialogTrigger>
        }
      >
        {(host) => (
          <DialogContent portalHost={host}>
            <DialogHeader>
              <DialogTitle>Edit working hours</DialogTitle>
              <DialogDescription>Changes apply from next week.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button>Cancel</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button variant="primary">Save</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        )}
      </Stage>
    </Dialog>
  ),
};

export const WithAForm: Story = {
  name: 'With a form',
  render: () => (
    <Dialog defaultOpen>
      <Stage
        height={560}
        trigger={
          <DialogTrigger asChild>
            <Button size="sm">Invite a person</Button>
          </DialogTrigger>
        }
      >
        {(host) => (
          <DialogContent portalHost={host}>
            <DialogHeader>
              <DialogTitle>Invite a person</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <StandInField label="Email" value="yuki@reach.co" />
              <StandInField
                label="Team"
                value="Engineering"
                end={<Icon icon={ChevronsUpDown} size={19} tone="muted" />}
              />
              <StandInCheck label="Send a welcome email" defaultChecked />
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button>Cancel</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button variant="primary">Send invite</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        )}
      </Stage>
    </Dialog>
  ),
};

export const Destructive: Story = {
  render: () => (
    <Dialog defaultOpen>
      <Stage
        trigger={
          <DialogTrigger asChild>
            <Button size="sm" variant="danger-soft">
              Delete documents
            </Button>
          </DialogTrigger>
        }
      >
        {(host) => (
          <DialogContent portalHost={host}>
            <DialogIcon icon={Trash2} tone="danger" />
            <DialogHeader>
              <DialogTitle>Delete 3 documents?</DialogTitle>
              <DialogDescription>They’ll be gone for everyone.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button>Cancel</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button variant="danger">Delete</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        )}
      </Stage>
    </Dialog>
  ),
};

/** How long the pretend save takes before the parent closes the dialog. */
const SAVE_MS = 2500;

export const Controlled: Story = {
  render: function ControlledStory() {
    const [open, setOpen] = useState(true);
    useEffect(() => {
      if (!open) return undefined;
      const timer = setTimeout(() => {
        setOpen(false);
      }, SAVE_MS);
      return () => {
        clearTimeout(timer);
      };
    }, [open]);
    return (
      <Stack className="gap-2.5">
        <Inline gap={2}>
          <Button
            onPress={() => {
              setOpen(true);
            }}
          >
            Open dialog
          </Button>
          <Badge tone="accent" className="self-center">{`open = ${String(open)}`}</Badge>
        </Inline>
        <Text variant="subhead" tone="muted" className="leading-[1.5]">
          The parent owns the open state, so it can close the dialog after an async save finishes.
        </Text>
        <Dialog open={open} onOpenChange={setOpen}>
          <Stage height={220}>
            {(host) => (
              <DialogContent portalHost={host} width={300}>
                <DialogHeader>
                  <DialogTitle>Saving…</DialogTitle>
                </DialogHeader>
                <StandInProgress label="Saving" />
              </DialogContent>
            )}
          </Stage>
        </Dialog>
      </Stack>
    );
  },
};
