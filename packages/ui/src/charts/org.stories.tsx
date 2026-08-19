import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { Badge } from '../components/badge/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../components/card/card';
import { ContextMenuItem } from '../components/context-menu/context-menu';
import { OrgChart, type OrgNode } from '../components/org-chart/org-chart';
import { ToggleGroup, ToggleGroupItem } from '../components/toggle/toggle';
import { reportingLine } from './fixtures';

const meta = {
  title: 'Charts/Org chart',
  component: OrgChart,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Reporting lines, drawn. The one chart in an HRIS that everybody opens and nobody configures.',
          '',
          '### It takes the shape a query returns',
          '',
          'A flat array of nodes with a `parentId`, what comes back from a table, an API and a CSV import. Building the tree is arithmetic the component does once instead of something every caller reimplements slightly differently. A node with no `parentId`, or one pointing at an id that is not in the list, is a root; several roots are fine, because a filtered org is usually a forest.',
          '',
          '### Cycles are expected, not impossible',
          '',
          'Two people made each other’s manager during a reorg is a data state every HRIS reaches eventually, and a renderer that recurses into it hangs the tab. The tree is built from the roots outward with a visited set, and anything left unreachable is **excluded and reported in a banner**. A silent drop would be a chart that quietly understates the company, the fix is a data fix, so the chart says so.',
          '',
          '### The tree is the semantics; the boxes are the drawing',
          '',
          '`role="tree"` with one tab stop and roving `tabindex`, which is what a screen reader and a keyboard already know how to drive:',
          '',
          '| Key | Does |',
          '| --- | --- |',
          '| `↓` `↑` | Next / previous visible person |',
          '| `→` | Expand, or move to the first report |',
          '| `←` | Collapse, or move to the manager |',
          '| `Home` `End` | First / last visible person |',
          '| `Enter` `Space` | Select |',
          '',
          'The arrow keys keep their tree meaning in **both** orientations. Someone navigating by keyboard is moving through a hierarchy, not across a picture, and rebinding the keys to match the pixels would break the one mapping they already have.',
          '',
          'Each card names itself. *"Radia Perlman, Chief Technology Officer, 2 direct reports, 6 in total"*. Without an explicit label, a `treeitem`’s name is computed from its contents, and its contents are the entire subtree beneath it.',
          '',
          '### Every gesture has a menu behind it',
          '',
          'Right-click **any** person: leaves included, for their own menu:',
          '',
          '| Item | Does |',
          '| --- | --- |',
          '| Show only this chain | Draws that person, their subtree, and the managers above them as a muted spine. |',
          '| Show their whole chart | The same, with everything below them opened. Double-clicking a card does this. |',
          '| Show whole org | Back out. |',
          '| Show / hide reports | The disclosure, for people who cannot hit a 20px chevron. |',
          '| Go to manager | Moves focus one level up. |',
          '| Report to ▸ | Only for an HR admin. The keyboard path for the drag. |',
          '',
          'Drag is the accelerator, never the only route, because a drag is unreachable by a keyboard, a switch, or an unsteady hand.',
          '',
          '### Nothing moves under the pointer',
          '',
          'Expanding a branch changes the width of every ancestor above it, and in a centred tree that moves the card you just clicked, the thing that reads as a flicker. The card’s position is recorded before each toggle and a layout effect puts it back by adjusting the scroll, so the tree grows *around* the person you are looking at. A `useEffect` would be one frame too late; this is the case `useLayoutEffect` exists for.',
          '',
          '### It is a canvas',
          '',
          'A bounded, scrollable, zoomable surface, not a block that grows until it pushes the page off the screen. A 400-person tree is several screens wide and several tall, and every tool that draws one gives you the same four gestures:',
          '',
          '| Gesture | Does |',
          '| --- | --- |',
          '| Wheel / trackpad two-finger | Pan |',
          '| **Ctrl / ⌘ + wheel**, trackpad pinch | Zoom about the pointer |',
          '| Drag the background | Pan |',
          '| `+` `-` `0` | Zoom in, out, reset |',
          '',
          'Plus the buttons: zoom out, the level as a percentage, zoom in, and **Fit**, which scales the whole tree to the frame. The percentage is a live region, a canvas that can be zoomed but never says how far is one people reset out of superstition.',
          '',
          'Zoom is `zoom`, not `transform: scale()`. `zoom` re-runs layout, so the scroll range grows with the content instead of needing a shadow element sized to match it, and every measurement in the component stays in one coordinate space. Zooming is about the **pointer**, not the top-left corner: scaling about the corner is the difference between a chart you can explore and one you have to re-find your place in after every step.',
          '',
          'React attaches `wheel` passively at the root, so `preventDefault` in an `onWheel` prop does nothing at all, the listener has to be added by hand with `{ passive: false }`, or ⌘-scrolling the chart zooms the whole browser instead.',
          '',
          '### Everything is centred',
          '',
          'The root opens in the middle of the frame, and a lone report sits directly beneath its manager. `min-w-full` with `w-max` and `justify-center` does the centring; the canvas then scrolls so the root is centred rather than jammed against the left edge, which is the one place a root never is.',
          '',
          'A manager is centred over **the box its subtree occupies**. The tidier alternative: centring over the midpoint of the first and last child: needs equal-width sibling tracks, and that multiplies up the tree: every column becomes as wide as the widest sibling *subtree*. Measured on this 24-person chart it went from 2,944px to 8,480px, and Fit bottomed out at 40% before anything was legible. A card offset by a fraction of its own width is a far cheaper problem than a chart nobody can read.',
          '',
          '### The card',
          '',
          '`avatarUrl` with an initials fallback, name, title, a `meta` line, and a `status` badge for the states an org chart is usually opened to find, on leave, notice period, open requisition. `renderNode` replaces the body entirely and is handed the counts rather than left to recompute them.',
          '',
          '`avatarUrl` is scheme-checked before it reaches `src`. An avatar arrives from an upload or an import, which makes it attacker-influenced data going into the DOM: an `<img>` will not *execute* a hostile URL, but it will happily fetch it, turning every viewer into an outbound request to a host of somebody else’s choosing. Anything that is not `http(s)`, a `data:` image, or a same-origin path falls back to initials, which is a perfectly good avatar.',
          '',
          '### Connector lines cost nothing',
          '',
          'No SVG, no measuring, no resize observer. Each child draws its own half of the line that joins it to its siblings: first child from the middle outward, last child from the outside to the middle, so the join lands in the right place at any width, in any font, in both writing directions.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    nodes: {
      description: 'Flat list. `parentId` builds the tree.',
      control: 'object',
      table: { type: { summary: 'readonly OrgNode[]' }, category: 'Data' },
    },
    label: {
      description: 'Names the tree for assistive tech and the right-click menu.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Data' },
    },
    orientation: {
      description: 'Reports below their manager, or to the side.',
      control: 'inline-radio',
      options: ['vertical', 'horizontal'],
      table: {
        type: { summary: "'vertical' | 'horizontal'" },
        defaultValue: { summary: "'vertical'" },
        category: 'Appearance',
      },
    },
    searchable: {
      description: 'Renders the person search, which focuses whoever is picked.',
      control: 'boolean',
      table: { type: { summary: 'boolean' }, category: 'Focus' },
    },
    focusId: {
      description: 'Draw only this person and everyone under them. Uncontrolled when omitted.',
      control: false,
      table: { type: { summary: 'string | null' }, category: 'Focus' },
    },
    focusMode: {
      description: 'Keep the managers above the focused person, or drop them.',
      control: 'inline-radio',
      options: ['chain', 'branch'],
      table: {
        type: { summary: "'chain' | 'branch'" },
        defaultValue: { summary: "'chain'" },
        category: 'Focus',
      },
    },
    defaultFocusId: {
      control: false,
      table: { type: { summary: 'string | null' }, category: 'Focus' },
    },
    onFocusChange: {
      control: false,
      table: { type: { summary: '(id: string | null) => void' }, category: 'Focus' },
    },
    reassignable: {
      description: 'Drag-to-reassign, plus the "Report to" menu that goes with it.',
      control: 'boolean',
      table: { type: { summary: 'boolean' }, category: 'Reassignment' },
    },
    viewerRole: {
      description: 'Only an HR admin gets the drag and the "Report to" menu. UI affordance only.',
      control: 'inline-radio',
      options: ['viewer', 'manager', 'hr-admin'],
      table: {
        type: { summary: "'viewer' | 'manager' | 'hr-admin'" },
        defaultValue: { summary: "'viewer'" },
        category: 'Reassignment',
      },
    },
    onReassign: {
      description: 'Apply the move to your own data. Nothing moves without it.',
      control: false,
      table: { type: { summary: '(move: OrgMove) => void' }, category: 'Reassignment' },
    },
    canReassign: {
      description: 'Veto a move the data model would allow. Cycles are already rejected.',
      control: false,
      table: {
        type: { summary: '(node: OrgNode, newManager: OrgNode) => boolean' },
        category: 'Reassignment',
      },
    },
    onDraggingChange: {
      control: false,
      table: { type: { summary: '(node: OrgNode | null) => void' }, category: 'Reassignment' },
    },
    collapsed: {
      description: 'Ids whose reports are hidden. Uncontrolled when omitted.',
      control: false,
      table: { type: { summary: 'readonly string[]' }, category: 'State' },
    },
    defaultCollapsed: {
      control: false,
      table: { type: { summary: 'readonly string[]' }, category: 'State' },
    },
    onCollapsedChange: {
      control: false,
      table: { type: { summary: '(collapsed: readonly string[]) => void' }, category: 'State' },
    },
    onSelect: {
      description: 'Makes every card selectable, by click and by Enter.',
      control: false,
      table: { type: { summary: '(node: OrgNode) => void' }, category: 'Interaction' },
    },
    selectedId: {
      control: false,
      table: { type: { summary: 'string' }, category: 'Interaction' },
    },
    onNodeMouseEnter: {
      control: false,
      table: {
        type: { summary: '(node: OrgNode, event: MouseEvent) => void' },
        category: 'Pointer events',
      },
    },
    onNodeMouseLeave: {
      control: false,
      table: {
        type: { summary: '(node: OrgNode, event: MouseEvent) => void' },
        category: 'Pointer events',
      },
    },
    onNodeMouseDown: {
      control: false,
      table: {
        type: { summary: '(node: OrgNode, event: MouseEvent) => void' },
        category: 'Pointer events',
      },
    },
    onNodeDoubleClick: {
      control: false,
      table: {
        type: { summary: '(node: OrgNode, event: MouseEvent) => void' },
        category: 'Pointer events',
      },
    },
    onNodeContextMenu: {
      control: false,
      table: {
        type: { summary: '(node: OrgNode, event: MouseEvent) => void' },
        category: 'Pointer events',
      },
    },
    renderNode: {
      description: 'Replaces the card body. Counts are handed over rather than recomputed.',
      control: false,
      table: {
        type: { summary: '(node: OrgNode, info: OrgNodeInfo) => ReactNode' },
        category: 'Escape hatches',
      },
    },
    nodeMenuItems: {
      description: 'Extra commands on one person’s own menu.',
      control: false,
      table: { type: { summary: '(node: OrgNode) => ReactNode' }, category: 'Escape hatches' },
    },
    zoom: {
      description: 'Canvas scale. Uncontrolled when omitted.',
      control: false,
      table: { type: { summary: 'number' }, category: 'Canvas' },
    },
    defaultZoom: {
      control: { type: 'range', min: 0.3, max: 1.6, step: 0.1 },
      table: { type: { summary: 'number' }, defaultValue: { summary: '1' }, category: 'Canvas' },
    },
    zoomRange: {
      control: false,
      table: {
        type: { summary: '[min: number, max: number]' },
        defaultValue: { summary: '[0.3, 1.6]' },
        category: 'Canvas',
      },
    },
    onZoomChange: {
      control: false,
      table: { type: { summary: '(zoom: number) => void' }, category: 'Canvas' },
    },
    height: {
      description: 'Canvas height. The tree scrolls inside it rather than growing the page.',
      control: { type: 'range', min: 280, max: 900, step: 20 },
      table: {
        type: { summary: 'number | string' },
        defaultValue: { summary: '520' },
        category: 'Canvas',
      },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {
    label: 'Reporting lines',
    nodes: reportingLine,
    orientation: 'vertical',
    // Spies, so every callback lands in the **Actions** panel with its real
    // arguments. That panel is the fastest way to answer the question people
    // actually have about a component. *what do I get back, and when?*, and
    // it answers it without anybody reading the source.
    onSelect: fn().mockName('onSelect(node)'),
    onFocusChange: fn().mockName('onFocusChange(id | null)'),
    onCollapsedChange: fn().mockName('onCollapsedChange(ids)'),
    onZoomChange: fn().mockName('onZoomChange(scale)'),
    onReassign: fn().mockName('onReassign({ nodeId, fromParentId, toParentId })'),
    onDraggingChange: fn().mockName('onDraggingChange(node | null)'),
    onNodeMouseEnter: fn().mockName('onNodeMouseEnter(node, event)'),
    onNodeMouseLeave: fn().mockName('onNodeMouseLeave(node, event)'),
    onNodeDoubleClick: fn().mockName('onNodeDoubleClick(node, event)'),
    onNodeContextMenu: fn().mockName('onNodeContextMenu(node, event)'),
  },
} satisfies Meta<typeof OrgChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: { searchable: true },
  render: (args) => (
    <Card>
      <CardHeader>
        <CardTitle>Reporting lines</CardTitle>
        <Badge size="sm">{args.nodes.length} people</Badge>
      </CardHeader>
      <CardContent>
        <OrgChart {...args} />
      </CardContent>
    </Card>
  ),
};

