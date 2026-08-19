/**
 * The composite components.
 *
 * These are the parts of Reach that own real interaction rather than a shape:
 * a board with drag and drop, an org chart with pan and zoom, an editor, an
 * upload queue. Their examples hold state and, in several cases, mutate it from
 * a drop or a reorder, because a static screenshot of a Kanban board proves
 * nothing about the thing that is hard.
 */

import {
  Avatar,
  Badge,
  Button,
  FileUploader,
  Kanban,
  ModalPage,
  ModalPageBody,
  ModalPageClose,
  ModalPageContent,
  ModalPageFooter,
  ModalPageHeader,
  ModalPageTrigger,
  OrgChart,
  PageHeader,
  RichTextContent,
  RichTextEditor,
  SortableList,
  ToastProvider,
  ToastViewport,
  useToast,
  type KanbanMove,
  type OrgNode,
  type SortableMove,
  type UploadItem,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import type { DocPage } from './doc-types';

/* ------------------------------------------------------------------ boards -- */

interface Candidate {
  readonly id: string;
  readonly name: string;
  readonly role: string;
}

const kanban: DocPage = {
  slug: 'kanban',
  title: 'Kanban',
  description: 'Cards in columns, moved by drag, keyboard or menu.',
  when: 'Drag is never the only route. Every card carries a move menu, because a board that can only be operated by dragging is a board a keyboard user cannot use at all.',
  importLine: "import { Kanban } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      tall: true,
      blurb:
        'Try the grip, then try the card’s menu. The board keeps a throwaway copy of the item while it crosses a boundary, so the destination column can open a gap for it, and discards that copy on drop: the props stay the truth either side of the drag.',
      render: function KanbanDemo(): JSX.Element {
        const [items, setItems] = useState<Record<string, readonly Candidate[]>>({
          applied: [
            { id: 'c1', name: 'Grace Hopper', role: 'Principal Engineer' },
            { id: 'c2', name: 'Ada Lovelace', role: 'Staff Engineer' },
          ],
          screening: [{ id: 'c3', name: 'Radia Perlman', role: 'Network Engineer' }],
          offer: [{ id: 'c4', name: 'Joan Clarke', role: 'Cryptanalyst' }],
        });

        /*
         * `toIndex` is the position *after* removal from the source, so within
         * one column the splice is a straight move and needs no adjustment.
         */
        const onMove = (move: KanbanMove): void => {
          setItems((current) => {
            const from = [...(current[move.from] ?? [])];
            const index = from.findIndex((card) => card.id === move.itemId);
            if (index === -1) return current;
            const [moved] = from.splice(index, 1);
            if (!moved) return current;
            const to = move.from === move.to ? from : [...(current[move.to] ?? [])];
            to.splice(move.toIndex, 0, moved);
            return { ...current, [move.from]: from, [move.to]: to };
          });
        };

        return (
          <Kanban
            label="Candidate pipeline"
            className="w-full"
            columns={[
              { id: 'applied', title: 'Applied' },
              { id: 'screening', title: 'Screening', tone: 'accent' },
              { id: 'offer', title: 'Offer', tone: 'success', limit: 2 },
            ]}
            items={items}
            onMove={onMove}
            renderCard={(candidate) => (
              <div>
                <p className="text-sm font-medium text-fg">{candidate.name}</p>
                <p className="text-xs text-fg-muted">{candidate.role}</p>
              </div>
            )}
          />
        );
      },
      code: `<Kanban
  label="Candidate pipeline"
  columns={[
    { id: 'applied', title: 'Applied' },
    { id: 'screening', title: 'Screening', tone: 'accent' },
    { id: 'offer', title: 'Offer', tone: 'success', limit: 2 },
  ]}
  items={items}
  onMove={applyMove}
  renderCard={(candidate) => <CandidateCard candidate={candidate} />}
/>`,
    },
  ],
};

