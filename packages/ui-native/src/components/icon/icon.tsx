import { cva, type VariantProps } from 'class-variance-authority';
import type { LucideIcon } from 'lucide-react-native';
import { Platform } from 'react-native';
import { useCssElement } from 'react-native-css';

import { cn } from '../../lib/cn.ts';

export type { LucideIcon };

/**
 * The colour an icon draws in, as the text tones name it. An icon on a phone
 * inherits nothing: unlike a web `currentColor`, React Native passes no colour
 * down, so each icon says its own.
 */
export const iconVariants = cva('', {
  variants: {
    tone: {
      default: 'text-fg',
      muted: 'text-fg-muted',
      subtle: 'text-icon-muted',
      disabled: 'text-fg-disabled',
      accent: 'text-accent-fg',
      success: 'text-success-fg',
      warning: 'text-warning-fg',
      danger: 'text-danger-fg',
      info: 'text-info-fg',
      'on-accent': 'text-fg-on-accent',
      'on-invert': 'text-fg-on-invert',
    },
  },
  defaultVariants: { tone: 'default' },
});

/*
 * On a device react-native-css resolves the class to a style; the colour has
 * to arrive as the icon's `color` prop, which is what lucide strokes with. On
 * the web the class reaches the `<svg>` and `currentColor` does the same.
 */
// An <svg> on the web takes ARIA attributes; React Native's accessibility
// props would land on the DOM element as unknown attributes.
const WEB = Platform.OS === 'web';

const mapping = { className: { target: 'style', nativeStyleMapping: { color: 'color' } } } as const;

export type IconProps = VariantProps<typeof iconVariants> & {
  /** A lucide icon, `import { Calendar } from 'lucide-react-native'`. */
  icon: LucideIcon;
  /** In points. 20 beside 17pt text, the design's icon-to-text ratio. */
  size?: number;
  /**
   * Names the icon for a screen reader when it carries meaning on its own.
   * Leave it unset beside a visible label: the icon is then decoration and is
   * hidden, so the label is not read twice.
   */
  label?: string;
  className?: string | undefined;
};

/** A lucide icon at the system's 2px stroke. Decorative unless it has a `label`. */
export function Icon({ icon, size = 20, label, tone, className }: IconProps): React.JSX.Element {
  return useCssElement(
    icon,
    {
      size,
      strokeWidth: 2,
      className: cn(iconVariants({ tone }), className),
      ...(label
        ? WEB
          ? { role: 'img', 'aria-label': label }
          : { accessible: true, accessibilityRole: 'image', accessibilityLabel: label }
        : WEB
          ? { 'aria-hidden': true }
          : {
              accessible: false,
              importantForAccessibility: 'no-hide-descendants',
              accessibilityElementsHidden: true,
            }),
    },
    mapping,
  );
}