export const Canvas: Story = {
  name: 'Pan and zoom',
  args: { searchable: true, height: 620 },
  parameters: {
    docs: {
      description: {
        story: [
          'The whole 24-person tree, on a canvas you can move around:',
          '',
          '- **Ctrl / ⌘ + wheel**, or a trackpad pinch: zooms about the pointer. The card under the cursor stays under the cursor.',
          '- **Drag the background** to pan. Cards keep their own drag; the canvas only claims a gesture that did not start on one.',
          '- **`+` `-` `0`** zoom in, out and back to 100% from the keyboard.',
          '- **Fit** scales the tree to the frame: here about 56%, which is the honest answer for a tree three thousand pixels wide.',
          '',
          'Watch the **Actions** panel while you do it: `onZoomChange` fires with the new scale, `onCollapsedChange` with the ids that are hidden, `onFocusChange` with whoever is focused. Every callback on this component is a spy in these stories, which is the fastest way to see what you get back and when.',
        ].join('\n'),
      },
    },
  },
  render: (args) => (
    <Card>
      <CardHeader>
        <CardTitle>Whole organisation</CardTitle>
        <Badge size="sm">{args.nodes.length} people</Badge>
      </CardHeader>
      <CardContent>
        <OrgChart {...args} />
      </CardContent>
    </Card>
  ),
};

