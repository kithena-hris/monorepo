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
        <ChatWindow open={false} onOpenChange={onOpenChange} title="Ask" launcherLabel="Ask Kithena" launcherIcon={null}>
          <p>Hello</p>
        </ChatWindow>
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Ask Kithena' }));
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    rerender(
      <>
        <button type="button">On the page</button>
        <ChatWindow open onOpenChange={onOpenChange} title="Ask" launcherLabel="Ask Kithena" launcherIcon={null}>
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
