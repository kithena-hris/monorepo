import type { Meta, StoryObj } from '@storybook/react-vite';
import * as lucide from 'lucide-react';
import { useMemo, useState, type JSX } from 'react';

import { Badge } from '../components/badge/badge';
import { Button } from '../components/button/button';
import { CopyButton } from '../components/clipboard/clipboard';
import { Input } from '../components/input/input';
import { Alert } from '../components/feedback/feedback';
import { Tooltip } from '../components/tooltip/tooltip';
import { iconGroups, iconNames, icons, type IconName } from './index';

const meta = {
  title: 'Icons/Gallery',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Every icon in the system, and every icon available to it.',
          '',
          '### Two lists, and the difference matters',
          '',
          '**The set** is a map from *meaning* to glyph: `icons.delete`, `icons.person`. That name is the contract; which lucide component sits behind it can change in one commit, everywhere at once.',
          '',
          '**The library** is all ~1,500 lucide icons, importable directly. Reach for it when a screen genuinely needs a glyph the set does not have, and then add it to the set, because the second module to need it will otherwise pick a different one.',
          '',
          'That is the whole argument for a registry. Given free choice, three modules pick three glyphs for "delete", a fourth uses the one that means "archive", and the product stops being learnable. An icon is a word.',
          '',
          '### The rules',
          '',
          '- **One meaning, one glyph.** Two entries rendering the same icon means one of them is the wrong word.',
          '- **An icon is never the only signal.** Every icon-only control carries an `aria-label`; every status carries its word. Roughly one man in twelve cannot separate the tones this system uses.',
          '- **Decorative icons are `aria-hidden`.** An icon beside a label is decoration: announcing "trash, Delete" is noise.',
          '- **Size comes from the type scale.** `size-4` beside `text-base`, `size-3.5` beside `text-sm`. Never a hard-coded pixel value.',
          '',
          '### Stroke, not fill',
          '',
          'Lucide is a stroke set at a fixed 2px width on a 24px grid. Scaling one to 12px leaves a stroke that is proportionally twice as heavy, which is why the system stops at `size-3.5`. Below that, use text.',
        ].join('\n'),
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function IconTile({ name, Icon }: { name: string; Icon: lucide.LucideIcon }): JSX.Element {
  return (
    <div className="group relative flex flex-col items-center gap-2 rounded-md border border-border bg-surface p-3 transition-[border-color,box-shadow] duration-(--animate-duration-fast) hover:border-border-strong hover:shadow-sm">
      <Icon aria-hidden className="size-5 text-fg" />
      <span className="w-full truncate text-center font-mono text-2xs text-fg-muted" title={name}>
        {name}
      </span>
      <div className="absolute top-1 end-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <CopyButton value={name} label={`Copy ${name}`} />
      </div>
    </div>
  );
}

const importSnippet = "import { icons } from '@reach/ui';\n\n<icons.delete aria-hidden />";

export const TheSet: Story = {
  name: 'The set',
  parameters: {
    docs: {
      description: {
        story:
          'Grouped by what the icon is *for*, not by what it depicts: someone hunting for the delete glyph looks under actions, not under "bin". Hover any tile to copy its name.',
      },
    },
  },
  render: () => (
    <div className="space-y-8">
      <Alert tone="info" title={`${String(iconNames.length)} names in the set`}>
        <span className="flex items-center gap-2">
          <code className="min-w-0 flex-1 font-mono text-xs break-all">{importSnippet}</code>
          <CopyButton value={importSnippet} label="Copy the import" />
        </span>
      </Alert>

      {Object.entries(iconGroups).map(([group, entries]) => (
        <section key={group} className="space-y-3">
          <div className="flex items-baseline gap-2">
            <h3 className="text-md font-semibold text-fg capitalize">{group}</h3>
            <Badge size="sm">{Object.keys(entries).length}</Badge>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2">
            {Object.entries(entries).map(([name, Icon]) => (
              <IconTile key={`${group}-${name}`} name={name} Icon={Icon} />
            ))}
          </div>
        </section>
      ))}
    </div>
  ),
};

export const TheLibrary: Story = {
  name: 'The whole library',
  parameters: {
    docs: {
      description: {
        story: [
          'Every icon `lucide-react` exports: around 1,500 of them. Search by name.',
          '',
          'The results are capped rather than rendered all at once: 1,500 inline SVGs is roughly 1,500 DOM subtrees, and a docs page that takes four seconds to paint is a page nobody scrolls. Narrowing the search is the intended way to browse.',
          '',
          'If you use one from here, add it to the set with a name that says what it *means* in this product. The second module to need it will otherwise pick a different glyph for the same idea.',
        ].join('\n'),
      },
    },
  },
  render: function LibraryStory() {
    const [query, setQuery] = useState('');
    const limit = 180;

    const all = useMemo(() => {
      // The module exports icons, aliases, helpers and types. An icon is a
      // PascalCase function; `createLucideIcon` and the `*Icon` aliases are
      // the same components under different names, so both are dropped.
      const entries = Object.entries(lucide).filter(
        (entry): entry is [string, lucide.LucideIcon] =>
          /^[A-Z][A-Za-z0-9]*$/.test(entry[0]) &&
          !entry[0].endsWith('Icon') &&
          typeof entry[1] === 'object',
      );
      return entries.toSorted(([a], [b]) => a.localeCompare(b));
    }, []);

    const matches = useMemo(() => {
      const needle = query.trim().toLowerCase();
      if (needle === '') return all;
      return all.filter(([name]) => name.toLowerCase().includes(needle));
    }, [all, query]);

    const shown = matches.slice(0, limit);

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-72">
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              aria-label="Search every icon"
              placeholder="Search: try 'user', 'arrow', 'file'"
              startAdornment={<icons.search />}
            />
          </div>
          <p aria-live="polite" className="text-sm text-fg-muted">
            <span className="font-medium tabular-nums text-fg">{matches.length}</span> of{' '}
            <span className="tabular-nums">{all.length}</span> icons
            {matches.length > limit ? ` · showing the first ${String(limit)}` : ''}
          </p>
        </div>

        {matches.length === 0 ? (
          <p className="py-10 text-center text-sm text-fg-muted">
            Nothing matches “{query}”. Lucide names are English and singular: try “user”, not
            “users”.
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2">
            {shown.map(([name, Icon]) => (
              <IconTile key={name} name={name} Icon={Icon} />
            ))}
          </div>
        )}
      </div>
    );
  },
};

