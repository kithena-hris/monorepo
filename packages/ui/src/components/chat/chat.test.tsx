import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ChatComposer, ChatLog, ChatMessage } from './chat';

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
