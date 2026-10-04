import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ListItem } from '../list-item/list-item';
import { columnsFor, VirtualList } from './virtual-list';

type Item = { readonly id: string };
const items = (n: number, from = 0): Item[] =>
  Array.from({ length: n }, (_, i) => ({ id: `i${String(from + i)}` }));

function list(props: Partial<ComponentProps<typeof VirtualList<Item>>> = {}) {
  return (
    <VirtualList<Item>
      label="Things"
      items={items(1000)}
      itemKey={(it) => it.id}
      renderItem={(it) => <span>{it.id}</span>}
      estimateItemHeight={50}
      {...props}
    />
  );
}

describe('<VirtualList>', () => {
  it('arrives from the server as the items that fill a window, the rest counted', () => {
    for (const scroll of ['self', 'page'] as const) {
      const html = renderToString(list({ scroll }));
      expect(html).toContain('>i0<');
      expect(html).toContain('>i10<');
      expect(html).not.toContain('>i500<');
      expect(html).toContain('aria-setsize="1000"');
    }
  });

  it('holds a List’s own rows directly, each told its place in the whole list', () => {
    const html = renderToString(
      list({
        listItems: true,
        renderItem: (it, _i, row) => (
          <ListItem key={it.id} {...row}>
            {it.id}
          </ListItem>
        ),
      }),
    );
    expect(html).toMatch(/<ul[^>]*aria-label="Things"[^>]*><li[^>]*data-index="0"/u);
    expect(html).toContain('aria-posinset="1"');
    expect(html).not.toContain('role="listitem"');
  });

  it('draws a grid as CSS would until it is measured', () => {
    const html = renderToString(list({ minItemWidth: 200, gap: 12 }));
    expect(html).toContain('repeat(auto-fill, minmax(min(100%, 200px), 1fr))');
    expect(html).toContain('>i0<');
  });

  it('counts columns as auto-fill does', () => {
    expect(columnsFor(1000, 200, 12)).toBe(4);
    expect(columnsFor(150, 200, 12)).toBe(1);
    expect(columnsFor(0, 200, 12)).toBe(1);
  });

  it('asks for the next page when what is loaded does not fill the view, and says what came', () => {
    const onEndReached = vi.fn();
    const { rerender } = render(list({ items: items(5), onEndReached }));
    expect(onEndReached).toHaveBeenCalled();
    rerender(list({ items: [...items(5), ...items(20, 5)], onEndReached }));
    expect(screen.getByText('20 more loaded')).toBeInTheDocument();
  });

  describe('scrolled', () => {
    /** A 400px box and 50px items, as a browser would lay them out; jsdom lays out nothing. */
    function layOut(): void {
      const height = (el: HTMLElement): number => (el.getAttribute('role') === 'region' ? 400 : 50);
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement,
      ) {
        const h = height(this);
        return { top: 0, left: 0, right: 400, bottom: h, width: 400, height: h } as DOMRect;
      });
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
        this: HTMLElement,
      ) {
        return height(this);
      });
    }
    function scrollTo(top: number): void {
      const box = screen.getByRole('region', { name: 'Things' });
      Object.defineProperty(box, 'scrollTop', { configurable: true, value: top });
      act(() => {
        fireEvent.scroll(box);
      });
    }
    const drawn = (): string[] =>
      [...document.querySelectorAll<HTMLElement>('li[data-index]')].map(
        (li) => li.textContent ?? '',
      );
    afterEach(() => {
      vi.restoreAllMocks();
    });

    for (const listItems of [false, true]) {
      it(`renders only the items a scroll brings into view${listItems ? ', as rows of a List' : ''}`, () => {
        layOut();
        const rendered: string[] = [];
        render(
          list({
            listItems,
            renderItem: (it, _i, row) => {
              rendered.push(it.id);
              return listItems ? (
                <ListItem key={it.id} {...row}>
                  {it.id}
                </ListItem>
              ) : (
                <span>{it.id}</span>
              );
            },
          }),
        );
        scrollTo(100 * 50);
        const before = new Set(drawn());
        rendered.length = 0;
        scrollTo(101 * 50);
        const entered = drawn().filter((id) => !before.has(id));
        expect(before.size).toBeGreaterThan(20);
        expect(entered).toHaveLength(1);
        expect(rendered).toEqual(entered);
      });
    }

    it('draws no placeholder over loaded items, only under the last while a page loads', () => {
      layOut();
      const { rerender } = render(list());
      scrollTo(500 * 50);
      expect(document.querySelector('[aria-busy]')).toBeNull();
      rerender(list({ loadingMore: true }));
      const busy = document.querySelectorAll('[aria-busy]');
      expect(busy).toHaveLength(1);
      // After the list itself: the next page's place, not a loaded item's.
      expect(busy[0]?.previousElementSibling?.tagName).toBe('UL');
    });
  });

  it('asks for nothing while a page is on its way', () => {
    const onEndReached = vi.fn();
    render(list({ items: items(5), onEndReached, loadingMore: true }));
    expect(onEndReached).not.toHaveBeenCalled();
    expect(screen.getByText('Loading more')).toBeInTheDocument();
  });
});