export const Sizes: Story = {
  name: 'Sizing and alignment',
  parameters: {
    docs: {
      description: {
        story:
          'Lucide is a stroke set at a fixed 2px width on a 24px grid, so scaling one down leaves a proportionally heavier stroke. The system stops at `size-3.5`; below that, use text. Each size is shown beside the type it belongs with, an icon that does not share a baseline with its label reads as a misprint.',
      },
    },
  },
  render: () => (
    <div className="space-y-4">
      {(
        [
          ['size-3.5', 'text-sm', 'Sits beside small text, a table cell, a caption'],
          ['size-4', 'text-base', 'The default. Beside body text and inside controls'],
          ['size-5', 'text-md', 'A section heading, a card header'],
          ['size-6', 'text-lg', 'A page header or an empty state'],
        ] as const
      ).map(([iconSize, textSize, note]) => (
        <div key={iconSize} className="flex items-center gap-4 border-b border-border pb-3">
          <code className="w-20 shrink-0 font-mono text-2xs text-fg-subtle">{iconSize}</code>
          <span className={`flex items-center gap-2 text-fg ${textSize}`}>
            <icons.person aria-hidden className={iconSize} />
            Grace Hopper
          </span>
          <span className="ms-auto text-xs text-fg-muted">{note}</span>
        </div>
      ))}
    </div>
  ),
};

export const Labelling: Story = {
  name: 'Labelling',
  parameters: {
    docs: {
      description: {
        story: [
          'Three cases, three answers.',
          '',
          '**Decorative**, an icon beside its own label. `aria-hidden`, always. Announcing "trash, Delete" is noise.',
          '',
          '**The only content**, an icon-only button. It needs `aria-label`, and a tooltip on top for the sighted user who does not recognise the glyph. The label and the tooltip should say the same words.',
          '',
          '**Carrying meaning**, a status glyph. It gets a text alternative *and* the word beside it, because colour and shape are not available to everyone.',
        ].join('\n'),
      },
    },
  },
  render: () => (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">Decorative</p>
        <Button startIcon={<icons.delete />} variant="destructive">
          Delete
        </Button>
        <p className="text-xs text-fg-muted">
          The icon is `aria-hidden`; the button is named by its text.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
          The only content
        </p>
        <div className="flex gap-2">
          <Tooltip content="Delete">
            <Button variant="ghost" aria-label="Delete" startIcon={<icons.delete />} />
          </Tooltip>
          <Tooltip content="Archive">
            <Button variant="ghost" aria-label="Archive" startIcon={<icons.archive />} />
          </Tooltip>
          <Tooltip content="Download">
            <Button variant="ghost" aria-label="Download" startIcon={<icons.download />} />
          </Tooltip>
        </div>
        <p className="text-xs text-fg-muted">
          `aria-label` for assistive tech, a tooltip for everyone else. Same words in both.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
          Carrying meaning
        </p>
        <div className="flex flex-wrap gap-2">
          <Badge tone="success" dot>
            Approved
          </Badge>
          <Badge tone="warning" dot>
            Awaiting manager
          </Badge>
          <Badge tone="danger" dot>
            Rejected
          </Badge>
        </div>
        <p className="text-xs text-fg-muted">
          The word carries it; the colour and the dot reinforce. Never the other way round.
        </p>
      </div>
    </div>
  ),
};

export const Naming: Story = {
  name: 'When the name disagrees with the glyph',
  parameters: {
    docs: {
      description: {
        story:
          "The registry maps meanings, so two names can share a glyph while meaning different things, and one name can outlive the glyph behind it. `icons.approve` resolves to the domain check-mark rather than the thumbs-up, because in this product approving is something you do to a person's request. Changing that decision is one line here, not a search across forty screens.",
      },
    },
  },
  render: () => (
    <div className="max-w-lg space-y-2">
      {(
        [
          ['approve', 'A leave request, an expense, a person is waiting'],
          ['confirm', 'A dialog answer. No person, no queue'],
          ['success', 'A state, after the fact'],
          // Annotated, not `as const`. The names are now checked against the
          // registry as data, so renaming an icon breaks this table here
          // instead of the old cast quietly accepting a name that no longer
          // resolves and failing at render.
        ] satisfies readonly (readonly [IconName, string])[]
      ).map(([name, meaning]) => {
        const Icon = icons[name];
        return (
          <div key={name} className="flex items-center gap-3 rounded-md border border-border p-3">
            <Icon aria-hidden className="size-5 text-fg" />
            <code className="w-24 shrink-0 font-mono text-xs text-fg">{name}</code>
            <span className="text-sm text-fg-muted">{meaning}</span>
          </div>
        );
      })}
    </div>
  ),
};
