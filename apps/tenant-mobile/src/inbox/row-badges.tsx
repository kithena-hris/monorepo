import { Badge } from '@reach/ui-native';
import { View } from 'react-native';

import { dueOf, moduleName, type Item } from './model';

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
          New
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
            ? `For ${item.team.role.toLowerCase()}`
            : item.team.mine
              ? 'You are on it'
              : `${item.team.takenBy.name ?? 'Somebody'} is on it`}
        </Badge>
      )}
      {item.outcome === null ? null : (
        <Badge size="sm" tone={item.outcome.tone}>
          {item.outcome.label}
        </Badge>
      )}
      {item.replies > 0 ? (
        <Badge
          size="sm"
          tone="accent"
        >{`${String(item.replies)} repl${item.replies === 1 ? 'y' : 'ies'}`}</Badge>
      ) : null}
    </View>
  );
}
