/**
 * The Reach documentation site.
 *
 * Built out of Reach. Every piece of chrome on this page, the sidebar, the
 * Preview/Code tabs, the search box, the copy buttons, the keyboard hints, is a
 * component from `@reach/ui` used the way an application would use it. That is
 * the point: a design system whose own documentation is hand-rolled markup is a
 * system nobody has tried to build anything with. When a control here is
 * awkward to compose, that is a finding about the system, not about this file.
 *
 * Nothing in this application modifies the design system or Storybook. It
 * imports the published surface and the shipped stylesheet, and that is all.
 */

import {
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  CopyButton,
  Kbd,
  ReachLogo,
  ScrollArea,
  Separator,
  icons,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipProvider,
} from '@reach/ui';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';

import { PRINCIPLES, STORYBOOK_URL, STORY_COUNT } from './content';
import { CommandPalette, type CommandItem } from './command-palette';
import { Highlighted } from './highlight';
import {
  NAV,
  ORDERED_SLUGS,
  PAGES,
  pageBySlug,
  titleFor,
  type DocPage,
  type Section,
} from './registry';

/** From the system's own registry, not lucide directly. */
const SearchIcon = icons.search;

/* ------------------------------------------------------------------ theme -- */

/**
 * The same mechanism an application uses: a class on `<html>`, nothing more.
 * The docs site is not allowed a private way of switching themes, because then
 * it would be proving that a private mechanism works.
 */
function useTheme(): readonly ['light' | 'dark', () => void] {
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    globalThis.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  return [theme, toggle] as const;
}

/* ---------------------------------------------------------------- routing -- */

/**
 * Hash routing, with no router.
 *
 * A dependency would buy history entries this site does not need: every page is
 * a document, the hash already gives a real URL that survives a reload and a
 * paste into Slack, and `hashchange` is the whole API. Adding a router to a
 * static reference site is the kind of thing that turns a 40kB page into a
 * 140kB one for no reader-visible gain.
 */
/** Where the reader is: which page, and optionally which section of it. */
interface Route {
  readonly slug: string;
  readonly section?: string;
}

/**
 * The hash carries both the page and the section: `#/button/sizes`.
 *
 * It has to. With the page in the hash, a plain `href="#sizes"` is not a
 * fragment link at all, it is a *route change* to a page called "sizes", and
 * the table of contents silently navigated away instead of scrolling. Nesting
 * the section inside the route is what makes the two coexist, and it hands
 * every section a real URL that survives a reload and a paste into Slack.
 */
