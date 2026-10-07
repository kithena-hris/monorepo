import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { useState } from 'react';

import { designDocs } from '../../docs/design.ts';
import { ChatComposer, ChatHeader, ChatLog, ChatMessage, ChatTyping, ChatWindow } from './chat.tsx';

const meta = {
  title: 'Components/Chat',
  component: ChatMessage,
  parameters: designDocs('chat'),
  args: { children: 'Can you cover Amara’s reviews next week?' },
} satisfies Meta<typeof ChatMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = (): void => undefined;

export const Conversation: Story = {
  render: () => (
    <ChatWindow>
      <ChatLog accessibilityLabel="Conversation with Jonas Weber">
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
    </ChatWindow>
  ),
};

export const Writing: Story = {
  render: () => (
    <ChatWindow
      composer={
        <ChatComposer
          onSend={noop}
          defaultValue="Sure, send me the links"
          placeholder="Message Jonas"
          accessibilityLabel="Message Jonas"
        />
      }
    >
      <ChatLog accessibilityLabel="Conversation with Jonas Weber">
        <ChatMessage author="Jonas Weber" meta="09:12">
          Can you cover Amara’s reviews next week?
        </ChatMessage>
        <ChatTyping author="Jonas Weber" />
      </ChatLog>
    </ChatWindow>
  ),
};

export const FromYou: Story = {
  name: 'From You',
  render: function FromYouStory() {
    const [sent, setSent] = useState(false);
    return (
      <ChatWindow>
        <ChatLog accessibilityLabel="Conversation with Jonas Weber" className="gap-2">
          <ChatMessage from="self">I’ve booked 14–18 Oct.</ChatMessage>
          <ChatMessage author="Jonas Weber">Approved it just now</ChatMessage>
          <ChatMessage from="self" meta="Delivered">
            Thanks!
          </ChatMessage>
          {sent ? (
            <ChatMessage from="self" meta="Delivered">
              Sending…
            </ChatMessage>
          ) : (
            <ChatMessage
              from="self"
              unsent
              meta="Not sent · Tap to retry"
              onRetry={() => {
                setSent(true);
              }}
            >
              Sending…
            </ChatMessage>
          )}
        </ChatLog>
      </ChatWindow>
    );
  },
};

export const InAWindow: Story = {
  name: 'In A Window',
  render: function InAWindowStory() {
    const [messages, setMessages] = useState<string[]>([]);
    return (
      <ChatWindow
        header={
          <ChatHeader name="Jonas Weber" status="Online" online onMinimise={noop} onClose={noop} />
        }
        composer={
          <ChatComposer
            onSend={(text) => {
              setMessages([...messages, text]);
            }}
            placeholder="Message Jonas"
            accessibilityLabel="Message Jonas"
          />
        }
      >
        <ChatLog accessibilityLabel="Conversation with Jonas Weber">
          <ChatMessage author="Nora Becker">Welcome to Reach, Lucas!</ChatMessage>
          <ChatMessage from="self">Thanks Nora!</ChatMessage>
          {messages.map((text, i) => (
            <ChatMessage key={i} from="self">
              {text}
            </ChatMessage>
          ))}
        </ChatLog>
      </ChatWindow>
    );
  },
};