const sortable: DocPage = {
  slug: 'sortable',
  title: 'Sortable list',
  description: 'Rows the reader can put in their own order.',
  when: 'The grip is draggable, not the row. A draggable row cannot contain a working link or button, and it hijacks the text selection people do constantly on a list of names.',
  importLine: "import { SortableList } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      tall: true,
      render: function SortableDemo(): JSX.Element {
        const [rows, setRows] = useState([
          { id: 's1', label: 'Personal details' },
          { id: 's2', label: 'Right to work' },
          { id: 's3', label: 'Contract' },
          { id: 's4', label: 'Payroll' },
        ]);

        /*
         * `move.order` is the ids in their new order, so the handler is a
         * lookup rather than an index dance. That is the component doing the
         * arithmetic once, correctly, instead of every caller repeating it.
         */
        const onReorder = (move: SortableMove): void => {
          setRows((current) =>
            move.order.flatMap((id) => current.find((row) => row.id === id) ?? []),
          );
        };

        return (
          <SortableList
            items={rows}
            label="Onboarding steps"
            onReorder={onReorder}
            className="w-full max-w-sm"
          >
            {(row) => <span className="text-sm text-fg">{row.label}</span>}
          </SortableList>
        );
      },
      code: `<SortableList items={rows} label="Onboarding steps" onReorder={applyMove}>
  {(row) => <span>{row.label}</span>}
</SortableList>`,
    },
  ],
};

const orgChart: DocPage = {
  slug: 'org-chart',
  title: 'Org chart',
  description: 'Reporting lines, as a graph.',
  when: 'Org charts are graphs, not role tables. A node with no parent, or one pointing at an id that is not present, is a root.',
  importLine: "import { OrgChart } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      tall: true,
      render: function OrgChartDemo(): JSX.Element {
        const nodes: OrgNode[] = [
          { id: '1', name: 'Katherine Johnson', title: 'CTO' },
          { id: '2', name: 'Grace Hopper', title: 'Principal Engineer', parentId: '1' },
          { id: '3', name: 'Ada Lovelace', title: 'Staff Engineer', parentId: '2' },
          { id: '4', name: 'Radia Perlman', title: 'Network Engineer', parentId: '2' },
          { id: '5', name: 'Joan Clarke', title: 'Head of Payroll', parentId: '1' },
        ];
        return <OrgChart nodes={nodes} label="Engineering" className="h-72 w-full" />;
      },
      code: `<OrgChart
  label="Engineering"
  nodes={[
    { id: '1', name: 'Katherine Johnson', title: 'CTO' },
    { id: '2', name: 'Grace Hopper', title: 'Principal Engineer', parentId: '1' },
  ]}
/>`,
    },
  ],
};

/* ------------------------------------------------------------------ input -- */

const richText: DocPage = {
  slug: 'rich-text',
  title: 'Rich text',
  description: 'Formatted content that has to survive being stored and exported.',
  when: 'A `contenteditable` emits whatever markup the browser felt like. Content that is versioned, exported and shown to a labour inspector has to be identical on every browser, which is why this is ProseMirror and not a div.',
  importLine: "import { RichTextContent, RichTextEditor } from '@reach/ui';",
  sections: [
    {
      id: 'editor',
      title: 'Editor',
      tall: true,
      render: function RichTextDemo(): JSX.Element {
        const [value, setValue] = useState(
          '<p>Cover is arranged with <strong>Platform</strong> for the whole period.</p>',
        );
        return (
          <div className="w-full max-w-lg">
            <RichTextEditor
              value={value}
              onChange={setValue}
              label="Approval note"
              characterLimit={500}
            />
          </div>
        );
      },
      code: `const [value, setValue] = useState('');

<RichTextEditor value={value} onChange={setValue} label="Approval note" characterLimit={500} />`,
    },
    {
      id: 'read-only',
      title: 'Read-only',
      blurb:
        '`RichTextContent` renders stored HTML for reading. It expects markup that has already been sanitised on the server, and says so loudly in the console if it sees something a sanitiser would have removed.',
      render: () => (
        <RichTextContent
          className="w-full max-w-lg"
          sanitisedHtml="<p>Approved on <strong>15 August</strong>. Cover arranged with Platform.</p><ul><li>Five working days</li><li>Balance after: 13.5</li></ul>"
        />
      ),
      code: `<RichTextContent sanitisedHtml={note.html} />`,
    },
  ],
};

