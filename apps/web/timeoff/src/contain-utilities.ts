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
 * inside anything placed straight under `<body>` that is not the host's own
 * page — which is where a dialog, a select's list or a toast is portalled.
 * `:where()` adds no specificity, so inside those places the cascade is
 * exactly what the remote's own build intended.
 *
 * The host's page is the element it marks `[data-remote-host]`, and failing
 * that, the one holding `[data-remote]`. The mark is what matters: the
 * stylesheet stays on the page after the host navigates away from the remote
 * (React keeps a stylesheet it has hoisted), and with no `[data-remote]` left
 * the host's whole page was "a portal" — its sidebar `hidden` again, on
 * Settings, until a reload dropped the stylesheet. A host that marks neither
 * matches the second arm everywhere, and gets the old behaviour rather than an
 * unstyled screen.
 *
 * And its plain utilities — a class and its declarations, no variant — sit
 * one level down, in `utilities.remote`. The shell compiled Reach, and this
 * build compiles the remote's own markup, so a class both use is in both: a
 * Reach control's `text-sm` with its `touch:text-md`. The shell's stylesheet
 * is on the page first, so this file's copy of `.text-sm` came after the
 * shell's `touch:text-md` and won, and Reach's phone layout was lost on every
 * People screen. A sublayer always loses to its parent's own rules, so a
 * plain utility here never beats one of the shell's, whatever the order;
 * the remote's variants stay where they were, after the shell's plain
 * utilities, so `@5xl/page:grid-cols-2` here still beats the shell's
 * `grid-cols-1`. That is the order one build would have: every plain utility
 * before every variant.
 *
 * A PostCSS plugin, written against the shape PostCSS hands it so that this
 * package does not depend on PostCSS itself; Vite runs it after Tailwind has
 * compiled `styles.css`.
 */
export const REMOTE_SCOPE =
  ':where([data-remote], body > :not([data-remote-host], :has([data-remote])))';

interface Node {
  readonly type: string;
  readonly name?: string;
  readonly params?: string;
  readonly parent?: Node | undefined;
}

interface Rule extends Node {
  selectors: string[];
  readonly selector?: string;
  readonly nodes?: readonly Node[] | undefined;
}

interface Container extends Node {
  readonly nodes?: readonly Node[] | undefined;
  // `never`: PostCSS's own nodes go in, whatever this file calls them.
  append(...nodes: never[]): unknown;
}

/** The sublayer this stylesheet's plain utilities move into, inside `utilities`. */
export const REMOTE_LAYER = 'remote';

/**
 * A plain utility: one class, scoped or not, and declarations only. Anything
 * else — a pseudo-class, a descendant, a nested `@media` or `&:hover` — is a
 * variant. Escapes are part of the class (`.w-1\/2`, `.min-h-9\.5`).
 */
export function isPlainUtility(rule: Rule): boolean {
  const selector = (rule.selector ?? rule.selectors.join(','))
    .replace(`${REMOTE_SCOPE} `, '')
    .trim();
  if (!/^\.(?:\\.|[\w-])+$/.test(selector)) return false;
  return (rule.nodes ?? []).every((node) => node.type === 'decl' || node.type === 'comment');
}

function inUtilities(rule: Rule): boolean {
  for (let node = rule.parent; node !== undefined; node = node.parent) {
    // A nested rule is scoped through the rule it sits in.
    if (node.type === 'rule') return false;
    if (node.type === 'atrule' && node.name === 'layer' && node.params === 'utilities') return true;
  }
  return false;
}

export function containUtilities(): {
  postcssPlugin: string;
  Rule: (rule: Rule) => void;
  // Method syntax: PostCSS hands its own `Root` and helpers, of which these
  // are the parts used.
  OnceExit(
    root: Container,
    helpers: { AtRule: new (props: { name: string; params: string }) => Container },
  ): void;
} {
  return {
    postcssPlugin: 'kithena-contain-utilities',
    OnceExit(root, { AtRule }) {
      for (const node of root.nodes ?? []) {
        const layer = node as Container;
        if (layer.type !== 'atrule' || layer.name !== 'layer' || layer.params !== 'utilities') {
          continue;
        }
        const plain = (layer.nodes ?? []).filter(
          (child): child is Rule => child.type === 'rule' && isPlainUtility(child as Rule),
        );
        if (plain.length === 0) continue;
        const sublayer = new AtRule({ name: 'layer', params: REMOTE_LAYER });
        // Appending moves each one, in order: the remote's own cascade is kept.
        sublayer.append(...(plain as never[]));
        layer.append(sublayer as never);
      }
    },
    Rule(rule) {
      if (!inUtilities(rule)) return;
      if (rule.selectors.every((s) => s.startsWith(REMOTE_SCOPE))) return;
      rule.selectors = rule.selectors.map((s) =>
        s.startsWith(REMOTE_SCOPE) ? s : `${REMOTE_SCOPE} ${s}`,
      );
    },
  };
}
