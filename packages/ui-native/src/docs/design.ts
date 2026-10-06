import design from '../../design/index.json';

type DesignComponent = { id: string; desc: string; stories: { name: string; note?: string }[] };

const components = new Map<string, DesignComponent>(
  Object.values(design as Record<string, DesignComponent[]>)
    .flat()
    .map((c) => [c.id, c]),
);

function find(id: string): DesignComponent {
  const found = components.get(id);
  if (!found) throw new Error(`No component "${id}" in packages/ui-native/design/index.json`);
  return found;
}

/**
 * A component's docs page description, from the design: the same sentence the
 * design states the component's job in. For a story file's `parameters`.
 */
export function designDocs(id: string): { docs: { description: { component: string } } } {
  return { docs: { description: { component: find(id).desc } } };
}

/**
 * `designDocs`, for a component whose stories open a modal overlay: on the docs
 * page each story renders in its own frame, because an open modal traps focus
 * and locks the scroll of whatever page it is on.
 */
export function overlayDocs(
  id: string,
  height = 640,
): {
  docs: {
    description: { component: string };
    story: { inline: false; iframeHeight: number };
  };
} {
  return { docs: { ...designDocs(id).docs, story: { inline: false, iframeHeight: height } } };
}

/**
 * A story's note from the design, when it has one, as the story's docs
 * description. Spread into a story's `parameters`.
 */
export function designNote(
  id: string,
  name: string,
): { docs?: { description: { story: string } } } {
  const note = find(id).stories.find((s) => s.name === name)?.note;
  return note ? { docs: { description: { story: note } } } : {};
}
