/**
 * Keep this remote's utilities off the host's own chrome.
 *
 * The remote ships a Tailwind build of its own (`styles.css`), and it joins
 * the host's `utilities` layer so the two read as one stylesheet. They are
 * not one: this build arrives later, so its copy of a class the host also
 * uses — `hidden`, `flex`, `block` — lands after the host's responsive
 * variants of it, and wins. The host's sidebar is `hidden md:flex`; with this
 * stylesheet on the page it stayed hidden at every width, and every People
 * screen looked like a page of its own with no Kithena around it.
 *
 * So every rule in the utilities layer is limited to the remote's own
 * markup: inside the element the host renders it into (`[data-remote]`), or
 * inside anything placed straight under `<body>` that does not hold the
 * remote — which is where a dialog, a select's list or a toast is portalled.
 * `:where()` adds no specificity, so inside those places the cascade is
 * exactly what the remote's own build intended. A host that marks no
 * `[data-remote]` matches the second arm everywhere, and gets the old
 * behaviour rather than an unstyled screen.
 *
 * A PostCSS plugin, written against the shape PostCSS hands it so that this
 * package does not depend on PostCSS itself; Vite runs it after Tailwind has
 * compiled `styles.css`.
 */
export const REMOTE_SCOPE = ':where([data-remote], body > :not(:has([data-remote])))';

interface Node {
  readonly type: string;
  readonly name?: string;
  readonly params?: string;
  readonly parent?: Node | undefined;
}

interface Rule extends Node {
  selectors: string[];
}

function inUtilities(rule: Rule): boolean {
  for (let node = rule.parent; node !== undefined; node = node.parent) {
    // A nested rule is scoped through the rule it sits in.
    if (node.type === 'rule') return false;
    if (node.type === 'atrule' && node.name === 'layer' && node.params === 'utilities') return true;
  }
  return false;
}

export function containUtilities(): { postcssPlugin: string; Rule: (rule: Rule) => void } {
  return {
    postcssPlugin: 'kithena-contain-utilities',
    Rule(rule) {
      if (!inUtilities(rule)) return;
      if (rule.selectors.every((s) => s.startsWith(REMOTE_SCOPE))) return;
      rule.selectors = rule.selectors.map((s) =>
        s.startsWith(REMOTE_SCOPE) ? s : `${REMOTE_SCOPE} ${s}`,
      );
    },
  };
}
