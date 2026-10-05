import { View } from 'react-native-css/components';

import { Card } from '../components/card/card.tsx';
import { Separator } from '../components/separator/separator.tsx';
import { Text, type TextProps } from '../components/text/text.tsx';

/** The mobile type scale as the design tabulates it: the style, its size over line height, its use. */
const SCALE: readonly [NonNullable<TextProps['variant']>, string, string, string][] = [
  ['display', 'Display', '52px/1', 'Hero numbers'],
  ['large', 'Large title', '34px/41px', 'Top-level screens'],
  ['title1', 'Title 1', '28px/34px', 'Detail screens'],
  ['title2', 'Title 2', '22px/28px', 'Sheet titles'],
  ['title3', 'Title 3', '20px/25px', 'Card titles'],
  ['headline', 'Headline', '17px/22px', 'Row titles'],
  ['body', 'Body', '17px/22px', 'Default'],
  ['callout', 'Callout', '16px/21px', 'Secondary body'],
  ['subhead', 'Subhead', '15px/20px', 'Subtitles'],
  ['footnote', 'Footnote', '13px/18px', 'Group labels'],
  ['caption', 'Caption', '12px/16px', 'Badges'],
];

/** For the Tokens and Typography pages, which show the same scale. */
export function TypeTable(): React.JSX.Element {
  return (
    <Card>
      {SCALE.map(([variant, name, spec, use], i) => (
        <View key={variant}>
          {i > 0 ? <Separator /> : null}
          <View className="flex-row items-end gap-4 py-3">
            <Text variant={variant} numberOfLines={1} className="flex-1" accessibilityRole="text">
              {name}
            </Text>
            <View className="items-end">
              <Text variant="caption" mono>
                {spec}
              </Text>
              <Text variant="caption" weight="regular" tone="muted">
                {use}
              </Text>
            </View>
          </View>
        </View>
      ))}
    </Card>
  );
}
