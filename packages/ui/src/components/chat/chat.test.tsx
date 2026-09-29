import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ChatComposer, ChatLog, ChatMessage } from './chat';
import { ChatWindow } from './chat-window';

describe('ChatLog and ChatMessage', () => {
  it('is a live log, and every message says who said it', () => {
    render(
      <ChatLog label="Conversation with the assistant">
        <ChatMessage from="self" author="You">
          Who is in Sales?
        </ChatMessage>
        <ChatMessage from="other" author="Assistant" pending />
      </ChatLog>,
    );
    const log = screen.getByRole('log', { name: 'Conversation with the assistant' });
    expect(log.getAttribute('aria-live')).toBe('polite');
    expect(log.textContent).toContain('You: Who is in Sales?');
    expect(screen.getByRole('status').textContent).toBe('Writing');
  });

  it('names the speaker for a screen reader', () => {
    render(
      <ChatLog label="Conversation with Jonas Weber">
        <ChatMessage author="Jonas Weber">Can you cover Friday?</ChatMessage>
        <ChatMessage from="self">Yes, I can.</ChatMessage>
      </ChatLog>,
    );

    const log = screen.getByRole('log', { name: 'Conversation with Jonas Weber' });
    expect(log).toHaveTextContent('Jonas Weber: Can you cover Friday?');
    expect(log).toHaveTextContent('You: Yes, I can.');
  });
});

describe('ChatComposer', () => {
  it('sends on Enter, keeps Shift+Enter as a new line, and clears after sending', async () => {
    const onSend = vi.fn();
    render(<ChatComposer label="Ask a question" onSend={onSend} />);
    const box = screen.getByRole('textbox', { name: 'Ask a question' });
    await userEvent.type(box, 'Who{Shift>}{Enter}{/Shift}is here?{Enter}');
    expect(onSend).toHaveBeenCalledWith('Who\nis here?');
    expect((box as HTMLTextAreaElement).value).toBe('');
  });

  it('sends the trimmed text on Enter and clears itself', async () => {
    const onSend = vi.fn();
    render(<ChatComposer onSend={onSend} />);
    const box = screen.getByRole('textbox', { name: 'Message' });

    await userEvent.type(box, '  Can you cover Friday?  {Enter}');

    expect(onSend).toHaveBeenCalledWith('Can you cover Friday?');
    expect(box).toHaveValue('');
  });

  it('starts a new line on Shift+Enter instead of sending', async () => {
    const onSend = vi.fn();
    render(<ChatComposer onSend={onSend} />);
    const box = screen.getByRole('textbox', { name: 'Message' });

    await userEvent.type(box, 'First{Shift>}{Enter}{/Shift}second');

    expect(onSend).not.toHaveBeenCalled();
    expect(box).toHaveValue('First\nsecond');
  });

  it('will not send an empty message', async () => {
    const onSend = vi.fn();
    render(<ChatComposer onSend={onSend} />);

    await userEvent.type(screen.getByRole('textbox'), '   {Enter}');

    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('sends nothing blank, and nothing while a reply is being written', async () => {
    const onSend = vi.fn();
    const { rerender } = render(<ChatComposer label="Ask" onSend={onSend} />);
    await userEvent.type(screen.getByRole('textbox'), '   {Enter}');
    expect(onSend).not.toHaveBeenCalled();
    rerender(<ChatComposer label="Ask" onSend={onSend} busy />);
    await userEvent.type(screen.getByRole('textbox'), 'hi{Enter}');
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe('ChatWindow', () => {
  it('opens from its floating button, stays open while the page is used, and closes on its own button', async () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <>
        <button type="button">On the page</button>
        <ChatWindow
          open={false}
          onOpenChange={onOpenChange}
          title="Ask"
          launcherLabel="Ask Kithena"
          launcherIcon={null}
        >
          <p>Hello</p>
        </ChatWindow>
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Ask Kithena' }));
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    rerender(
      <>
        <button type="button">On the page</button>
        <ChatWindow
          open
          onOpenChange={onOpenChange}
          title="Ask"
          launcherLabel="Ask Kithena"
          launcherIcon={null}
        >
          <p>Hello</p>
        </ChatWindow>
      </>,
    );
    onOpenChange.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'On the page' }));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});
