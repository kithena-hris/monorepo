import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * `tailwind-merge`, told about Reach's own theme names, as `@reach/ui`'s `cn`
 * is. Without them it cannot tell that `text-fg-muted` (a colour) and
 * `text-body` (a size) are different groups, and the last-one-wins pass drops
 * the wrong class.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: ['m-margin', 'm-tap', 'm-btn', 'm-btn-sm', 'm-field', 'm-cell', 'm-cell-2line'],
      radius: ['control', 'm-card', 'm-sheet'],
    },
    classGroups: {
      'font-size': [
        {
          text: [
            'display',
            'large',
            'title1',
            'title2',
            'title3',
            'headline',
            'body',
            'callout',
            'subhead',
            'footnote',
            'caption',
          ],
        },
      ],
    },
  },
});

/** Compose class names; a later class wins a conflict, so `className` really overrides. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
