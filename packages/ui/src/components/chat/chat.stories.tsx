import type { Meta, StoryObj } from '@storybook/react-vite';
import { MessageSquare, Minus, Paperclip, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Avatar } from '../avatar/avatar';
import { Button } from '../button/button';
import { Card } from '../card/card';
import { ChatComposer, ChatLog, ChatMessage, ChatTyping } from './chat';
import { ChatWindow } from './chat-window';

const meta = {
  title: 'Components/Chat',
  component: ChatLog,
  subcomponents: { ChatMessage, ChatTyping, ChatComposer, ChatWindow },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'A conversation: direct messages about a request or a person, or questions to an assistant. Your messages sit on the trailing side in the accent.',
          '',
          '- `ChatLog` is `role="log"`, the ARIA pattern for a thread: new messages are read out politely as they arrive, and nothing already read is announced again. It follows the newest message only while the reader is already at the bottom.',
          '- `ChatMessage` with `from="self"` sits on the trailing side; everyone else sits on the leading side with their avatar (`avatar`, or the author’s initials). The speaker is in the text, visually hidden, so the side a bubble sits on is never the only way to know who said it.',
          '- `continued` drops the avatar for the first of several messages in a row from one person, and keeps its space so the bubbles stay aligned.',
          '- `pending` puts three dots in the bubble while a reply is written; `ChatTyping` shows the same dots with the writer’s face and announces who is writing. `unsent` marks your own message that has not gone.',
          '- `ChatComposer`: Enter sends, Shift+Enter starts a new line, and an Enter that ends an input-method composition is ignored. The send button stays disabled until there is something to send.',
          '- `ChatDivider` marks a day in a long thread.',
          '- `ChatWindow` floats the conversation over the corner of the page from a round button, and the page stays usable beside it.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    label: {
      description: 'Names the log: "Conversation with Jonas Weber".',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Accessibility' },
    },
  },
  args: { label: 'Conversation with Jonas Weber' },
} satisfies Meta<typeof ChatLog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The frame most stories share: a card with an optional header and composer. */
function Frame({
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
    <Frame>
      <ChatLog {...args}>
        <ChatMessage author="Jonas Weber" meta="Jonas · 09:12">
          Can you cover Amara’s reviews next week?
        </ChatMessage>
        <ChatMessage from="self" meta="09:14 · Read">
          Yes, happy to. Which ones?
        </ChatMessage>
        <ChatMessage author="Jonas Weber" meta="09:15">
          The payroll redesign and the onboarding flow.
        </ChatMessage>
      </ChatLog>
    </Frame>
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
      <Frame
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
        <ChatLog {...args}>
          <ChatMessage author="Jonas Weber" meta="09:12">
            Can you cover Amara’s reviews next week?
          </ChatMessage>
          {sent.map((text, index) => (
            <ChatMessage key={index} from="self" meta="Just now">
              {text}
            </ChatMessage>
          ))}
          <ChatTyping author="Jonas Weber" />
        </ChatLog>
      </Frame>
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
    <Frame>
      <ChatLog {...args} className="gap-2">
        <ChatMessage from="self">I’ve booked 14–18 Oct.</ChatMessage>
        <ChatMessage author="Jonas Weber">Approved it just now</ChatMessage>
        <ChatMessage from="self" meta="Delivered">
          Thanks!
        </ChatMessage>
        <ChatMessage from="self" unsent meta="Not sent · Tap to retry">
          Sending…
        </ChatMessage>
      </ChatLog>
    </Frame>
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
      <Frame
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
        <ChatLog {...args}>
          <ChatMessage author="Nora Becker">Welcome to Reach, Lucas!</ChatMessage>
          <ChatMessage from="self">Thanks Nora!</ChatMessage>
        </ChatLog>
      </Frame>
    </div>
  ),
};

/** A question to an assistant: a mark for its avatar, and dots while it writes the reply. */
export const Assistant: Story = {
  render: function Render(args) {
    const [messages, setMessages] = useState([
      { from: 'self' as const, text: 'Who reports to Nora?' },
      {
        from: 'other' as const,
        text: 'Nora Becker has 3 direct reports:\n• Jonas Weber, Engineering\n• Amara Okafor, Design\n• Lucas Silva, Product',
      },
    ]);
    const [busy, setBusy] = useState(false);
    const mark = <Avatar size="sm" name="Assistant" className="size-7 text-[0.625rem]" />;
    return (
      <Frame
        footer={
          <ChatComposer
            label="Ask a question"
            placeholder="Ask about your people…"
            busy={busy}
            onSend={(text) => {
              setMessages((all) => [...all, { from: 'self', text }]);
              setBusy(true);
              setTimeout(() => {
                setMessages((all) => [...all, { from: 'other', text: 'Here’s what I found.' }]);
                setBusy(false);
              }, 900);
            }}
          />
        }
      >
        <ChatLog {...args} label="Conversation with the assistant" className="h-72">
          {messages.map((m, i) => (
            <ChatMessage
              key={i}
              from={m.from}
              author={m.from === 'self' ? 'You' : 'Assistant'}
              avatar={mark}
            >
              {m.text}
            </ChatMessage>
          ))}
          {busy ? <ChatMessage author="Assistant" avatar={mark} pending /> : null}
        </ChatLog>
      </Frame>
    );
  },
};

/** The launcher and its window: a conversation beside the page, not over it. */
export const FloatingWindow: Story = {
  name: 'Floating Window',
  parameters: { layout: 'fullscreen' },
  render: function Render(args) {
    const [open, setOpen] = useState(true);
    return (
      <div className="h-[40rem] p-6">
        <p className="text-sm text-fg-muted">The page stays usable while the window is open.</p>
        <ChatWindow
          open={open}
          onOpenChange={setOpen}
          title="Ask the assistant"
          description="Answers only with what you can see."
          launcherLabel="Ask the assistant"
          launcherIcon={<MessageSquare aria-hidden />}
          footer={<ChatComposer label="Ask a question" onSend={() => undefined} />}
        >
          <ChatLog {...args} label="Conversation with the assistant" className="flex-1">
            <ChatMessage
              author="Assistant"
              avatar={<Avatar size="sm" name="Assistant" className="size-7 text-[0.625rem]" />}
            >
              Hi! What would you like to know?
            </ChatMessage>
          </ChatLog>
        </ChatWindow>
      </div>
    );
  },
};