const fileUploader: DocPage = {
  slug: 'file-uploader',
  title: 'File uploader',
  description: 'A queue of files, each with its own state.',
  when: 'Upload state is per file, not per queue. One failure must not read as the whole batch failing, and the row that failed has to say what to do next.',
  importLine: "import { FileUploader } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      tall: true,
      render: function FileUploaderDemo(): JSX.Element {
        const [items, setItems] = useState<readonly UploadItem[]>([]);
        return (
          <div className="w-full max-w-sm">
            <FileUploader
              value={items}
              onChange={setItems}
              label="Right-to-work documents"
              accept={['application/pdf', 'image/png', 'image/jpeg']}
            />
          </div>
        );
      },
      code: `const [items, setItems] = useState<readonly UploadItem[]>([]);

<FileUploader
  value={items}
  onChange={setItems}
  label="Right-to-work documents"
  accept={['application/pdf', 'image/png']}
/>`,
    },
  ],
};

/* ----------------------------------------------------------------- layout -- */

const modalPage: DocPage = {
  slug: 'modal-page',
  title: 'Modal page',
  description: 'A full-screen task that is still an overlay.',
  when: 'For a flow too big for a dialog and too transient for a route: an onboarding wizard, a bulk import. The reader has one job and one way out.',
  importLine:
    "import { ModalPage, ModalPageBody, ModalPageContent, ModalPageHeader, ModalPageTrigger } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      tall: true,
      render: () => (
        <ModalPage>
          <ModalPageTrigger asChild>
            <Button variant="secondary">Start import</Button>
          </ModalPageTrigger>
          <ModalPageContent>
            <ModalPageHeader title="Import people" description="Step 1 of 3 · Upload a file" />
            <ModalPageBody>
              <p className="text-base text-fg-muted">
                A modal page fills the viewport but never becomes a route, so the list behind it
                keeps its scroll position and its filters.
              </p>
            </ModalPageBody>
            <ModalPageFooter>
              <ModalPageClose asChild>
                <Button>Cancel</Button>
              </ModalPageClose>
              <Button variant="primary">Continue</Button>
            </ModalPageFooter>
          </ModalPageContent>
        </ModalPage>
      ),
      code: `<ModalPage>
  <ModalPageTrigger asChild><Button>Start import</Button></ModalPageTrigger>
  <ModalPageContent>
    <ModalPageHeader title="Import people" description="Step 1 of 3" />
    <ModalPageBody>…</ModalPageBody>
    <ModalPageFooter>
      <ModalPageClose asChild><Button>Cancel</Button></ModalPageClose>
      <Button variant="primary">Continue</Button>
    </ModalPageFooter>
  </ModalPageContent>
</ModalPage>`,
    },
  ],
};

const pageLayout: DocPage = {
  slug: 'page-layout',
  title: 'Page layout',
  description: 'The five shapes every screen in the product takes.',
  when: 'Written by hand, each of those five gets re-derived per module with slightly different sticky behaviour and a different answer to where the safe-area padding goes, and the product stops feeling like one product.',
  importLine: "import { PageHeader, PageLayout, PageSection, Toolbar } from '@reach/ui';",
  sections: [
    {
      id: 'header',
      title: 'Page header',
      blurb:
        'The layout itself owns the whole viewport, so the piece shown here is its header. The guarantees are the interesting part: exactly one scroll container, one of each landmark, and safe-area insets applied per edge.',
      render: () => (
        <div className="w-full rounded-md border border-border bg-surface">
          <PageHeader
            title="Grace Hopper"
            description="Principal Engineer · Platform · Madrid"
            actions={
              <>
                <Button size="sm">Message</Button>
                <Button size="sm" variant="primary">
                  Edit
                </Button>
              </>
            }
          />
        </div>
      ),
      code: `<PageLayout
  preset="sidebar"
  header={<AppBar />}
  sidebar={<Nav />}
  contentLabel="Person"
>
  <PageHeader title="Grace Hopper" description="Principal Engineer" actions={<Actions />} />
  <PageSection title="Employment">…</PageSection>
</PageLayout>`,
    },
  ],
};