function readRoute(): Route {
  const [slug = '', section] = globalThis.location.hash.replace(/^#\/?/, '').split('/');
  return { slug: slug || 'introduction', ...(section ? { section } : {}) };
}

/**
 * Scrolls a section into view.
 *
 * `scrollIntoView` rather than arithmetic on `offsetTop`: the CSS
 * `scroll-padding-top` on `<html>` already states how far the sticky header
 * intrudes, and the browser honours it here. Computing the offset by hand would
 * duplicate that number and the two would drift.
 */
function scrollToSection(id: string): void {
  document.getElementById(id)?.scrollIntoView({ block: 'start' });
}

function useRoute(): readonly [Route, (slug: string, section?: string) => void] {
  const [route, setRoute] = useState<Route>(readRoute);

  useEffect(() => {
    const onChange = (): void => {
      const next = readRoute();
      setRoute((current) => {
        /*
         * A new page starts at its own top; a new section within the page
         * scrolls to that section. Scrolling to the top on a section change
         * would undo the very jump the reader just asked for.
         */
        if (next.slug !== current.slug) globalThis.scrollTo({ top: 0 });
        else if (next.section) scrollToSection(next.section);
        return next;
      });
    };
    globalThis.addEventListener('hashchange', onChange);
    return () => {
      globalThis.removeEventListener('hashchange', onChange);
    };
  }, []);

  /*
   * A deep link arrives with the section already in the hash, and the element it
   * names does not exist until after the first paint.
   *
   * The hash is read inside the effect rather than closed over from `route`, so
   * the empty dependency list is honest: there is nothing from the render to go
   * stale. Later section changes are handled by `hashchange` above.
   */
  useEffect(() => {
    const { section } = readRoute();
    if (section) scrollToSection(section);
  }, []);

  const go = useCallback((slug: string, section?: string) => {
    globalThis.location.hash = section ? `/${slug}/${section}` : `/${slug}`;
  }, []);

  return [route, go] as const;
}

/**
 * The sticky header's height, in pixels.
 *
 * `rootMargin` accepts only pixels and percentages, so the header's `3.5rem`
 * has to be resolved here. Computed from the root font size rather than written
 * as `56px`, because the whole system sizes in rem precisely so a reader who
 * raises their browser's text size gets a taller header, and a hardcoded
 * pixel inset would leave the highlight a heading behind for exactly them.
 */
function headerOffsetPx(): number {
  const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return 3.5 * (Number.isFinite(root) && root > 0 ? root : 16);
}

/**
 * Which section the reader is currently in.
 *
 * `IntersectionObserver`, never a scroll handler: a scroll listener runs on the
 * main thread for every frame of a flick and then does arithmetic that is wrong
 * the moment the page has a sticky header.
 *
 * The `rootMargin` is the whole trick. Its top inset clears the sticky header so
 * a heading hidden behind the bar does not count as visible, and its bottom
 * inset of -70% narrows the observation band to a strip near the top of the
 * viewport. Without that strip, three sections are "intersecting" at once on a
 * tall screen and the highlight flickers between them; with it, the active
 * section is whichever heading most recently crossed the reading line.
 */
function useActiveSection(ids: readonly string[]): string | undefined {
  const [active, setActive] = useState<string | undefined>(ids[0]);

  useEffect(() => {
    if (ids.length === 0) return;
    setActive(ids[0]);

    const seen = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) seen.set(entry.target.id, entry.isIntersecting);
        // Document order, so the first one inside the band wins rather than
        // whichever happened to fire last.
        const current = ids.find((id) => seen.get(id));
        if (current) setActive(current);
      },
      { rootMargin: `-${String(headerOffsetPx())}px 0px -70% 0px`, threshold: 0 },
    );

    for (const id of ids) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => {
      observer.disconnect();
    };
  }, [ids]);

  /*
   * The last section can never reach the band on a short page, so the reader
   * would scroll to the bottom and watch the highlight stay one entry behind.
   * At the end of the document, the end of the list is the honest answer.
   */
  useEffect(() => {
    const onScroll = (): void => {
      const atBottom =
        globalThis.innerHeight + globalThis.scrollY >= document.body.scrollHeight - 2;
      if (atBottom && ids.length > 0) setActive(ids[ids.length - 1]);
    };
    globalThis.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      globalThis.removeEventListener('scroll', onScroll);
    };
  }, [ids]);

  return active;
}

/* ------------------------------------------------------------------ atoms -- */

/** Inline code. A `<code>` with the system's mono stack, nothing more. */
function Tt({ children }: { children: ReactNode }): JSX.Element {
  return (
    <code className="rounded-xs bg-surface-sunken px-1 py-0.5 font-mono text-[0.85em] text-fg">
      {children}
    </code>
  );
}

/**
 * A prose paragraph with backtick spans honoured.
 *
 * Deliberately not a markdown dependency. The only syntax this site uses in a
 * body string is a code span, and parsing exactly that is nine lines.
 */
