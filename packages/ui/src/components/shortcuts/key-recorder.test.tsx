import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { chordOf } from '../kbd/kbd';
import { KeyRecorder } from './key-recorder';

const key = (
  k: string,
  mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {},
) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

describe('chordOf', () => {
  it('writes a key the way a shortcut is matched', () => {
    expect(chordOf(key('g'))).toBe('g');
    expect(chordOf(key('J', { shiftKey: true }))).toBe('shift+j');
    expect(chordOf(key('?', { shiftKey: true }))).toBe('?');
    expect(chordOf(key('k', { metaKey: true }))).toBe('mod+k');
    expect(chordOf(key('K', { ctrlKey: true, shiftKey: true }))).toBe('mod+shift+k');
    expect(chordOf(key('Enter', { shiftKey: true }))).toBe('shift+enter');
    expect(chordOf(key(' '))).toBe('space');
    expect(chordOf(key('Escape'))).toBe('escape');
    expect(chordOf(key('Shift', { shiftKey: true }))).toBeNull();
  });

  it('reads the letter under Alt from the key, where a Mac types a character instead', () => {
    expect(chordOf({ ...key('†', { altKey: true }), code: 'KeyT' })).toBe('alt+t');
    expect(chordOf({ ...key('t', { altKey: true }), code: 'KeyT' })).toBe('alt+t');
    expect(chordOf({ ...key('†'), code: 'KeyT' })).toBe('†');
  });
});

describe('KeyRecorder', () => {
  const setup = () => {
    const onValueChange = vi.fn();
    render(<KeyRecorder aria-label="Shortcut" value={['g', 'd']} onValueChange={onValueChange} />);
    const recorder = screen.getByRole('button', { name: 'Shortcut' });
    act(() => {
      fireEvent.click(recorder);
    });
    return { recorder, onValueChange };
  };

  it('records two keys in a row, and one with a modifier at once', () => {
    const { recorder, onValueChange } = setup();
    fireEvent.keyDown(recorder, key('g'));
    fireEvent.keyDown(recorder, key('x'));
    expect(onValueChange).toHaveBeenLastCalledWith(['g', 'x']);
    act(() => {
      fireEvent.click(recorder);
    });
    fireEvent.keyDown(recorder, key('d', { metaKey: true, shiftKey: true }));
    expect(onValueChange).toHaveBeenLastCalledWith(['mod+shift+d']);
  });

  it('cancels on Escape, and on Tab without keeping focus', () => {
    const { recorder, onValueChange } = setup();
    expect(recorder.getAttribute('data-recording')).toBe('true');
    act(() => {
      fireEvent.keyDown(recorder, key('Escape'));
    });
    expect(recorder.getAttribute('data-recording')).toBeNull();
    act(() => {
      fireEvent.click(recorder);
    });
    const tab = fireEvent.keyDown(recorder, key('Tab'));
    // Not prevented: the browser moves focus on as it always does.
    expect(tab).toBe(true);
    expect(recorder.getAttribute('data-recording')).toBeNull();
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('keeps what it records from reaching anything else', () => {
    const outside = vi.fn();
    window.addEventListener('keydown', outside);
    const { recorder } = setup();
    fireEvent.keyDown(recorder, key('k', { metaKey: true }));
    expect(outside).not.toHaveBeenCalled();
    window.removeEventListener('keydown', outside);
  });
});
