import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Check, X } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/alert-dialog/alert-dialog.tsx';
import { AppBar, LargeTitle } from '../components/app-bar/app-bar.tsx';
import { Avatar } from '../components/avatar/avatar.tsx';
import { Button } from '../components/button/button.tsx';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '../components/dialog/dialog.tsx';
import { Dropzone } from '../components/dropzone/dropzone.tsx';
import { Skeleton } from '../components/feedback/feedback.tsx';
import { Field, FieldLabel } from '../components/field/field.tsx';
import { Icon } from '../components/icon/icon.tsx';
import { Input } from '../components/input/input.tsx';
import { List, ListItem } from '../components/list-item/list-item.tsx';
import { Progress } from '../components/progress/progress.tsx';
import { Text } from '../components/text/text.tsx';
import { OverlayHost } from '../lib/overlay-host.tsx';
import { overlayDocs } from '../docs/design.ts';
import { pickOf, sampleDocument } from '../docs/files.ts';
import { Screen, ScreenBody, ScreenNote } from '../docs/screen.tsx';
import { settled } from '../docs/stage.tsx';

/*
 * A task that takes the whole screen until it is done or cancelled: a
 * `Dialog` at `size="full"`, with an `AppBar` at its top whose close control
 * runs the same guard as Escape, back and the edge swipe. On a phone every
 * modal page is full screen.
 */

const meta = {
  title: 'Layouts/Modal page',
  component: DialogContent,
  parameters: overlayDocs('modal-page'),
  // axe runs after this, on the open page, not on its motion in.
  play: settled,
} satisfies Meta<typeof DialogContent>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The close control at the start of a modal page's bar. */
function CloseButton({ onPress }: { onPress?: () => void }): React.JSX.Element {
  const button = (
    <Button
      size="xs"
      variant="secondary"
      startIcon={<Icon icon={X} />}
      accessibilityLabel="Close"
      {...(onPress ? { onPress } : {})}
    />
  );
  return onPress ? button : <DialogClose asChild>{button}</DialogClose>;
}

/**
 * A screen with the modal page open over it. The screen's first line is the
 * trigger that reopens it.
 */
function ModalScreen({
  opener,
  height = 560,
  open,
  onOpenChange,
  children,
}: {
  opener: string;
  height?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: (host: string) => ReactNode;
}): React.JSX.Element {
  return (
    <Dialog
      {...(open === undefined ? { defaultOpen: true } : { open })}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      <Screen height={height}>
        {(host) => (
          <>
            <LargeTitle className="pt-4">People</LargeTitle>
            <ScreenBody>
              <DialogTrigger asChild>
                <Button size="sm" variant="primary">
                  {opener}
                </Button>
              </DialogTrigger>
            </ScreenBody>
            {children(host)}
          </>
        )}
      </Screen>
    </Dialog>
  );
}

export const Playground: Story = {
  render: () => (
    <ModalScreen opener="Import people">
      {(host) => (
        <DialogContent size="full" label="Import people" portalHost={host}>
          <AppBar title="Import people" leading={<CloseButton />} />
          <ScreenBody className="pt-1">
            <Dropzone
              pick={pickOf(sampleDocument('people.csv', 'text/csv', 48_000))}
              onFiles={() => undefined}
              label="Choose files"
            />
            <Button variant="primary" fullWidth disabled>
              Continue
            </Button>
          </ScreenBody>
        </DialogContent>
      )}
    </ModalScreen>
  ),
};

export const TheThreeSizes: Story = {
  name: 'The three sizes',
  render: () => (
    <>
      <ScreenNote>
        On a phone every modal page is full screen. Size only matters from 640 up.
      </ScreenNote>
      <ModalScreen opener="Open" height={300}>
        {(host) => (
          <DialogContent size="full" label="Full screen" portalHost={host}>
            <AppBar title="Full screen" leading={<CloseButton />} />
            <ScreenBody className="pt-1">
              <Skeleton className="h-[140px] rounded-[16px]" />
            </ScreenBody>
          </DialogContent>
        )}
      </ModalScreen>
    </>
  ),
};

const APPROVERS = ['Jonas Weber', 'Nora Becker'] as const;