export const Search: Story = {
  name: 'Search, focus and the chain',
  args: { searchable: true },
  parameters: {
    docs: {
      description: {
        story: [
          'Twenty-four people is already too many to read at once, and a real org has thousands. `searchable` puts a person search above the chart: pick somebody and the chart redraws around them.',
          '',
          'The default `focusMode` is **`chain`**, the managers above them stay on screen as a muted, dashed spine, each showing only the one report that leads onward. Somebody four levels down is meaningless without the line that got you there, and a chart that answers "who is this?" without answering "where do they sit?" sends people straight back to the search box. The spine still prints each manager’s **real** headcount, not the trimmed one; a spine that reported its own drawn size would be lying quietly.',
          '',
          '`focusMode: "branch"` drops the spine and draws the focused person as the only root. That is the mode for when the person *is* the whole question, a team page, a manager’s own dashboard.',
          '',
          'Every card offers the same thing on its own menu, **including the leaves**: *Show only this chain*. "Show me this person and the line above them" is the question people ask most often about someone with no reports at all.',
          '',
          'Focus is a **view**, not a filter of the data: the accessibility table below still lists everybody, because hiding rows from a screen reader is not the same as drawing fewer boxes.',
        ].join('\n'),
      },
    },
  },
  render: function SearchStory(args) {
    const [focus, setFocus] = useState<string | null>('em-data');
    const [mode, setMode] = useState<'chain' | 'branch'>('chain');

    return (
      <Card>
        <CardHeader>
          <CardTitle>Reporting lines</CardTitle>
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={(next) => {
              if (next === 'chain' || next === 'branch') setMode(next);
            }}
            aria-label="Focus mode"
          >
            <ToggleGroupItem value="chain" size="sm">
              Chain
            </ToggleGroupItem>
            <ToggleGroupItem value="branch" size="sm">
              Branch
            </ToggleGroupItem>
          </ToggleGroup>
        </CardHeader>
        <CardContent>
          <OrgChart
            {...args}
            focusMode={mode}
            focusId={focus}
            onFocusChange={(next) => {
              setFocus(next);
              args.onFocusChange?.(next);
            }}
          />
        </CardContent>
      </Card>
    );
  },
};

