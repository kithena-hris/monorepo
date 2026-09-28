import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Chat, ChatComposer, ChatMessage } from './chat';

describe('<ChatComposer>', () => {
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
});

describe('<ChatMessage>', () => {
  it('names the speaker for a screen reader', () => {
    render(
      <Chat aria-label="Conversation with Jonas Weber">
        <ChatMessage author="Jonas Weber">Can you cover Friday?</ChatMessage>
        <ChatMessage from="me">Yes, I can.</ChatMessage>
      </Chat>,
    );

    const log = screen.getByRole('log', { name: 'Conversation with Jonas Weber' });
    expect(log).toHaveTextContent('Jonas Weber: Can you cover Friday?');
    expect(log).toHaveTextContent('You: Yes, I can.');
  });
});