/* --------------------------------------------------------------- feedback -- */

/**
 * The toast example's buttons.
 *
 * A separate component because `useToast` has to run *inside* the provider,
 * and hoisted to module scope because declaring it inside the example's render
 * would create a new component type on every render and remount it.
 */
function ToastTriggers(): JSX.Element {
  const { toast } = useToast();
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="secondary"
        onClick={() => {
          toast({ title: 'Request approved', description: 'Grace has been notified.' });
        }}
      >
        Approve
      </Button>
      <Button
        variant="secondary"
        onClick={() => {
          toast({
            title: 'Could not reach Workday',
            description: 'Retried three times. The queue will pick it up.',
            tone: 'danger',
            action: { label: 'Retry now', onClick: () => undefined },
          });
        }}
      >
        Trigger a failure
      </Button>
    </div>
  );
}

const toast: DocPage = {
  slug: 'toast',
  title: 'Toast',
  description: 'Confirmation that something happened, without stopping the reader.',
  when: 'Never for anything the reader must act on. A toast leaves on its own, so an error that needs a decision belongs in an Alert or a dialog.',
  importLine: "import { ToastProvider, ToastViewport, useToast } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      tall: true,
      blurb:
        'The provider owns the queue and the viewport renders it, so a module mounts both once at the root and everything below calls `useToast`.',
      render: () => (
        <ToastProvider>
          <ToastTriggers />
          <ToastViewport />
        </ToastProvider>
      ),
      code: `// Once, at the root:
<ToastProvider>
  <App />
  <ToastViewport />
</ToastProvider>

// Anywhere below:
const { toast } = useToast();
toast({ title: 'Request approved', description: 'Grace has been notified.' });`,
    },
  ],
};

const imageUploader: DocPage = {
  slug: 'image-uploader',
  title: 'Image uploader',
  description: 'Pictures, with the dimension check a file input cannot do.',
  when: 'Intrinsic size is only knowable after the image decodes, so a minimum-dimension rule has to be enforced here rather than by `accept`.',
  importLine: "import { AvatarUploader, ImageUploader } from '@reach/ui';",
  sections: [
    {
      id: 'avatar',
      title: 'Avatar',
      tall: true,
      render: function AvatarUploaderDemo(): JSX.Element {
        const [value, setValue] = useState<string | null>(null);
        return (
          <div className="flex items-center gap-4">
            <Avatar name="Grace Hopper" src={value ?? undefined} size="lg" />
            <ImageUploaderStub onPick={setValue} />
          </div>
        );
      },
      code: `<AvatarUploader value={image} onChange={setImage} label="Profile picture" name="Grace Hopper" />`,
    },
  ],
};

/**
 * The avatar example's picker.
 *
 * `AvatarUploader` reads a real `File` and holds an object URL, which a static
 * documentation page cannot supply without a file dialog the reader did not
 * ask for. This shows the surrounding composition, an avatar that falls back to
 * initials, and points at Storybook for the upload states themselves.
 */
function ImageUploaderStub({ onPick }: { onPick: (value: string | null) => void }): JSX.Element {
  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            onPick(null);
          }}
        >
          Clear
        </Button>
        <Badge tone="info">Upload states in Storybook</Badge>
      </div>
      <p className="max-w-56 text-xs text-fg-subtle">
        The uploader needs a real file, so the interactive states live in Storybook rather than
        here.
      </p>
    </div>
  );
}

export const COMPLEX_PAGES: readonly DocPage[] = [
  fileUploader,
  imageUploader,
  kanban,
  modalPage,
  orgChart,
  pageLayout,
  richText,
  sortable,
  toast,
];
