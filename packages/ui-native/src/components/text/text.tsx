import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';
import { Platform, type TextProps as RNTextProps } from 'react-native';
import { Text as CssText } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';

/**
 * The mobile type scale, Display to Caption. Sizes, line heights, weights and
 * tracking live in `tokens.css` as `--reach-m-*`; a variant only names one.
 */
export const textVariants = cva('', {
  variants: {
    variant: {
      display: 'text-display',
      large: 'text-large',
      title1: 'text-title1',
      title2: 'text-title2',
      title3: 'text-title3',
      headline: 'text-headline',
      body: 'text-body',
      callout: 'text-callout',
      subhead: 'text-subhead',
      footnote: 'text-footnote',
      caption: 'text-caption',
    },
    tone: {
      default: 'text-fg',
      muted: 'text-fg-muted',
      subtle: 'text-fg-subtle',
      disabled: 'text-fg-disabled',
      accent: 'text-accent-fg',
      success: 'text-success-fg',
      warning: 'text-warning-fg',
      danger: 'text-danger-fg',
      info: 'text-info-fg',
      'on-accent': 'text-fg-on-accent',
      'on-invert': 'text-fg-on-invert',
    },
    weight: {
      regular: 'font-normal',
      medium: 'font-medium',
      semibold: 'font-semibold',
      bold: 'font-bold',
    },
    /** Figures that line up in a column and do not jitter as they change. */
    tabular: { true: 'tabular-nums', false: '' },
  },
  defaultVariants: { variant: 'body', tone: 'default', tabular: false },
});

const HEADINGS = new Set(['display', 'large', 'title1', 'title2', 'title3']);

/*
 * The platform's monospace face. A font stack is a web idea: a phone takes one
 * family name, so the stack only goes to the browser.
 */
const MONO = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
});

export type TextProps = VariantProps<typeof textVariants> & {
  children?: ReactNode;
  /** Code, a token name, an id: the platform's monospace face. */
  mono?: boolean;
  /** Truncates to this many lines with an ellipsis. Show the full text somewhere else. */
  numberOfLines?: number;
  className?: string | undefined;
} & Pick<RNTextProps, 'accessibilityLabel' | 'accessibilityRole' | 'selectable' | 'nativeID'>;

/**
 * Text, on the mobile type scale. Display through Title 3 are headings, and a
 * screen reader hears them as headings.
 */
export function Text({
  variant,
  tone,
  weight,
  tabular,
  mono = false,
  className,
  children,
  accessibilityRole,
  ...props
}: TextProps): React.JSX.Element {
  const heading = variant != null && HEADINGS.has(variant);
  return (
    <CssText
      className={cn(textVariants({ variant, tone, weight, tabular }), className)}
      {...(mono ? { style: { fontFamily: MONO } } : {})}
      {...(accessibilityRole
        ? { accessibilityRole }
        : heading
          ? { accessibilityRole: 'header' as const }
          : {})}
      {...props}
    >
      {children}
    </CssText>
  );
}
