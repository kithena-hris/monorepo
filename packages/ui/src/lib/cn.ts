import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * `tailwind-merge` has to be told about theme extensions, otherwise it cannot
 * tell that `text-fg-muted` (a colour) and `text-sm` (a size) belong to
 * different groups, and the last-one-wins pass drops the wrong class.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['2xs', 'xs', 'sm', 'base', 'md', 'lg', 'xl', '2xl', '3xl'] }],
    },
  },
});

/**
 * Compose class names, resolving Tailwind conflicts in favour of the last
 * value. This is what makes `className` on a component a real override rather
 * than a coin flip decided by stylesheet order.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
