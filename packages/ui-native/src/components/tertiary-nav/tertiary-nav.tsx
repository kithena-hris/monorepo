import { Pressable, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { Text } from '../text/text.tsx';

/*
 * The third level of navigation on a phone, inside one screen. Most of it is
 * other parts: a scrolling row of pill `Tabs` under the title, a `List` of
 * rows to drill into, or an `ActionSheet` of sections behind a button. This
 * file holds the one part that is its own: the contents of a long page.
 */

export type ContentsItem = {
  id: string;
  label: string;
  /** 2 for a subsection, indented under its section. */
  level?: 1 | 2;
};

export type TableOfContentsProps = {
  items: readonly ContentsItem[];
  /** The section in view, highlighted as the page scrolls. */
  value: string;
  /** Jump to a section: the caller scrolls to it, at once under reduced motion. */
  onValueChange: (id: string) => void;
  title?: string;
  className?: string | undefined;
};

/** The sections of a long page, the one in view marked on the rail. */
export function TableOfContents({
  items,
  value,
  onValueChange,
  title = 'On this page',
  className,
}: TableOfContentsProps): React.JSX.Element {
  return (
    <View
      // A landmark on the web, as the web's contents list is.
      {...({ role: 'navigation', 'aria-label': title } as object)}
      className={cn('w-full', className)}
    >
      <Text
        variant="caption"
        weight="semibold"
        tone="subtle"
        className="pb-2.5 pl-3.5 leading-none"
      >
        {title}
      </Text>
      {items.map((item) => {
        const on = item.id === value;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="link"
            accessibilityState={{ selected: on }}
            {...(on ? ({ 'aria-current': 'location' } as object) : {})}
            onPress={() => {
              onValueChange(item.id);
            }}
            className={cn(
              'min-h-m-tap justify-center border-l-2 py-3 pr-3.5',
              item.level === 2 ? 'pl-7' : 'pl-3.5',
              on ? 'border-accent' : 'border-border',
            )}
          >
            <Text
              weight={on ? 'semibold' : 'medium'}
              tone={on ? 'accent' : 'muted'}
              className="text-[16px] leading-[1.3]"
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
