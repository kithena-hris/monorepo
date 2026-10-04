import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

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

  it('asks for nothing while a page is on its way', () => {
    const onEndReached = vi.fn();
    render(list({ items: items(5), onEndReached, loadingMore: true }));
    expect(onEndReached).not.toHaveBeenCalled();
    expect(screen.getByText('Loading more')).toBeInTheDocument();
  });
});
