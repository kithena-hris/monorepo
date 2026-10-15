import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { adamToSign } from '../test/acme.fixture';
import type { EnvelopeData } from '../types';
import { traceCaption, useSigning } from './sign-view';

const box = (
  id: string,
  kind: EnvelopeData['fields'][number]['kind'],
  page: number,
  y: number,
  signerId = 's1',
): EnvelopeData['fields'][number] => ({
  id,
  signerId,
  kind,
  page,
  x: 0.1,
  y,
  w: 0.3,
  h: 0.05,
  required: kind !== 'checkbox',
  label: null,
  value: null,
});

const env = (): EnvelopeData =>
  adamToSign({
    me: { signerId: 's1', status: 'verified', turn: true },
    fields: [
      box('later', 'date', 2, 0.5),
      box('first', 'signature', 1, 0.8),
      box('second', 'initials', 2, 0.1),
      box('theirs', 'signature', 1, 0.2, 's2'),
    ],
  });

describe('signing as DocuSign does it', () => {
  it('goes through only my boxes, in page order', () => {
    const { result } = renderHook(() => useSigning(env(), 'Adam Novak'));
    expect(result.current.mine.map((f) => f.id)).toEqual(['first', 'second', 'later']);
    act(() => {
      result.current.goNext();
    });
    expect(result.current.focus).toBe('first');
  });

  it('asks for a signature the first time, then applies it to the box that asked', () => {
    const { result } = renderHook(() => useSigning(env(), 'Adam Novak'));
    act(() => {
      result.current.apply('first');
    });
    expect(result.current.adopting).toBe(true);
    expect(result.current.filled['first']).toBeUndefined();
    act(() => {
      result.current.adopt({ kind: 'typed', text: 'Adam Novak', style: 'flowing' });
    });
    expect(result.current.filled['first']).toBe('signed');
    // Every signature box after it takes the same one, at a press.
    act(() => {
      result.current.apply('second');
    });
    expect(result.current.filled['second']).toBe('signed');
    expect(result.current.ready).toBe(false);
    act(() => {
      result.current.apply('later');
    });
    expect(result.current.filled['later']).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(result.current.ready).toBe(true);
    expect(result.current.next).toBeNull();
  });
});

describe('a dated signature, and a name that fills itself', () => {
  const dated = (): EnvelopeData =>
    adamToSign({
      me: { signerId: 's1', status: 'verified', turn: true },
      fields: [box('when', 'date', 1, 0.8), box('who', 'name', 1, 0.9)],
    });

  it('asks for the signature, then holds it with the day', () => {
    const { result } = renderHook(() => useSigning(dated(), 'Adam Novak'));
    act(() => {
      result.current.apply('when');
    });
    expect(result.current.adopting).toBe(true);
    act(() => {
      result.current.adopt({ kind: 'typed', text: 'Adam Novak', style: 'flowing' });
    });
    expect(result.current.filled['when']).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(result.current.ready).toBe(true);
  });

  it('fills a name box with the legal name before anything is pressed, and never makes it a step', () => {
    const { result } = renderHook(() => useSigning(dated(), 'Adam Novak'));
    expect(result.current.filled['who']).toBe('Adam Novak');
    expect(result.current.steps.map((f) => f.id)).toEqual(['when']);
  });
});

describe('the print under a signed box (K7)', () => {
  it('says what the sealed file says, to the minute, in UTC, with the Signature ID', () => {
    expect(
      traceCaption('6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', new Date('2026-10-14T21:54:59.000Z')),
    ).toBe(
      'Electronically signed via Kithena on 14 Oct 2026, 21:54 UTC\nSignature ID: 6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
    );
  });
});