function Prose({ children }: { children: string }): JSX.Element {
  const parts = children.split(/(`[^`]+`)/g);
  return (
    <p className="text-base leading-relaxed text-fg-muted">
      {parts.map((part, index) =>
        part.startsWith('`') && part.endsWith('`') ? (
          <Tt key={index}>{part.slice(1, -1)}</Tt>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </p>
  );
}

/**
 * A code block with a copy button.
 *
 * `CopyButton` rather than a hand-written one: it owns the clipboard fallback,
 * the copied/failed states and the timer that resets them, and it is the
 * component an application would reach for here.
 */
function CodeBlock({ code, label = 'Copy code' }: { code: string; label?: string }): JSX.Element {
  return (
    <div className="group relative">
      <pre className="dc-code overflow-x-auto rounded-md border border-border p-4 pe-14 text-sm leading-relaxed">
        <code className="font-mono">
          <Highlighted code={code} />
        </code>
      </pre>
      <div className="absolute end-2 top-2">
        <CopyButton value={code} label={label} size="sm" variant="ghost" tooltip />
      </div>
    </div>
  );
}

/**
 * One documented example: the live component, and the source that made it.
 *
 * The two panels are a `Tabs`, which is the same component a module would use
 * for peer views of one subject, and that is exactly what a preview and its
 * source are.
 */
function Example({ section }: { section: Section }): JSX.Element {
  // Rendered as an element, not called. `section.render` is a component and may
  // hold state, which is the only way to show a controlled input working.
  const Demo = section.render;
  return (
    <section id={section.id} aria-labelledby={`${section.id}-heading`} className="scroll-mt-20">
      <h3 id={`${section.id}-heading`} className="text-lg font-semibold tracking-tight text-fg">
        {section.title}
      </h3>
      {section.blurb ? (
        <div className="mt-1.5">
          <Prose>{section.blurb}</Prose>
        </div>
      ) : null}

      <Tabs defaultValue="preview" className="mt-4">
        <TabsList>
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="code">Code</TabsTrigger>
        </TabsList>

        <TabsContent value="preview">
          <div
            className={[
              'flex items-center justify-center rounded-md border border-border bg-surface px-6',
              // Wide examples scroll rather than clip. A Kanban board or an org
              // chart is legitimately wider than the reading column, and a
              // preview that silently cuts the last column is showing something
              // the component does not do.
              'overflow-x-auto',
              // A layered example needs room for the layer to land in.
              section.tall ? 'min-h-64 py-10' : 'min-h-36 py-8',
            ].join(' ')}
          >
            <Demo />
          </div>
        </TabsContent>

        <TabsContent value="code">
          <CodeBlock code={section.code} label={`Copy the ${section.title} example`} />
        </TabsContent>
      </Tabs>
    </section>
  );
}

/* ------------------------------------------------------------------ pages -- */

function ComponentPage({ page }: { page: DocPage }): JSX.Element {
  return (
    <>
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-fg">{page.title}</h1>
        <p className="mt-2 text-lg text-fg-muted">{page.description}</p>
      </header>

      {page.when ? (
        <div className="mt-6 rounded-md border border-border border-s-2 border-s-accent bg-surface px-4 py-3">
          <p className="text-2xs font-medium tracking-wider text-fg-subtle uppercase">
            When to use it
          </p>
          <div className="mt-1.5">
            <Prose>{page.when}</Prose>
          </div>
        </div>
      ) : null}

      <section
        id="installation"
        aria-labelledby="installation-heading"
        className="mt-10 scroll-mt-20"
      >
        <h2 id="installation-heading" className="text-xl font-semibold tracking-tight text-fg">
          Import
        </h2>
        <div className="mt-3">
          <CodeBlock code={page.importLine} label="Copy the import" />
        </div>
      </section>

      <div className="mt-10 space-y-10">
        {page.sections.map((section) => (
          <Example key={section.id} section={section} />
        ))}
      </div>

      {page.props ? (
        <section id="api" aria-labelledby="api-heading" className="mt-12 scroll-mt-20">
          <h2 id="api-heading" className="text-xl font-semibold tracking-tight text-fg">
            API reference
          </h2>
          <div className="mt-4 overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Prop</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Default</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.props.map((row) => (
                  <TableRow key={row.name}>
                    <TableCell>
                      <Tt>{row.name}</Tt>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs text-fg-muted">{row.type}</span>
                    </TableCell>
                    <TableCell>
                      {row.default ? (
                        <span className="font-mono text-xs text-fg-muted">{row.default}</span>
                      ) : (
                        <span className="text-fg-subtle">—</span>
                      )}
                    </TableCell>
                    <TableCell>{row.description}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}
    </>
  );
}

function IntroductionPage(): JSX.Element {
  return (
    <>
      <header>
        <Badge tone="accent">Design system</Badge>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-balance text-fg">
          One vocabulary, twenty products
        </h1>
        <p className="mt-3 text-lg text-fg-muted">
          Reach is the design system behind a headless, module-per-service HRIS. Every module has to
          be sellable on its own, so the system has to hold a product together that ships in pieces.
        </p>
      </header>

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {[
          { figure: String(PAGES.length), label: 'reference pages, every example live' },
          { figure: String(STORY_COUNT), label: 'stories, each rendered and axe-checked' },
          { figure: '2', label: 'themes, from one set of semantic tokens' },
        ].map((stat) => (
          <div key={stat.label} className="rounded-md border border-border bg-surface px-4 py-3">
            <p className="text-2xl font-semibold tabular-nums text-fg">{stat.figure}</p>
            <p className="mt-0.5 text-sm text-fg-muted">{stat.label}</p>
          </div>
        ))}
      </div>

      <section id="principles" aria-labelledby="principles-heading" className="mt-12 scroll-mt-20">
        <h2 id="principles-heading" className="text-xl font-semibold tracking-tight text-fg">
          Principles
        </h2>
        <div className="mt-4 space-y-5">
          {PRINCIPLES.map((principle) => (
            <div key={principle.title}>
              <h3 className="text-base font-medium text-fg">{principle.title}</h3>
              <div className="mt-1">
                <Prose>{principle.body}</Prose>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="storybook" aria-labelledby="storybook-heading" className="mt-12 scroll-mt-20">
        <h2 id="storybook-heading" className="text-xl font-semibold tracking-tight text-fg">
          Storybook
        </h2>
        <div className="mt-2">
          <Prose>
            This site documents the shape of the system. Storybook holds every state of every
            component, and axe runs over each one as a merge gate.
          </Prose>
        </div>
        <div className="mt-4">
          <Button asChild variant="secondary">
            <a href={STORYBOOK_URL} target="_blank" rel="noopener noreferrer">
              Open Storybook
            </a>
          </Button>
        </div>
      </section>
    </>
  );
}

function InstallationPage(): JSX.Element {
  return (
    <>
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-fg">Installation</h1>
        <p className="mt-2 text-lg text-fg-muted">
          Reach ships TypeScript source, not build output.
        </p>
      </header>

      <section id="add" aria-labelledby="add-heading" className="mt-10 scroll-mt-20">
        <h2 id="add-heading" className="text-xl font-semibold tracking-tight text-fg">
          Add the package
        </h2>
        <div className="mt-3">
          <CodeBlock code={`pnpm add @reach/ui`} />
        </div>
      </section>

      <section id="stylesheet" aria-labelledby="stylesheet-heading" className="mt-10 scroll-mt-20">
        <h2 id="stylesheet-heading" className="text-xl font-semibold tracking-tight text-fg">
          Import the stylesheet
        </h2>
        <div className="mt-2">
          <Prose>
            One import brings the tokens, the Tailwind theme and the base layer. Nothing else needs
            configuring.
          </Prose>
        </div>
        <div className="mt-3">
          <CodeBlock code={`@import '@reach/ui/styles.css';`} />
        </div>
      </section>

      <section id="compile" aria-labelledby="compile-heading" className="mt-10 scroll-mt-20">
        <h2 id="compile-heading" className="text-xl font-semibold tracking-tight text-fg">
          Compile the source
        </h2>
        <div className="mt-2">
          <Prose>
            Because the package ships source, the consuming app compiles it. Next needs it named in
            `transpilePackages`; Vite compiles it with no configuration at all.
          </Prose>
        </div>
        <div className="mt-3">
          <CodeBlock
            code={`// next.config.ts
export default {
  transpilePackages: ['@reach/ui'],
};`}
          />
        </div>
      </section>
    </>
  );
}

function ThemingPage(): JSX.Element {
  return (
    <>
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-fg">Theming</h1>
        <p className="mt-2 text-lg text-fg-muted">
          Two layers, and the distinction is the whole design.
        </p>
      </header>

      <section id="layers" aria-labelledby="layers-heading" className="mt-10 scroll-mt-20">
        <h2 id="layers-heading" className="text-xl font-semibold tracking-tight text-fg">
          Primitives and semantics
        </h2>
        <div className="mt-2 space-y-3">
          <Prose>
            Primitives are raw values and no component may touch one. Semantic tokens are what a
            component is allowed to use, so renaming a primitive costs nothing and renaming a
            semantic token is a breaking change you can find.
          </Prose>
          <Prose>
            Theming re-points the semantic layer at different primitives. A component never learns
            which theme it is in.
          </Prose>
        </div>
        <div className="mt-4">
          <CodeBlock
            code={`/* Never this */
<div className="bg-neutral-100" />

/* This */
<div className="bg-surface-sunken" />`}
          />
        </div>
      </section>

      <section id="dark" aria-labelledby="dark-heading" className="mt-10 scroll-mt-20">
        <h2 id="dark-heading" className="text-xl font-semibold tracking-tight text-fg">
          Dark mode
        </h2>
        <div className="mt-2">
          <Prose>
            {'A class on `<html>`. Dark is not an inversion: surfaces lift as they come forward, ' +
              'borders stay low-contrast, and accents shift lighter to hold AA on a dark background.'}
          </Prose>
        </div>
        <div className="mt-4">
          <CodeBlock code={`document.documentElement.classList.toggle('dark', isDark);`} />
        </div>
      </section>

      <section id="density" aria-labelledby="density-heading" className="mt-10 scroll-mt-20">
        <h2 id="density-heading" className="text-xl font-semibold tracking-tight text-fg">
          Density is a property of the pointer
        </h2>
        <div className="mt-2">
          <Prose>
            Control heights come from `--reach-control-*`, which a coarse pointer re-points to the
            44px tap floor. A component never asks how wide the window is, because no media feature
            separates a 1920px television from a 1920px monitor.
          </Prose>
        </div>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ shell -- */

/** Headings a page exposes, for the right-hand rail. */
function tocFor(slug: string, page: DocPage | undefined): readonly { id: string; title: string }[] {
  if (page) {
    return [
      { id: 'installation', title: 'Import' },
      ...page.sections.map((section) => ({ id: section.id, title: section.title })),
      ...(page.props ? [{ id: 'api', title: 'API reference' }] : []),
    ];
  }
  const staticToc: Record<string, readonly { id: string; title: string }[]> = {
    introduction: [
      { id: 'principles', title: 'Principles' },
      { id: 'storybook', title: 'Storybook' },
    ],
    installation: [
      { id: 'add', title: 'Add the package' },
      { id: 'stylesheet', title: 'Import the stylesheet' },
      { id: 'compile', title: 'Compile the source' },
    ],
    theming: [
      { id: 'layers', title: 'Primitives and semantics' },
      { id: 'dark', title: 'Dark mode' },
      { id: 'density', title: 'Density is a property of the pointer' },
    ],
  };
  return staticToc[slug] ?? [];
}

export function App(): JSX.Element {
  const [theme, toggleTheme] = useTheme();
  const [route, go] = useRoute();
  const slug = route.slug;

  const page = pageBySlug(slug);
  const toc = useMemo(() => tocFor(slug, page), [slug, page]);
  // A stable array identity, or the observer is disconnected and rebuilt on
  // every render and never lives long enough to report anything.
  const tocIds = useMemo(() => toc.map((entry) => entry.id), [toc]);
  const activeSection = useActiveSection(tocIds);

  /*
   * Keep the current page visible in the rail.
   *
   * The sidebar is seventy entries in a viewport that shows about twenty, so
   * arriving on a page from the palette, from prev/next, or from a pasted link
   * usually lands with the highlighted entry somewhere off screen, and the rail
   * silently stops telling the reader where they are.
   *
   * `block: 'nearest'` scrolls the minimum needed, which matters here for a
   * second reason: the rail is inside a sticky full-height column, so a
   * `'center'` would also scroll the *document* to satisfy the request and the
   * page would jump under the reader.
   */
  const railRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const current = railRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!current) return;

    /*
     * Scroll the rail's own viewport rather than calling `scrollIntoView`.
     *
     * `scrollIntoView` walks up and scrolls every scrollable ancestor, and the
     * rail sits inside a sticky full-height column, so asking for the item at
     * the top of the rail also scrolls the *document* and the page jumps under
     * the reader. Setting `scrollTop` on the viewport moves one element and
     * cannot touch the page.
     *
     * The group heading above the item is included in the offset, so the item
     * arrives under its own heading rather than with the heading pushed off.
     */
    const viewport = current.closest<HTMLElement>('[data-radix-scroll-area-viewport]');
    if (!viewport) return;

    /*
     * Measured from rects, not `offsetTop`, which is relative to whichever
     * ancestor happens to be positioned and would silently change meaning if a
     * wrapper ever gained `relative`.
     *
     * The 12px is breathing room, so the item sits just below the rail's top
     * edge rather than flush against it.
     */
    const item = current.getBoundingClientRect();
    const view = viewport.getBoundingClientRect();
    viewport.scrollTo({
      top: Math.max(0, viewport.scrollTop + (item.top - view.top) - 12),
      behavior: 'smooth',
    });
  }, [slug]);

  /*
   * Where the travelling marker sits, measured rather than derived.
   *
   * Entry heights are not uniform, a long section title wraps to two lines, so
   * the marker's position cannot be computed from the index. `offsetTop` and
   * `offsetHeight` are already in the list's coordinate space, and unlike a
   * client rect they do not move when the rail itself scrolls.
   */
  const tocRef = useRef<HTMLUListElement>(null);
  const [marker, setMarker] = useState<{ top: number; height: number } | null>(null);

  useEffect(() => {
    const list = tocRef.current;
    if (!list) return;
    const current = list.querySelector<HTMLElement>('[aria-current]');
    setMarker(current ? { top: current.offsetTop, height: current.offsetHeight } : null);
  }, [activeSection, toc]);

  const index = ORDERED_SLUGS.indexOf(slug);
  const previous = index > 0 ? ORDERED_SLUGS[index - 1] : undefined;
  const next =
    index >= 0 && index < ORDERED_SLUGS.length - 1 ? ORDERED_SLUGS[index + 1] : undefined;

  /*
   * ⌘K opens the palette.
   *
   * `preventDefault` matters on both branches: the browser's own find-in-page
   * is on ⌘K in some builds, and Ctrl+K is "delete to end of line" in a text
   * field on macOS, so letting the event through means the shortcut sometimes
   * works and sometimes eats the reader's input.
   */
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      /*
       * `event.code` as well as `event.key`.
       *
       * `code` names the physical key and is unaffected by the layout, while
       * `key` is the character that layout produces. On a Mac with a non-QWERTY
       * or non-Latin layout, ⌘ plus the K key can arrive with a `key` that is
       * not "k" at all, and the shortcut silently stops existing for exactly
       * the people least likely to guess why.
       *
       * `stopPropagation` alongside `preventDefault` because Firefox binds
       * ⌘K/Ctrl+K to its own search bar and Chrome to the omnibox; letting the
       * event continue means the palette opens *and* the browser's search takes
       * focus, which is worse than either alone.
       */
      const isK = event.code === 'KeyK' || event.key.toLowerCase() === 'k';
      if (isK && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        event.stopPropagation();
        setPaletteOpen((current) => !current);
      }
      // `/` is the other muscle memory, but only when the reader is not
      // already typing into something.
      if (
        event.key === '/' &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement)
      ) {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    globalThis.addEventListener('keydown', onKey);
    return () => {
      globalThis.removeEventListener('keydown', onKey);
    };
  }, []);

  /** Every page, flattened, with the group it sits under for disambiguation. */
  const commandItems = useMemo<readonly CommandItem[]>(
    () =>
      NAV.flatMap((group) =>
        group.slugs.map((item) => ({ slug: item, title: titleFor(item), group: group.title })),
      ),
    [],
  );

  return (
    <TooltipProvider>
      <div className="min-h-dvh bg-canvas text-fg">
        {/*
          Not `href="#content"`. With the page in the hash that reads as a route
          change to a page called "content", and the skip link navigated away.
          Moving focus is the better behaviour anyway: a skip link that only
          scrolls leaves the keyboard where it was, so the next Tab starts from
          the header again.
        */}
        <a
          href="#/"
          onClick={(event) => {
            event.preventDefault();
            const main = document.getElementById('content');
            main?.focus();
            main?.scrollIntoView({ block: 'start' });
          }}
          className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-fg focus:shadow-md"
        >
          Skip to content
        </a>

        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          items={commandItems}
          onSelect={go}
        />

        {/* ------------------------------------------------------- top bar -- */}
        <header
          data-material="chrome"
          className="sticky top-0 z-40 border-b border-border bg-surface/85 backdrop-blur-material backdrop-saturate-(--reach-material-saturate) supports-[backdrop-filter]:bg-surface/70"
        >
          <div className="mx-auto flex h-14 max-w-[100rem] items-center gap-3 px-4">
            <a
              href="#/introduction"
              className="flex items-center gap-2 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
            >
              <ReachLogo variant="mark" className="size-6 text-accent-fg" />
              <span className="text-sm font-semibold tracking-tight text-fg">Reach UI</span>
            </a>

            <nav aria-label="Sections" className="ms-4 hidden items-center gap-1 md:flex">
              {(
                [
                  ['introduction', 'Docs'],
                  ['button', 'Components'],
                  ['theming', 'Theming'],
                ] as const
              ).map(([target, label]) => (
                <Button
                  key={target}
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    go(target);
                  }}
                >
                  {label}
                </Button>
              ))}
            </nav>

            <div className="ms-auto flex items-center gap-2">
              {/*
                A button that looks like a field, not a field.
                
                Typing here would open the palette on the first keystroke and
                throw that keystroke away, so it is honest about being a
                trigger: it says what will happen and shows the shortcut that
                does the same thing.
              */}
              <button
                type="button"
                onClick={() => {
                  setPaletteOpen(true);
                }}
                /*
                 * A fixed control height, and nothing in here may wrap.
                 *
                 * Adding the second key chip took the right-hand side wide
                 * enough that the label wrapped to two lines, which grew the
                 * button to 54px inside a 56px header and read as though it had
                 * lost its padding. `h-control-md` pins it to the same height
                 * as every other control on the row, and the label truncates
                 * rather than wrapping.
                 */
                className="hidden h-control-md w-64 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-start text-sm text-fg-subtle hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus lg:flex"
              >
                <SearchIcon className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">Search components…</span>
                <span className="flex shrink-0 items-center gap-0.5">
                  <Kbd keyName="mod" />
                  <Kbd>K</Kbd>
                </span>
              </button>

              <Tooltip content={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleTheme}
                  aria-pressed={theme === 'dark'}
                  aria-label="Toggle dark theme"
                >
                  {theme === 'dark' ? 'Light' : 'Dark'}
                </Button>
              </Tooltip>

              <Button asChild size="sm" variant="secondary">
                <a href={STORYBOOK_URL} target="_blank" rel="noopener noreferrer">
                  Storybook
                </a>
              </Button>
            </div>
          </div>
        </header>

        <div className="mx-auto flex max-w-[100rem] gap-8 px-4">
          {/* ---------------------------------------------------- sidebar -- */}
          <div className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-60 shrink-0 py-8 md:block">
            <ScrollArea className="h-full pe-2">
              {/*
                Plain anchors rather than the system's `Nav`/`NavItem`. Those
                components exist in `packages/ui` but are not re-exported from
                its index, and this application is not permitted to change the
                design system to add the export. Everything here is still token
                only, no private colours, no component styles.
              */}
              <nav ref={railRef} aria-label="Documentation">
                {/*
                  A group is a heading over an indented list, not another line
                  of grey text.

                  Before this the label and its items were both muted, both
                  around the same weight, and separated by four pixels, so a
                  rail of seventy entries read as one undifferentiated column
                  and "Forms" looked like something you could click. Three
                  things now separate them, because one is not enough at this
                  density: the heading takes full foreground contrast and a
                  heavier weight, the items are indented behind a hairline that
                  draws the group as a block, and the space above a heading is
                  much larger than the space between items, so proximity says
                  what belongs to what.

                  Real `<h2>`s rather than `<p>`s: a screen-reader user
                  navigates a long rail by heading, and eight headings is the
                  difference between skimming and reading all seventy links.
                */}
                {NAV.map((group) => (
                  <div key={group.title} className="mt-7 first:mt-0">
                    <h2
                      id={`nav-${group.title.replaceAll(' ', '-').toLowerCase()}`}
                      className="mb-2 px-3 text-xs font-semibold tracking-wider text-fg uppercase"
                    >
                      {group.title}
                    </h2>
                    <ul
                      aria-labelledby={`nav-${group.title.replaceAll(' ', '-').toLowerCase()}`}
                      className="space-y-0.5 border-s border-border ps-2"
                    >
                      {group.slugs.map((item) => (
                        <li key={item}>
                          <a
                            href={`#/${item}`}
                            aria-current={item === slug ? 'page' : undefined}
                            /*
                             * The current page pulls its own segment of the
                             * rail across in the accent, so the position in the
                             * list is legible without reading the label. The
                             * negative margin puts that segment exactly over
                             * the hairline rather than beside it.
                             */
                            className="-ms-2 block border-s-2 border-transparent ps-3 py-1.5 text-sm text-fg-muted transition-colors duration-(--animate-duration-fast) hover:text-fg aria-[current]:border-s-accent aria-[current]:font-medium aria-[current]:text-accent-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus"
                          >
                            {titleFor(item)}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </nav>
            </ScrollArea>
          </div>

          {/* ---------------------------------------------------- content -- */}
          <main
            id="content"
            tabIndex={-1}
            className="min-w-0 flex-1 py-8 focus-visible:outline-none lg:py-10"
          >
            <div className="mx-auto max-w-3xl">
              <Breadcrumb className="mb-6">
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbPage>Docs</BreadcrumbPage>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>{titleFor(slug)}</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>

              {page ? (
                <ComponentPage page={page} />
              ) : slug === 'installation' ? (
                <InstallationPage />
              ) : slug === 'theming' ? (
                <ThemingPage />
              ) : (
                <IntroductionPage />
              )}

              <Separator className="my-12" />

              <nav aria-label="Pagination" className="flex items-center justify-between gap-3">
                {previous ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      go(previous);
                    }}
                  >
                    ← {titleFor(previous)}
                  </Button>
                ) : (
                  <span />
                )}
                {next ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      go(next);
                    }}
                  >
                    {titleFor(next)} →
                  </Button>
                ) : (
                  <span />
                )}
              </nav>

              <footer className="mt-10 text-sm text-fg-subtle">
                Reach is the design system. It is documented and sold on its own.
              </footer>
            </div>
          </main>

          {/* -------------------------------------------------------- toc -- */}
          <aside
            aria-label="On this page"
            className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-56 shrink-0 py-10 xl:block"
          >
            {toc.length > 0 ? (
              <>
                <p className="mb-2 text-2xs font-medium tracking-wider text-fg-subtle uppercase">
                  On this page
                </p>
                {/*
                  One marker that travels, rather than a border that appears on
                  the new entry and vanishes from the old one. A marker that
                  jumps makes the reader find it again; one that slides carries
                  their eye from where they were to where they now are, and its
                  direction says which way through the page they moved.

                  It is positioned by transform and scaled on the Y axis, so the
                  whole move stays on the compositor. Animating `top` and
                  `height` would relayout the rail on every frame of a scroll.
                */}
                <div className="relative border-s border-border">
                  <span
                    aria-hidden="true"
                    className="absolute start-0 top-0 -ms-px w-px origin-top bg-accent transition-transform duration-(--animate-duration-spring-move) ease-spring-move motion-reduce:transition-none"
                    style={{
                      /*
                       * A 1px bar scaled on Y, not a bar whose height changes.
                       * `transform` composites; `height` relayouts the rail on
                       * every frame of the move.
                       */
                      height: '1px',
                      transform: marker
                        ? `translateY(${String(marker.top)}px) scaleY(${String(marker.height)})`
                        : undefined,
                      opacity: marker ? 1 : 0,
                    }}
                  />
                  <ul ref={tocRef} className="space-y-1.5">
                    {toc.map((entry) => (
                      <li key={entry.id}>
                        <a
                          href={`#/${slug}/${entry.id}`}
                          /*
                           * Scroll on every click, not only when the hash
                           * changes.
                           *
                           * Clicking the entry you are already "on" leaves the
                           * hash identical, so no `hashchange` fires and the
                           * router never hears about it. A plain anchor
                           * re-scrolls in that case; this one has to do it
                           * itself, or scrolling away and clicking the same
                           * entry to come back does nothing at all.
                           */
                          onClick={() => {
                            scrollToSection(entry.id);
                          }}
                          aria-current={entry.id === activeSection ? 'true' : undefined}
                          className="block ps-3 text-sm text-fg-muted transition-colors duration-(--animate-duration-fast) hover:text-fg aria-[current]:font-medium aria-[current]:text-accent-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                        >
                          {entry.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            ) : null}
          </aside>
        </div>
      </div>
    </TooltipProvider>
  );
}