export const ReadOnly: Story = {
  name: 'Read-only for everyone else',
  args: { reassignable: true, viewerRole: 'manager', searchable: true },
  parameters: {
    docs: {
      description: {
        story: [
          'The same chart with `reassignable` still set, seen by somebody who is not an HR admin. No drag, no *Report to*, and the menu says why rather than quietly omitting the item, a control that vanishes without explanation is a control people file a ticket about.',
          '',
          '**This is presentation, and only presentation.** `viewerRole` picks which affordances render; it does not stop anybody calling the mutation. Authorisation belongs on the write path, where it is checked against the caller’s own identity rather than against a prop they could have set themselves.',
        ].join('\n'),
      },
    },
  },
  render: (args) => (
    <Card>
      <CardHeader>
        <CardTitle>Reporting lines</CardTitle>
        <Badge size="sm" tone="neutral">
          Manager view
        </Badge>
      </CardHeader>
      <CardContent>
        <OrgChart {...args} />
      </CardContent>
    </Card>
  ),
};

export const Stability: Story = {
  name: 'Nothing moves under the pointer',
  args: { defaultCollapsed: ['vp-platform', 'cpo', 'cfo'], searchable: true },
  parameters: {
    docs: {
      description: {
        story: [
          'Open and close a few branches and watch the card you clicked: it stays exactly where it is, while the tree grows and shrinks around it.',
          '',
          'It is not free. A centred tree re-centres every ancestor when a descendant changes width, so the naive version slides the card out from under the pointer on every toggle, which is what reads as a flicker. The fix is to record the card’s viewport position before the state change and correct the scroll in a layout effect, before the browser paints. A `useEffect` would show the jump for one frame.',
          '',
          'The scroll itself is smooth, and keyboard navigation scrolls the focused card to the **centre** rather than letting the browser jam it against an edge where its connectors are invisible. Both sit under `motion-safe`: a smooth scroll is an animation, and someone who asked for less motion asked for less of this too.',
          '',
          'There is one case it cannot hold, and it is the right one to lose: collapsing a branch until the whole tree is **narrower than the frame** leaves no scroll to spend, so the tree re-centres and the card moves. A centred root beats a still card. That is the rule the rest of this layout is built on.',
          '',
          'The correction itself is `behavior: "instant"`. The container scrolls smoothly by default, and a compensation that animates *is* the jump, arriving a few hundred milliseconds late.',
        ].join('\n'),
      },
    },
  },
  render: (args) => (
    <Card>
      <CardHeader>
        <CardTitle>Expand and collapse</CardTitle>
      </CardHeader>
      <CardContent>
        <OrgChart {...args} />
      </CardContent>
    </Card>
  ),
};