function SteppedFlow(): React.JSX.Element {
  const [step, setStep] = useState(2);
  const [approver, setApprover] = useState<string>(APPROVERS[0]);
  const title = `Step ${String(step)} of 3`;
  return (
    <ModalScreen opener="New request">
      {(host) => (
        <DialogContent size="full" label={title} portalHost={host}>
          <AppBar title={title} leading={<CloseButton />} />
          <ScreenBody className="gap-3.5 pt-1">
            <Progress value={(step / 3) * 100} label={title} hideLabel />
            {step < 3 ? (
              <>
                <Text variant="title2" weight="bold" accessibilityRole="header">
                  Who approves it?
                </Text>
                <List>
                  {APPROVERS.map((name) => {
                    const on = name === approver;
                    return (
                      <ListItem
                        key={name}
                        leading={<Avatar name={name} size={32} decorative />}
                        selected={on}
                        trailing={on ? <Icon icon={Check} size={20} tone="accent" /> : undefined}
                        onPress={() => {
                          setApprover(name);
                        }}
                      >
                        {name}
                      </ListItem>
                    );
                  })}
                </List>
                <Button
                  variant="primary"
                  fullWidth
                  onPress={() => {
                    setStep(3);
                  }}
                >
                  Next
                </Button>
              </>
            ) : (
              <>
                <Text variant="title2" weight="bold" accessibilityRole="header">
                  Ready to send
                </Text>
                <ScreenNote>{`${approver} approves it.`}</ScreenNote>
                <Button
                  fullWidth
                  onPress={() => {
                    setStep(2);
                  }}
                >
                  Back
                </Button>
                <DialogClose asChild>
                  <Button variant="primary" fullWidth>
                    Send request
                  </Button>
                </DialogClose>
              </>
            )}
          </ScreenBody>
        </DialogContent>
      )}
    </ModalScreen>
  );
}

export const ASteppedFlow: Story = {
  name: 'A stepped flow',
  render: () => <SteppedFlow />,
};

const FIELDS = [
  { key: 'title', label: 'Job title' },
  { key: 'team', label: 'Team' },
  { key: 'location', label: 'Location' },
] as const;
type Fields = Record<(typeof FIELDS)[number]['key'], string>;
const SAVED: Fields = { title: 'Senior Engineer', team: 'Engineering', location: 'Berlin' };
const EDITED: Fields = { title: 'Staff Engineer', team: 'Platform', location: 'Remote' };

function Guarded(): React.JSX.Element {
  const [open, setOpen] = useState(true);
  // Three fields edited from what was saved.
  const [fields, setFields] = useState(EDITED);
  const edited = FIELDS.filter((f) => fields[f.key] !== SAVED[f.key]).length;
  const dirty = edited > 0;
  // Opened on the question, as the design draws it.
  const [asking, setAsking] = useState(true);
  const guard = (): boolean => {
    if (dirty) setAsking(true);
    return dirty;
  };
  return (
    <ModalScreen opener="Edit Priya Shah" open={open} onOpenChange={setOpen} height={420}>
      {(host) => (
        <DialogContent size="full" label="Edit Priya Shah" portalHost={host} guard={guard}>
          <AppBar
            title="Edit Priya Shah"
            leading={
              <CloseButton
                onPress={() => {
                  if (!guard()) setOpen(false);
                }}
              />
            }
          />
          <ScreenBody className="pt-1">
            {FIELDS.map((f) => (
              <Field key={f.key}>
                <FieldLabel>{f.label}</FieldLabel>
                <Input
                  value={fields[f.key]}
                  onChange={(value) => {
                    setFields({ ...fields, [f.key]: value });
                  }}
                />
              </Field>
            ))}
          </ScreenBody>
          {/* Inside the page, in a host of its own, so it stacks on the page. */}
          <OverlayHost name={`${host}-page`} />
          <AlertDialog open={asking} onOpenChange={setAsking}>
            <AlertDialogContent portalHost={`${host}-page`}>
              <AlertDialogHeader>
                <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
                <AlertDialogDescription>
                  {`You’ve edited ${String(edited)} ${edited === 1 ? 'field' : 'fields'}. If you leave now, those changes are lost.`}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel asChild>
                  <Button>Keep editing</Button>
                </AlertDialogCancel>
                <AlertDialogAction asChild>
                  <Button
                    variant="danger"
                    onPress={() => {
                      setFields(SAVED);
                      setOpen(false);
                    }}
                  >
                    Discard
                  </Button>
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </DialogContent>
      )}
    </ModalScreen>
  );
}

export const GuardingUnsavedWork: Story = {
  name: 'Guarding unsaved work',
  render: () => <Guarded />,
};
