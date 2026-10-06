import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Link } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native-css/components';
import { userEvent } from 'storybook/test';

import { designDocs, designNote } from '../../docs/design.ts';
import { settled } from '../../docs/stage.tsx';
import { PEOPLE } from '../../docs/people.ts';
import { Avatar } from '../avatar/avatar.tsx';
import { Card } from '../card/card.tsx';
import { Alert } from '../feedback/feedback.tsx';
import { Inline, Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import { Tooltip } from '../tooltip/tooltip.tsx';
import { CopyButton, CopyField } from './clipboard.tsx';

const meta = {
  title: 'Components/Clipboard',
  component: CopyButton,
  parameters: designDocs('clipboard'),
  args: { value: 'https://reach.co/invite/7Kx2' },
} satisfies Meta<typeof CopyButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/*
 * A story that shows the confirmation presses the button marked `testID="press"`
 * once it renders, with a write that always succeeds and a confirmation that
 * outlasts the screenshot. Everything else is the real component.
 */
const SUCCEED = async (): Promise<void> => {};
const LINGER = 60_000;
type Target = Parameters<typeof userEvent.click>[0];
// This package's types have no DOM: the play function runs in the browser, so say what it uses.
type Root = { querySelectorAll: (selector: string) => Iterable<Target & { blur: () => void }> };
const pressMarked: Story['play'] = async ({ canvasElement }) => {
  const root = canvasElement as unknown as Root;
  for (const el of root.querySelectorAll('[data-testid="press"] [role="button"]')) {
    // oxlint-disable-next-line no-await-in-loop -- one press at a time, in order
    await userEvent.click(el);
    // The press leaves focus behind; the confirmation is the state to show, not the ring.
    el.blur();
  }
  // "Icon only" opens a tooltip as it renders; axe reads it once it has faded in.
  await settled();
};

export const Playground: Story = {
  render: (args) => (
    <Inline gap={2}>
      <CopyButton {...args} variant="secondary" size="md" icon={Link}>
        Copy link
      </CopyButton>
      <View testID="press">
        <CopyButton
          {...args}
          variant="secondary"
          size="md"
          icon={Link}
          write={SUCCEED}
          resetAfter={LINGER}
        >
          Copy link
        </CopyButton>
      </View>
    </Inline>
  ),
  play: pressMarked,
};

export const IconOnly: Story = {
  name: 'Icon only',
  render: (args) => (
    <Inline gap={2} className="min-h-24 items-start">
      {/* An icon-only button names itself in a tooltip; a long press opens it on a phone. */}
      <Tooltip content="Copy invite link" side="bottom" defaultOpen>
        <CopyButton {...args} label="Copy invite link" />
      </Tooltip>
      <View testID="press">
        <CopyButton {...args} label="Copy invite link" write={SUCCEED} resetAfter={LINGER} />
      </View>
    </Inline>
  ),
  play: pressMarked,
};

export const CopyFieldStory: Story = {
  name: 'CopyField',
  render: () => (
    <Stack gap={3}>
      <CopyField label="Employee ID" value="RCH-00412" mono />
      <View testID="press">
        <CopyField
          label="Invite link"
          value="https://reach.co/invite/7Kx2"
          write={SUCCEED}
          resetAfter={LINGER}
        />
      </View>
    </Stack>
  ),
  play: pressMarked,
};

export const InATable: Story = {
  name: 'In a table',
  // A table on a phone is a list of records: the person, then the column under them.
  render: () => (
    <Card padded={false} className="overflow-hidden">
      {PEOPLE.slice(0, 3).map((person, i) => {
        const id = `RCH-0041${String(i + 2)}`;
        return (
          <View key={person.name} className="gap-2 border-b border-border px-4 py-3.5">
            <View className="flex-row items-center gap-3">
              <Avatar name={person.name} size={40} />
              <View className="min-w-0 flex-1">
                <Text weight="semibold" numberOfLines={1} className="text-[16px] leading-[1.3]">
                  {person.name}
                </Text>
                <Text tone="muted" numberOfLines={1} className="text-[14px] leading-[1.3]">
                  {person.role}
                </Text>
              </View>
            </View>
            <View
              className="flex-row items-center gap-1.5"
              {...(i === 1 ? { testID: 'press' } : {})}
            >
              <Text tone="muted" weight="medium" mono className="text-[13px] leading-none">
                {id}
              </Text>
              <CopyButton
                value={id}
                size="xs"
                label={`Copy ${person.name}’s employee ID`}
                {...(i === 1 ? { write: SUCCEED, resetAfter: LINGER } : {})}
              />
            </View>
          </View>
        );
      })}
    </Card>
  ),
  play: pressMarked,
};

const SNIPPET = `const { copy, copied } = useClipboard({ timeout: 1600 });
<Button onClick={() => copy(id)}>
  {copied ? 'Copied' : 'Copy ID'}
</Button>`;

export const UseClipboard: Story = {
  name: 'useClipboard',
  render: () => (
    <View className="rounded-[14px] bg-surface-sunken p-3.5">
      <Text mono tone="muted" className="text-[12px] leading-[1.7]">
        {SNIPPET}
      </Text>
    </View>
  ),
};

export const WhenItIsRefused: Story = {
  name: 'When it is refused',
  parameters: designNote('clipboard', 'When it is refused'),
  render: function Refused() {
    const [refused, setRefused] = useState(true);
    return (
      <Stack gap={2} className="gap-2.5">
        <CopyField
          label="Employee ID"
          value="RCH-00412"
          mono
          write={() => Promise.reject(new Error('Blocked'))}
          onCopy={() => {
            setRefused(false);
          }}
          onError={() => {
            setRefused(true);
          }}
        />
        {refused ? (
          <Alert tone="warning" title="Couldn’t copy">
            Your browser blocked the clipboard. Select the text and press ⌘C instead.
          </Alert>
        ) : null}
      </Stack>
    );
  },
};
