import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Carousel } from './carousel';

/**
 * A carousel driven from outside (an import's field cards, one press per
 * card) must not report the slides a scroll passes on its way to the slide
 * asked for: the parent would go back to one it left, and its next press
 * would act on that card.
 */
const WIDTH = 300;
const measured = ['offsetLeft', 'clientWidth', 'scrollWidth'] as const;
const before = measured.map((key) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, key));
const define = (key: (typeof measured)[number], get: (this: HTMLElement) => number): void => {
  Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get });
};
const scrollTo = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTo');

beforeEach(() => {
  // Each slide one track wide, laid out in a row; a smooth scroll is in flight
  // until the test moves it.
  define('offsetLeft', function () {
    return [...(this.parentElement?.children ?? [])].indexOf(this) * WIDTH;
  });
  define('clientWidth', () => WIDTH);
  define('scrollWidth', function () {
    return Math.max(1, this.children.length) * WIDTH;
  });
  Object.defineProperty(Element.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
});

afterEach(() => {
  measured.forEach((key, i) => {
    const was = before[i];
    if (was) Object.defineProperty(HTMLElement.prototype, key, was);
    else Reflect.deleteProperty(HTMLElement.prototype, key);
  });
  if (scrollTo) Object.defineProperty(Element.prototype, 'scrollTo', scrollTo);
  else Reflect.deleteProperty(Element.prototype, 'scrollTo');
});

function Driven({ onIndexChange }: { readonly onIndexChange: (i: number) => void }) {
  const [index, setIndex] = useState(0);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setIndex((i) => i + 1);
        }}
      >
        Next card
      </button>
      <Carousel
        label="Cards"
        index={index}
        onIndexChange={(i) => {
          onIndexChange(i);
          setIndex(i);
        }}
      >
        <p>One</p>
        <p>Two</p>
        <p>Three</p>
      </Carousel>
    </>
  );
}

const scrollTrackTo = (left: number): void => {
  const track = screen.getByRole('region', { name: 'Cards' }).querySelector('[tabindex="0"]');
  if (!(track instanceof HTMLElement)) throw new Error('no track');
  track.scrollLeft = left;
  fireEvent.scroll(track);
};

describe('a carousel driven from outside', () => {
  it('reports no slide its scroll passes on the way to the one asked for', () => {
    const told = vi.fn();
    render(<Driven onIndexChange={told} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next card' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next card' }));
    // In flight from the first slide to the third, past the second.
    scrollTrackTo(WIDTH);
    scrollTrackTo(2 * WIDTH);
    expect(told).not.toHaveBeenCalled();
  });

  it('reports a slide a finger moves it to', () => {
    const told = vi.fn();
    render(<Driven onIndexChange={told} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next card' }));
    const track = screen.getByRole('region', { name: 'Cards' }).querySelector('[tabindex="0"]');
    if (!(track instanceof HTMLElement)) throw new Error('no track');
    fireEvent.pointerDown(track);
    scrollTrackTo(2 * WIDTH);
    expect(told).toHaveBeenCalledWith(2);
  });
});
