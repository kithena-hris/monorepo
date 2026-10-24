import { Badge } from '@reach/ui-native';
import { View } from 'react-native';

import { dueOf, moduleName, type Item } from './model';
import { t } from '../i18n';

/** The badges under a row: where it lives, when it is due, where it stands. */
export function RowBadges({
  item,
  now,
  zone,
}: {
  item: Item;
  now: string;
  zone: string;
}): React.JSX.Element {
  const due = item.lane === 'task' || item.lane === 'request' ? dueOf(item, now, zone) : null;
  return (
    <View className="mt-1 flex-row flex-wrap gap-1.5">
      {item.unread ? (
        <Badge size="sm" tone="accent" variant="solid">
          {t('inbox.row-badges.new', 'New')}
        </Badge>
      ) : null}
      <Badge size="sm" variant="outline">
        {item.area === null ? moduleName(item.module) : `${moduleName(item.module)} › ${item.area}`}
      </Badge>
      {due === null ? null : (
        <Badge size="sm" tone={due.tone}>
          {due.label}
        </Badge>
      )}
      {item.status === null ? null : (
        <Badge size="sm" tone={item.status.tone} dot>
          {item.status.label}
        </Badge>
      )}
      {item.team === null ? null : (
        <Badge size="sm" tone={item.team.takenBy === null ? 'warning' : 'info'} dot>
          {item.team.takenBy === null
            ? t('inbox.row-badges.for', 'For {{toLowerCase}}', {
                toLowerCase: item.team.role.toLowerCase(),
              })
            : item.team.mine
              ? t('inbox.row-badges.you_are_on_it', 'You are on it')
              : t('inbox.row-badges.is_on_it', '{{value}} is on it', {
                  value: item.team.takenBy.name ?? 'Somebody',
                })}
        </Badge>
      )}
      {item.outcome === null ? null : (
        <Badge size="sm" tone={item.outcome.tone}>
          {item.outcome.label}
        </Badge>
      )}
      {item.replies > 0 ? (
        <Badge size="sm" tone="accent">
          {t(
            'inbox.row-badges.repl',
            { one: '{{count}} reply', other: '{{count}} replies' },
            { count: item.replies },
          )}
        </Badge>
      ) : null}
    </View>
  );
}
