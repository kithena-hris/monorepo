import { Text as CssText } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';

/**
 * A setting read as one sentence, its choices highlighted inside it: "HR
 * fills it in. The employee and HR can see it." Each highlighted part is a
 * button that opens its choices; the caller draws them under the sentence,
 * and the sentence rewrites itself as they change. A form's four steps become
 * one line somebody can read back.
 */

export type SentencePart =
  | string
  | {
      /** Which choice it is, handed back on a press. */
      id: string;
      text: string;
      /** Its choices are open now. */
      active?: boolean;
      /** Fixed: highlighted, but nothing to change. */
      disabled?: boolean;
    };

export type SentenceProps = {
  parts: readonly SentencePart[];
  onPartPress?: (id: string) => void;
  /** 19 by default: a sentence somebody reads, not a label. */
  size?: 'md' | 'lg';
  className?: string | undefined;
};

export function Sentence({
  parts,
  onPartPress,
  size = 'lg',
  className,
}: SentenceProps): React.JSX.Element {
  return (
    <CssText
      className={cn(
        'text-fg',
        size === 'lg' ? 'text-[19px] leading-[1.75]' : 'text-callout leading-[1.6]',
        className,
      )}
    >
      {parts.map((part, i) =>
        typeof part === 'string' ? (
          part
        ) : (
          <CssText
            key={`${part.id}-${String(i)}`}
            accessibilityRole="button"
            accessibilityState={{
              expanded: part.active === true,
              disabled: part.disabled === true,
            }}
            {...(part.disabled || !onPartPress
              ? {}
              : {
                  onPress: () => {
                    onPartPress(part.id);
                  },
                })}
            className={cn(
              'font-semibold',
              part.active ? 'bg-accent-solid text-fg-on-accent' : 'bg-accent-subtle text-accent-fg',
            )}
          >
            {` ${part.text} `}
          </CssText>
        ),
      )}
    </CssText>
  );
}