export const Reassigning: Story = {
  name: 'Drag to change a reporting line',
  args: { reassignable: true, searchable: true, viewerRole: 'hr-admin' },
  parameters: {
    docs: {
      description: {
        story: [
          'Drag a card onto a manager. The card under the pointer turns **green** when the move is legal and **red** when it is not, and the chart never accepts a drop it would then refuse.',
          '',
          'Three things make a move illegal, and all three are the same rule, an org chart must stay a tree:',
          '',
          '| Rejected | Why |',
          '| --- | --- |',
          '| Onto yourself | Not a move. |',
          '| Onto one of your own reports, at any depth | This is exactly how an org chart becomes a doughnut. |',
          '| Onto your current manager | Already true. |',
          '',
          'Grace Hopper is `locked`: she cannot be dragged and nobody can be dropped onto her. Use it for the rows a reorg is not allowed to touch. `canReassign` adds your own rule on top: here, nobody may report to someone on notice.',
          '',
          '**The keyboard path is the menu.** Right-click anyone and open *Report to*: it lists exactly the managers the drag would accept, computed by the same function. A reorg tool that only works by dragging is a reorg tool half the company cannot use.',
          '',
          '`onReassign` hands you `{ nodeId, fromParentId, toParentId }` and the chart changes nothing itself, the data is yours, and in a real system this is an effective-dated event rather than an update in place.',
          '',
          '**Only an HR admin sees any of this.** `viewerRole` gates the drag and the menu, and gates nothing else. It is an affordance: it decides which controls exist, not who is allowed to do the thing. The server has to make the same decision again on the write path, because a permission enforced in a React component is not enforced. See the *Read-only* story for what everyone else gets.',
        ].join('\n'),
      },
    },
  },
  render: function ReassigningStory(args) {
    const [people, setPeople] = useState<OrgNode[]>(reportingLine);
    const [log, setLog] = useState<string[]>([]);

    const name = (id: string | undefined): string =>
      people.find((person) => person.id === id)?.name ?? 'nobody';

    return (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Reorg</CardTitle>
          </CardHeader>
          <CardContent>
            <OrgChart
              {...args}
              nodes={people}
              // Nobody reports to someone who is leaving.
              canReassign={(_node, manager) => manager.status !== 'Notice period'}
              onReassign={(move) => {
                args.onReassign?.(move);
                const { nodeId, fromParentId, toParentId } = move;
                setPeople((current) =>
                  current.map((person) =>
                    person.id === nodeId ? { ...person, parentId: toParentId } : person,
                  ),
                );
                setLog((current) =>
                  [
                    `${name(nodeId)}: ${name(fromParentId)} → ${name(toParentId)}`,
                    ...current,
                  ].slice(0, 6),
                );
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Changes</CardTitle>
          </CardHeader>
          <CardContent>
            <ol aria-live="polite" className="space-y-1 text-sm text-fg-muted">
              {log.length === 0 ? <li>Nothing moved yet.</li> : null}
              {log.map((entry, index) => (
                <li key={`${entry}-${String(index)}`}>{entry}</li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
    );
  },
};

export const PointerEvents: Story = {
  name: 'Driving something else',
  args: { searchable: false },
  parameters: {
    docs: {
      description: {
        story: [
          'The card forwards its pointer events with the node attached. `onNodeMouseEnter`, `onNodeMouseLeave`, `onNodeMouseDown`, `onNodeDoubleClick`, `onNodeContextMenu`, so a screen can hang its own behaviour off the chart without the chart knowing what that behaviour is.',
          '',
          'Here, hovering previews a person in the panel and double-clicking pins them. A profile drawer, a compare tray, a hover card and a "who covers this person" lookup are all the same three lines of caller code.',
          '',
          'The events carry the DOM event as well as the node, so a caller that needs the cursor position, a floating card, a marquee: has it without reaching into the DOM.',
        ].join('\n'),
      },
    },
  },
  render: function PointerEventsStory(args) {
    const [hovered, setHovered] = useState<OrgNode | null>(null);
    const [pinned, setPinned] = useState<OrgNode | null>(null);
    const shown = hovered ?? pinned;

    return (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Reporting lines</CardTitle>
          </CardHeader>
          <CardContent>
            <OrgChart
              {...args}
              onNodeMouseEnter={(node, event) => {
                setHovered(node);
                args.onNodeMouseEnter?.(node, event);
              }}
              onNodeMouseLeave={(node, event) => {
                setHovered(null);
                args.onNodeMouseLeave?.(node, event);
              }}
              onNodeDoubleClick={(node, event) => {
                setPinned(node);
                args.onNodeDoubleClick?.(node, event);
              }}
              nodeMenuItems={(node) => (
                <ContextMenuItem
                  onSelect={() => {
                    setPinned(node);
                  }}
                >
                  Pin to panel
                </ContextMenuItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{pinned === null ? 'Preview' : 'Pinned'}</CardTitle>
          </CardHeader>
          <CardContent aria-live="polite">
            {shown === null ? (
              <p className="text-sm text-fg-muted">Hover someone. Double-click to pin.</p>
            ) : (
              <div className="space-y-1">
                <p className="font-medium text-fg">{shown.name}</p>
                <p className="text-sm text-fg-muted">{shown.title}</p>
                {shown.meta === undefined ? null : (
                  <p className="text-sm text-fg-subtle">{shown.meta}</p>
                )}
                {shown.status === undefined ? null : (
                  <Badge size="sm" tone={shown.statusTone ?? 'neutral'}>
                    {shown.status}
                  </Badge>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  },
};

export const Orientation: Story = {
  name: 'Vertical and horizontal',
  args: { defaultFocusId: 'cto' },
  parameters: {
    docs: {
      description: {
        story:
          'Vertical is the org chart everyone pictures, and it runs out of horizontal room at around the third level. Horizontal turns the same tree into an indented outline with connectors, which is what deep, narrow structures want, a chain of managers each with one or two reports. The keyboard behaviour is identical in both, deliberately.',
      },
    },
  },
  render: function OrientationStory(args) {
    const [orientation, setOrientation] = useState<'vertical' | 'horizontal'>('horizontal');

    return (
      <Card>
        <CardHeader>
          <CardTitle>Technology</CardTitle>
          <ToggleGroup
            type="single"
            value={orientation}
            onValueChange={(next) => {
              if (next === 'vertical' || next === 'horizontal') setOrientation(next);
            }}
            aria-label="Orientation"
          >
            <ToggleGroupItem value="vertical" size="sm">
              Vertical
            </ToggleGroupItem>
            <ToggleGroupItem value="horizontal" size="sm">
              Horizontal
            </ToggleGroupItem>
          </ToggleGroup>
        </CardHeader>
        <CardContent>
          <OrgChart {...args} orientation={orientation} />
        </CardContent>
      </Card>
    );
  },
};

export const Selecting: Story = {
  name: 'Selecting a person',
  args: { defaultFocusId: 'cpo' },
  parameters: {
    docs: {
      description: {
        story:
          'Click a card, or move to it with the arrow keys and press Enter. Selection is the caller’s state, so the same chart drives a detail panel, a bulk action or a manager picker.',
      },
    },
  },
  render: function SelectingStory(args) {
    const [selected, setSelected] = useState<OrgNode | null>(null);
    const reports = selected
      ? args.nodes.filter((node) => node.parentId === selected.id).length
      : 0;

    return (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>People</CardTitle>
          </CardHeader>
          <CardContent>
            <OrgChart
              {...args}
              {...(selected === null ? {} : { selectedId: selected.id })}
              onSelect={(node) => {
                setSelected(node);
                args.onSelect?.(node);
              }}
              menuItems={
                <ContextMenuItem
                  onSelect={() => {
                    setSelected(null);
                  }}
                >
                  Clear selection
                </ContextMenuItem>
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent aria-live="polite">
            {selected === null ? (
              <p className="text-sm text-fg-muted">Select someone.</p>
            ) : (
              <div className="space-y-1">
                <p className="font-medium text-fg">{selected.name}</p>
                <p className="text-sm text-fg-muted">{selected.title}</p>
                <p className="text-sm text-fg-subtle">
                  {reports === 0 ? 'No direct reports' : `${String(reports)} direct reports`}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  },
};

export const CustomCards: Story = {
  name: 'Custom cards',
  args: { defaultCollapsed: ['vp-product-eng', 'head-people-ops'] },
  parameters: {
    docs: {
      description: {
        story:
          '`renderNode` replaces the card body and is handed `{ reports, total, depth }` rather than left to recompute them. The chart keeps the tree, the connectors, the keyboard, the menus and the labelling; the caller decides what a person looks like, a headcount, an open requisition, a flag from another module.',
      },
    },
  },
  render: (args) => (
    <Card>
      <CardHeader>
        <CardTitle>Headcount by manager</CardTitle>
      </CardHeader>
      <CardContent>
        <OrgChart
          {...args}
          renderNode={(node, info) => (
            <div className="space-y-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-sm font-medium text-fg">{node.name}</p>
                <span className="shrink-0 text-lg font-semibold tabular-nums text-fg">
                  {info.total}
                </span>
              </div>
              <p className="truncate text-2xs text-fg-subtle">{node.title}</p>
              <p className="text-2xs text-fg-subtle">
                {info.reports === 0 ? 'Individual contributor' : `${String(info.reports)} direct`} ·
                level {info.depth}
              </p>
            </div>
          )}
        />
      </CardContent>
    </Card>
  ),
};

export const Circular: Story = {
  name: 'A circular reporting line',
  args: {
    label: 'Reporting lines, with a bad chain',
    nodes: [
      ...reportingLine,
      { id: 'loop-a', name: 'Sam Reyes', title: 'Ops Manager', parentId: 'loop-b' },
      { id: 'loop-b', name: 'Kim Adeyemi', title: 'Ops Manager', parentId: 'loop-a' },
    ],
    defaultFocusId: 'cfo',
  },
  parameters: {
    docs: {
      description: {
        story:
          'Two people who manage each other. There is no root to reach them from, so the walk never does, and rather than recursing until the tab dies, the chart draws everything it can and names the people it could not place. The banner is the point: this is a data defect, and someone has to go and fix the chain.',
      },
    },
  },
  render: (args) => (
    <Card>
      <CardHeader>
        <CardTitle>Reporting lines</CardTitle>
      </CardHeader>
      <CardContent>
        <OrgChart {...args} />
      </CardContent>
    </Card>
  ),
};
