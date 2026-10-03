import { PageHeader, Skeleton } from '@reach/ui';
import type { ComponentType, JSX } from 'react';

/**
 * A screen not built yet: its own title, under the host's frame (the trail
 * Time off › section, the section's tabs, the actions), over a skeleton of
 * the body. The header is the real one, so the screen that replaces this
 * moves nothing above its body. TOF-061 onwards replace these one by one.
 */
export function placeholder(title: string): ComponentType<object> {
  function Placeholder(): JSX.Element {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={title} />
        <Skeleton shape="body" label={`Loading ${title}`} />
      </div>
    );
  }
  Placeholder.displayName = `Placeholder(${title})`;
  return Placeholder;
}
