import { View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { Checkbox } from '../checkbox/checkbox.tsx';
import { Text } from '../text/text.tsx';
import { t } from '../../lib/i18n';

/**
 * Who can see a value and who can change it, as one table of checkboxes:
 * the web's `AccessMatrix`, under a thumb. Same names and props.
 *
 * What is ticked follows from the value alone. Changing always includes
 * seeing, so a Change tick ticks and locks the See box beside it; `allSee`
 * ticks and locks every See box. A locked box says why in its name.
 */
export interface AccessAudience {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  /** False where changing makes no sense. */
  readonly canChange?: boolean;
}

export interface AccessValue {
  readonly see: readonly string[];
  readonly change: readonly string[];
}

export type AccessColumn = 'see' | 'change';

/** The next value after pressing one box: the web's rule, kept here so this package stays its own. */
export function toggleAccess(value: AccessValue, id: string, column: AccessColumn): AccessValue {
  const has = (list: readonly string[]) => list.includes(id);
  const without = (list: readonly string[]) => list.filter((x) => x !== id);
  if (column === 'change') {
    return has(value.change)
      ? { see: value.see, change: without(value.change) }
      : { see: has(value.see) ? value.see : [...value.see, id], change: [...value.change, id] };
  }
  if (has(value.change)) return value;
  return has(value.see)
    ? { see: without(value.see), change: value.change }
    : { see: [...value.see, id], change: value.change };
}

export interface AccessMatrixProps {
  readonly audiences: readonly AccessAudience[];
  readonly value: AccessValue;
  /** Leave out for a read-only table. */
  readonly onChange?: (next: AccessValue) => void;
  /** Everybody can see it: every See box is ticked and locked, `value.see` kept for when it is off. */
  readonly allSee?: boolean;
  readonly allSeeReason?: string;
  readonly seeLabel?: string;
  readonly changeLabel?: string;
  readonly className?: string | undefined;
}

export function AccessMatrix({
  audiences,
  value,
  onChange,
  allSee = false,
  allSeeReason = 'because everyone can see it',
  seeLabel = t('components.access-matrix.access-matrix.see', 'See'),
  changeLabel = t('components.access-matrix.access-matrix.change', 'Change'),
  className,
}: AccessMatrixProps): React.JSX.Element {
  const press = (id: string, column: AccessColumn) => (): void => {
    onChange?.(toggleAccess(value, id, column));
  };
  return (
    <View className={cn('overflow-hidden rounded-2xl border border-border', className)}>
      <View className="flex-row items-center bg-surface-sunken px-3 py-2.5">
        <Text variant="caption" weight="semibold" tone="muted" className="flex-1">
          {t('components.access-matrix.access-matrix.group', 'Group')}
        </Text>
        <Text variant="caption" weight="semibold" tone="muted" className="w-14 text-center">
          {seeLabel}
        </Text>
        <Text variant="caption" weight="semibold" tone="muted" className="w-16 text-center">
          {changeLabel}
        </Text>
      </View>
      {audiences.map((a) => {
        const change = value.change.includes(a.id);
        const see = allSee || change || value.see.includes(a.id);
        const why = allSee ? allSeeReason : change ? 'because they can change it' : null;
        return (
          <View
            key={a.id}
            className="min-h-13 flex-row items-center border-t border-border px-3 py-1"
          >
            <View className="flex-1 gap-0.5">
              <Text weight="semibold">{a.label}</Text>
              {a.description === undefined ? null : (
                <Text variant="footnote" tone="muted">
                  {a.description}
                </Text>
              )}
            </View>
            <View className="w-14 items-center">
              <Checkbox
                checked={see}
                disabled={onChange === undefined || why !== null}
                accessibilityLabel={t(
                  'components.access-matrix.access-matrix.can',
                  '{{label}} can {{toLowerCase}}{{value}}',
                  {
                    label: a.label,
                    toLowerCase: seeLabel.toLowerCase(),
                    value: why === null ? '' : `, ${why}`,
                  },
                )}
                onCheckedChange={press(a.id, 'see')}
              />
            </View>
            <View className="w-16 items-center">
              {a.canChange === false ? null : (
                <Checkbox
                  checked={change}
                  disabled={onChange === undefined}
                  accessibilityLabel={t(
                    'components.access-matrix.access-matrix.can_2',
                    '{{label}} can {{toLowerCase}}',
                    { label: a.label, toLowerCase: changeLabel.toLowerCase() },
                  )}
                  onCheckedChange={press(a.id, 'change')}
                />
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}
