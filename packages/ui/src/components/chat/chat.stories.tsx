import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Avatar } from '../avatar/avatar';
import { MessageSquare } from 'lucide-react';

import { ChatComposer, ChatLog, ChatMessage } from './chat';
import { ChatWindow } from './chat-window';

const meta = {
  title: 'Components/Chat',
  component: ChatMessage,
  args: { from: 'other', author: 'Assistant', children: 'Happy to help.' },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'A conversation: `ChatLog` holds the messages, `ChatMessage` is one of them, and `ChatComposer` writes the next.',
          '',
          'The log is `role="log"` and polite, so each new message is read aloud as it arrives and the earlier ones are not read again. It follows the newest message only while the reader is already at the bottom.',
          '',
          'Enter sends and Shift+Enter is a new line, never while an input method is composing a character.',
        ].join('\n'),
      },
    },
  },
} satisfies Meta<typeof ChatMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Conversation: Story = {
  render: function Conversation() {
    const [messages, setMessages] = useState([
      { from: 'self' as const, text: 'Who reports to Michael?' },
      {
        from: 'other' as const,
        text: 'Sure! Michael Scott has 3 direct reports:\n• Dwight Schrute — Assistant to the Regional Manager\n• Jim Halpert — Sales\n• Pam Beesly — Reception',
      },
    ]);
    const [busy, setBusy] = useState(false);
    return (
      <div className="flex h-[28rem] w-full max-w-md flex-col gap-3">
        <ChatLog label="Conversation with the assistant" className="flex-1">
          {messages.map((m, i) => (
            <ChatMessage
              key={i}
              from={m.from}
              author={m.from === 'self' ? 'You' : 'Assistant'}
              avatar={<Avatar size="sm" name="Assistant" />}
            >
              {m.text}
            </ChatMessage>
          ))}
          {busy ? (
            <ChatMessage from="other" author="Assistant" avatar={<Avatar size="sm" name="Assistant" />} pending />
          ) : null}
        </ChatLog>
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
      </div>
    );
  },
};

export const Writing: Story = { args: { pending: true } };

export const FromYou: Story = { args: { from: 'self', author: 'You', children: 'How many people are in Scranton?' } };

/** The launcher and its window: a conversation beside the page, not over it. */
export const InAWindow: Story = {
  parameters: { layout: 'fullscreen' },
  render: function InAWindow() {
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
          <ChatLog label="Conversation with the assistant" className="flex-1">
            <ChatMessage from="other" author="Assistant" avatar={<Avatar size="sm" name="Assistant" />}>
              Hi! What would you like to know?
            </ChatMessage>
          </ChatLog>
        </ChatWindow>
      </div>
    );
  },
};
