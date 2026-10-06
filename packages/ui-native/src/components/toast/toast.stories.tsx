import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { View } from 'react-native-css/components';

import { designDocs, designNote } from '../../docs/design.ts';
import { settled, Stage } from '../../docs/stage.tsx';
import { Button } from '../button/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../dialog/dialog.tsx';
import { Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import { Toast, ToastProvider, useToast } from './toast.tsx';

const meta = {
  title: 'Components/Toast',
  component: Toast,
  parameters: designDocs('toast'),
  args: { title: 'Request sent to Jonas' },
} satisfies Meta<typeof Toast>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = (): void => undefined;

export const Playground: Story = {};

export const Tones: Story = {
  render: () => (
    <Stack gap={2}>
      <Toast tone="success" title="Saved" />
      <Toast tone="info" title="Sync in progress" />
      <Toast tone="warning" title="You’re offline" />
      <Toast tone="danger" title="Couldn’t save" />
      <Toast tone="neutral" title="Link copied" />
    </Stack>
  ),
};

export const WithAnUndo: Story = {
  name: 'With an undo',
  render: () => (
    <Toast title="3 people archived" action={{ label: 'Undo', onPress: noop }}>
      They’re hidden from the directory.
    </Toast>
  ),
};

export const AFailureWithARetry: Story = {
  name: 'A failure with a retry',
  render: () => (
    <Toast tone="danger" title="Couldn’t send payslips" action={{ label: 'Retry', onPress: noop }}>
      The connection dropped at 226 of 312.
    </Toast>
  ),
};

export const WhenItShouldNotBeAToast: Story = {
  name: 'When it should not be a toast',
  parameters: designNote('toast', 'When it should not be a toast'),
  // Checked once the dialog has arrived: mid-fade its text is faint on purpose.
  play: settled,
  render: () => (
    <Stack gap={2} className="gap-2.5">
      <Text variant="footnote" weight="semibold" tone="muted">
        Wrong
      </Text>
      <View className="w-[280px]">
        <Toast tone="danger" title="Your session expires in 1 minute" />
      </View>
      <Text variant="footnote" weight="semibold" tone="muted">
        Right
      </Text>
      <Dialog defaultOpen>
        <Stage height={260}>
          {(host) => (
            <DialogContent portalHost={host} className="max-w-[280px] self-center">
              <DialogHeader>
                <DialogTitle>Still there?</DialogTitle>
                <DialogDescription>You’ll be signed out in 1 minute.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="primary" size="sm">
                  Stay signed in
                </Button>
              </DialogFooter>
            </DialogContent>
          )}
        </Stage>
      </Dialog>
    </Stack>
  ),
};

function Trigger(): React.JSX.Element {
  const toast = useToast();
  return (
    <Stack gap={2} align="start">
      <Button
        variant="primary"
        onPress={() => {
          toast.show({ title: 'Request sent to Jonas' });
        }}
      >
        Send request
      </Button>
      <Button
        onPress={() => {
          toast.show({
            title: '3 people archived',
            children: 'They’re hidden from the directory.',
            action: { label: 'Undo', onPress: noop },
          });
        }}
      >
        Archive 3 people
      </Button>
    </Stack>
  );
}

/** Not in the design: a toast shown from an action, where the platform puts it. */
export const FromAnAction: Story = {
  name: 'From an action',
  render: () => (
    <View className="h-[420px] overflow-hidden rounded-[24px] border border-border bg-canvas p-4">
      <ToastProvider>
        <Trigger />
      </ToastProvider>
    </View>
  ),
};
