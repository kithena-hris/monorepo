import type { Meta, StoryObj } from '@storybook/react-vite';
import { Minus, Paperclip, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Avatar } from '../avatar/avatar';
import { Button } from '../button/button';
import { Card } from '../card/card';
import { Chat, ChatComposer, ChatMessage, ChatTyping } from './chat';

const meta = {
  title: 'Components/Chat',
  component: Chat,
  subcomponents: { ChatMessage, ChatTyping, ChatComposer },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Direct messages about a request or a person. Your messages sit on the trailing side in the accent.',
          '',
          '- `Chat` is `role="log"`, the ARIA pattern for a thread: new messages are read out politely as they arrive, and nothing already read is announced again.',
          '- `ChatMessage` with `from="me"` sits on the trailing side; everyone else sits on the leading side with their avatar. The speaker is in the text, visually hidden, so the side a bubble sits on is never the only way to know who said it.',
          '- `continued` drops the avatar for the first of several messages in a row from one person, and keeps its space so the bubbles stay aligned.',
          '- `ChatTyping` shows three dots and announces who is writing.',
          '- `ChatComposer`: Enter sends, Shift+Enter starts a new line, and an Enter that ends an input-method composition is ignored. The send button stays disabled until there is something to send.',
          '- `ChatDivider` marks a day in a long thread.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    'aria-label': {
      description: 'Names the log: "Conversation with Jonas Weber".',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Accessibility' },
    },
  },
  args: { 'aria-label': 'Conversation with Jonas Weber' },
} satisfies Meta<typeof Chat>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The frame the stories share: a card with an optional header and composer. */
function ChatWindow({
  header = false,
  footer,
  floating = false,
  children,
}: {
  header?: boolean;
  footer?: ReactNode;
  floating?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Card
      variant={floating ? 'elevated' : 'raised'}
      className="flex w-full max-w-sm flex-col overflow-hidden"
    >
      {header ? (
        <div className="flex items-center gap-2.5 border-b border-border py-2 ps-3.5 pe-2">
          <Avatar name="Jonas Weber" status="success" statusLabel="Online" />
          <div className="min-w-0 flex-1">
            <p className="text-[0.875rem] leading-tight font-semibold">Jonas Weber</p>
            <p className="text-xs leading-tight text-success-fg">Online</p>
          </div>
          <Button variant="ghost" size="xs" aria-label="Minimise" startIcon={<Minus />} />
          <Button variant="ghost" size="xs" aria-label="Close" startIcon={<X />} />
        </div>
      ) : null}
      <div className="p-3.5">{children}</div>
      {footer ? <div className="border-t border-border p-2.5">{footer}</div> : null}
    </Card>
  );
}

export const Conversation: Story = {
  render: (args) => (
    <ChatWindow>
      <Chat {...args}>
        <ChatMessage author="Jonas Weber" meta="Jonas · 09:12">
          Can you cover Amara’s reviews next week?
        </ChatMessage>
        <ChatMessage from="me" meta="09:14 · Read">
          Yes, happy to. Which ones?
        </ChatMessage>
        <ChatMessage author="Jonas Weber" meta="09:15">
          The payroll redesign and the onboarding flow.
        </ChatMessage>
      </Chat>
    </ChatWindow>
  ),
};

export const Writing: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'While Jonas writes, the dots pulse (only when motion is allowed) and a screen reader hears "Jonas Weber is typing". Type in the composer and press Enter to send.',
      },
    },
  },
  render: function Render(args) {
    const [sent, setSent] = useState<string[]>([]);
    return (
      <ChatWindow
        footer={
          <ChatComposer
            label="Message Jonas"
            placeholder="Message Jonas"
            onSend={(text) => {
              setSent((current) => [...current, text]);
            }}
            tools={
              <Button
                variant="ghost"
                size="sm"
                aria-label="Attach a file"
                startIcon={<Paperclip />}
              />
            }
          />
        }
      >
        <Chat {...args}>
          <ChatMessage author="Jonas Weber" meta="09:12">
            Can you cover Amara’s reviews next week?
          </ChatMessage>
          {sent.map((text, index) => (
            <ChatMessage key={index} from="me" meta="Just now">
              {text}
            </ChatMessage>
          ))}
          <ChatTyping author="Jonas Weber" />
        </Chat>
      </ChatWindow>
    );
  },
};

export const FromYou: Story = {
  name: 'From You',
  parameters: {
    docs: {
      description: {
        story:
          'Delivery shows under your last message. A message that has not gone drops to the accent wash rather than fading, so it stays readable, and `meta` says what to do about it.',
      },
    },
  },
  render: (args) => (
    <ChatWindow>
      <Chat {...args} className="gap-2">
        <ChatMessage from="me">I’ve booked 14–18 Oct.</ChatMessage>
        <ChatMessage author="Jonas Weber">Approved it just now</ChatMessage>
        <ChatMessage from="me" meta="Delivered">
          Thanks!
        </ChatMessage>
        <ChatMessage from="me" pending meta="Not sent · Tap to retry">
          Sending…
        </ChatMessage>
      </Chat>
    </ChatWindow>
  ),
};

export const InAWindow: Story = {
  name: 'In A Window',
  parameters: {
    docs: {
      description: {
        story:
          'At a desk the conversation floats over the page in the corner, lifted with `elevated`. On a phone the same window fills the width.',
      },
    },
  },
  render: (args) => (
    <div className="flex justify-end">
      <ChatWindow
        header
        floating
        footer={
          <ChatComposer
            label="Message Jonas"
            placeholder="Message Jonas"
            onSend={() => undefined}
          />
        }
      >
        <Chat {...args}>
          <ChatMessage author="Nora Becker">Welcome to Reach, Lucas!</ChatMessage>
          <ChatMessage from="me">Thanks Nora!</ChatMessage>
        </Chat>
      </ChatWindow>
    </div>
  ),
};
