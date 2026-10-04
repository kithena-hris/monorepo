import {
  Alert,
  Avatar,
  AvatarUploader,
  Badge,
  Button,
  Card,
  CircularProgress,
  DatePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  Input,
  PageHeader,
  PageSection,
  RadioCard,
  RadioGroup,
  Separator,
  Stack,
  TertiaryNav,
  Textarea,
  Tooltip,
  icons,
  useScreenCommand,
  useShortcutKeys,
  keysOf,
  KbdShortcut,
  usePageHeaderFrame,
  type IsoDate,
  type UploadedImage,
} from '@reach/ui';
import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';

import { useHeld } from '../held';
import { Loaded, type Checked, type Loadable, type Outcome } from '../load';
import { AttributeInput, PeopleSearch, type SearchPeople } from '../record/attribute-input';
import { DisplayValue, longDate } from '../record/display';
import { FieldFiles, isFileField, type FileInfo, type UploadOutcome } from '../record/files';
import {
  isMissing,
  type AttributeValue,
  type PendingValue,
  type RecordField,
  type RecordSection,
  type Values,
} from '../record/model';
import { MissingJump, MissingMark } from '../record/missing';
import { ReportingLine, type ReportingLineState } from './reporting-line';
import { PendingNote, SensitiveMark } from '../record/pending';
import { ReviewNotices, type IdentifierReview } from '../record/review-notices';
import { SectionForm } from '../record/section-form';
import {
  EmploymentMove,
  EmploymentPeriods,
  isDestructiveMove,
  moveLabel,
  offeredMoves,
  type MoveKind,
  PlacementPickers,
  statusLabel,
  type EmploymentState,
  type LifecycleMove,
  type PlacementState,
} from './employment';

export interface ProfileSection extends RecordSection {
  /** Reading this section is audited, and the viewer is told so. */
  readonly readsLogged: boolean;
}

export interface ProfileState {
  readonly person: {
    readonly name: string;
    /** "Support Engineer · Barcelona · started 1 Sep 2026", from what the viewer may read. */
    readonly summary: string | null;
    readonly avatarUrl: string | null;
    /** Missing required values, or null when this viewer is not shown completeness. */
    readonly missing: number | null;
    /** The viewer may choose this photo: it is theirs, or they are HR. */
    readonly canChangePhoto?: boolean;
    /** The viewer, a People administrator, may view the app as them. */
    readonly canViewAs?: boolean;
  };
  /**
   * Only what this viewer may read, already filtered by the application layer.
   * A withheld field is not here, and a section with none left is not here
   * either.
   */
  readonly sections: readonly ProfileSection[];
  readonly values: Values;
  /** HR's alone: whose day it is for them (PEO-119). Absent or null for anybody else. */
  readonly calendar?: EmploymentState['calendar'] | null;
  /** HR's alone, with the calendar: where they stand and every period (PEO-120). */
  readonly employment?: EmploymentState['employment'];
  /**
   * Where the person sits and where they may go (PEO-123), for HR only;
   * null or absent for everybody else.
   */
  readonly placement?: PlacementState | null;
  /** Their doubted identifiers still open, on fields the viewer reads (PEO-125). */
  readonly reviews?: readonly IdentifierReview[];
  /**
   * Changes waiting for HR's approval (PEO-077), on fields the viewer reads.
   * Never in `values`, which are what is in force.
   */
  readonly pending?: readonly PendingValue[];
  /** Empty fields somebody asked this person to fill in, and who asked. */
  readonly requests?: readonly DetailRequest[];
  /** What each image or document value is: its name and type. */
  readonly files?: readonly FileInfo[];
  /** Who they report to, up to the top, and their peers. */
  readonly reportingLine?: ReportingLineState;
}

export interface DetailRequest {
  readonly key: string;
  readonly label: string;
  readonly requestedAt: string;
  /** Who asked, in words the viewer may read. */
  readonly by: string;
}

export type { PlacementState };

export interface PlacementChange {
  readonly legalEntityId?: string | null;
  readonly locationId?: string | null;
  readonly effectiveFrom?: string;
}

/**
 * What is open over the record, in the address (`?open=`), so a link opens
 * it in the server's HTML: a move (`move:terminate`), a dated change to one
 * field (`change:salary`), the placement, the PDF, or viewing as them.
 */
export type ProfileOpen = string;

export interface ProfileProps {
  readonly load: Loadable<ProfileState>;
  readonly onSave: (sectionKey: string, changed: Values) => Promise<Outcome>;
  /** What our checks would warn about a national identifier, before it is saved (PEO-125). */
  readonly onCheck?: (sectionKey: string, changed: Values) => Promise<Checked>;
  /** A lifecycle move on this person (PEO-120); absent on one's own profile. */
  readonly onMove?: (move: LifecycleMove) => Promise<Outcome>;
  /** Move the person (PEO-123). Absent where the shell offers no move. */
  readonly onPlace?: (placement: PlacementChange) => Promise<Outcome>;
  /** Finds people for a person field, by name, over everybody (PEO-122). */
  readonly searchPeople?: SearchPeople;
  /** The record's history, its own page (PEO-064): the address it is at. */
  readonly historyHref?: string;
  /** Take back a change of one's own that waits for approval (PEO-077). */
  readonly onWithdraw?: (changeId: string) => Promise<Outcome>;
  /** A requester no other HR member can approve for, approving their own held change, once they confirm (PEO-077). */
  readonly onSelfApprove?: (changeId: string) => Promise<Outcome>;
  /** Open the review queue, where HR decides (PEO-077). */
  readonly onApprovals?: () => void;
  /** This record as a PDF, as the viewer may read it (PEO-061). Absent where not offered. */
  readonly onDownloadRecord?: (reason: string) => Promise<Outcome>;
  /**
   * A People administrator views the app as this person, read-only, for
   * thirty minutes, with a reason; offered where People says it may be
   * (`person.canViewAs`). The page is then theirs, so the host moves on.
   */
  readonly onViewAs?: (reason: string) => Promise<Outcome>;
  /** A new photo, picked here: uploaded by the shell, which answers with where it now is. */
  readonly onPhoto?: (file: File) => Promise<PhotoOutcome>;
  /** Open with this field's section in edit mode and the cursor in it: a link to one missing detail. */
  readonly focusField?: string;
  /** The section being edited (`?edit=<key>`), held by the host; null for none. */
  readonly editing?: string | null;
  readonly onEditingChange?: (section: string | null) => void;
  /** What is open over the record (`?open=`), held by the host; null for nothing. */
  readonly open?: ProfileOpen | null;
  readonly onOpenChange?: (open: ProfileOpen | null) => void;
  /**
   * Ask the person to fill in these empty fields: they are emailed. Absent on
   * one's own profile; offered beside a field only where People says it may be.
   */
  readonly onRequest?: (keys: readonly string[]) => Promise<Outcome>;
  /** Keep a file for an image or document field; saving the field points the record at it. */
  readonly onUploadFile?: (key: string, file: File) => Promise<UploadOutcome>;
  /**
   * HR's: change one value from a date (W11), today or later, as People's
   * effective-dated write. A sensitive field goes for approval instead.
   */
  readonly onChangeDated?: (change: {
    readonly values: Values;
    readonly effectiveFrom: string;
  }) => Promise<Outcome>;
}

export type PhotoOutcome =
  | { readonly ok: true; readonly avatarUrl: string | null }
  | { readonly ok: false; readonly message: string };

/**
 * One person's record, for whoever is looking (D1, D3; PRD §6.6).
 *
 * One layout for every record and every viewer, one's own included: on the
 * left the record card (how complete it is, its sections with what each is
 * missing, and History) and the reporting line; on the right what needs
 * attention, then every section. Each field's actions sit on its own row.
 * A field the viewer cannot read is absent: no label, no padlock, no greyed
 * row, no empty section — each of those would say the field exists, and for
 * a self-ID answer that is the disclosure itself. This component renders what
 * it is given and cannot re-add a key the application layer removed.
 */
export function Profile({ load, searchPeople, onUploadFile, ...props }: ProfileProps): JSX.Element {
  return (
    <PeopleSearch.Provider value={searchPeople ?? null}>
      <Loaded load={load} what="this profile">
        {(state) => (
          <FieldFiles.Provider
            value={{
              upload: onUploadFile ?? null,
              known: new Map((state.files ?? []).map((f) => [f.id, f])),
            }}
          >
            <Record state={state} {...props} />
          </FieldFiles.Provider>
        )}
      </Loaded>
    </PeopleSearch.Provider>
  );
}

/** Fields that need a whole row of the form: long text, lists, files. */
const WIDE = new Set(['long_text', 'address', 'multi_select', 'tags']);

function Record({
  state,
  onSave,
  onCheck,
  onMove,
  onPlace,
  historyHref,
  onWithdraw,
  onSelfApprove,
  onApprovals,
  onDownloadRecord,
  onViewAs,
  onPhoto,
  focusField,
  onRequest,
  onChangeDated,
  editing: heldEditing,
  onEditingChange,
  open: heldOpen,
  onOpenChange,
}: Omit<ProfileProps, 'load' | 'searchPeople' | 'onUploadFile'> & {
  readonly state: ProfileState;
}): JSX.Element {
  // A link to one missing detail opens its section, with the cursor in it.
  const sectionOf = (key: string | undefined): string | null =>
    key === undefined
      ? null
      : (state.sections.find((s) => s.fields.some((f) => f.key === key && !f.readOnly))?.key ??
        null);
  const [editingHeld, setEditing] = useHeld<string | null>(heldEditing, onEditingChange, null);
  const editing = editingHeld ?? sectionOf(focusField);
  const [focus, setFocus] = useState<string | undefined>(focusField);
  const [opened, setOpened] = useHeld<string | null>(heldOpen, onOpenChange, null);
  const openOne = (key: string): void => {
    const at = sectionOf(key);
    if (at !== null) {
      setEditing(at);
      setFocus(key);
    } else {
      document.getElementById(`field-${key}`)?.scrollIntoView({ block: 'center' });
    }
  };
  // A gap somebody else fills is shown where it is: there is nothing to open.
  useEffect(() => {
    if (focusField !== undefined && sectionOf(focusField) === null) {
      document.getElementById(`field-${focusField}`)?.scrollIntoView({ block: 'center' });
    }
    // Once, for the link that opened the page.
  }, []);
  const [values, setValues] = useState<Values>(state.values);
  // What the server now holds, whenever the screen is read again (a move, a
  // decision, another tab): a save's own echo is kept locally until then.
  useEffect(() => {
    setValues(state.values);
  }, [state.values]);
  /** Per section, the fields its last save sent for approval rather than saved (PEO-077). */
  const [held, setHeld] = useState<Readonly<Record<string, readonly string[]>>>({});
  const pending = state.pending ?? [];
  const decidable = pending.filter((p) => p.canDecide).length;
  // Defensive as well as tidy: a section handed over with no fields would
  // still print its heading, and a heading is a disclosure.
  const sections = state.sections.filter((s) => s.fields.length > 0);
  const { person } = state;
  // Truthful to the verdict and to the screen: a gap is a field People said
  // is missing that is still empty here.
  const gapsIn = (section: RecordSection) =>
    section.fields.filter((f) => f.missing === true && isMissing(values[f.key]));
  const gaps = sections.flatMap(gapsIn);
  const requests = new Map((state.requests ?? []).map((r) => [r.key, r]));
  // What may be asked of them now: empty, and theirs to fill in.
  const askable =
    onRequest === undefined
      ? []
      : sections
          .flatMap((s) => s.fields)
          .filter((f) => f.askable === true && isMissing(values[f.key]));
  const firstName = person.name.split(' ')[0] ?? person.name;
  const status = state.employment?.status ?? null;
  const frame = usePageHeaderFrame();
  const firstWritable = sections.find((s) => s.fields.some((f) => !f.readOnly));
  // Their own record (D3): nobody moves their own employment or asks themselves.
  const own = onMove === undefined && onRequest === undefined && person.missing !== null;
  const required = sections.flatMap((s) => s.fields).filter((f) => f.required).length;
  const percent =
    required === 0
      ? 100
      : Math.round(((required - Math.min(gaps.length, required)) / required) * 100);
  const forOthers = gaps.filter((g) => g.readOnly).length;
  const [notice, setNotice] = useState<string | null>(null);
  // Viewing as them: an administrator's, where People offers it. `V` and ⌘K
  // open the same dialog as the menu.
  const viewAs = onViewAs !== undefined && person.canViewAs === true ? onViewAs : undefined;
  useScreenCommand(
    viewAs === undefined
      ? null
      : {
          id: 'view-as',
          label: `View as ${person.name}`,
          run: () => {
            setOpened('view-as');
          },
        },
  );
  const close = (): void => {
    setOpened(null);
  };
  // What is open, checked against what this record and viewer offer.
  const moves = onMove === undefined || !state.calendar ? [] : offeredMoves(status);
  const moving = moves.find((m) => opened === `move:${m}`) ?? null;
  const dating =
    onChangeDated === undefined || !state.calendar || !opened?.startsWith('change:')
      ? null
      : (sections
          .flatMap((s) => s.fields)
          .find((f) => `change:${f.key}` === opened && !f.readOnly && !isFileField(f)) ?? null);
  const askAll =
    askable.length === 0 || onRequest === undefined
      ? null
      : {
          label:
            askable.length === 1
              ? `Ask ${firstName} for ${askable[0]?.label ?? 'this'}`
              : `Ask ${firstName} for ${String(askable.length)} empty details`,
          run: () => {
            void onRequest(askable.map((f) => f.key)).then((outcome) => {
              setNotice(
                outcome.ok
                  ? `${firstName} has been asked, by email.`
                  : `Not sent: ${outcome.message}`,
              );
            });
          },
        };

  // The record's parts, as the record card lists them and a phone's pills.
  const parts = [
    ...sections.map((section) => {
      const n = gapsIn(section).length;
      return {
        id: `section-${section.key}`,
        label: section.label,
        ...(person.missing === null
          ? {}
          : {
              status: n === 0 ? ('success' as const) : ('warning' as const),
              ...(n === 0
                ? {}
                : {
                    badge: <MissingMark count={n} />,
                    shortLabel: `${section.label} · ${String(n)}`,
                  }),
            }),
      };
    }),
  ];
  const history =
    historyHref === undefined ? null : { id: 'history', label: 'History', href: historyHref };

  return (
    <Stack gap={6}>
      <div className="flex flex-col gap-4">
        {frame.breadcrumb}
        <div className="flex flex-wrap items-center gap-5 touch:flex-col touch:text-center">
          {onPhoto !== undefined && person.canChangePhoto === true ? (
            <PhotoPicker name={person.name} src={person.avatarUrl} onPhoto={onPhoto} />
          ) : (
            <Avatar
              size="3xl"
              name={person.name}
              src={person.avatarUrl ?? undefined}
              {...(status === 'active'
                ? { status: 'success' as const, statusLabel: 'Active' }
                : {})}
            />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-3 touch:w-full touch:items-center">
            <PageHeader
              className="touch:items-center"
              // The trail is drawn above the photo; the header has none of its own.
              breadcrumb={false}
              title={person.name}
              description={person.summary ?? undefined}
              meta={
                status === null && person.missing === null && !state.calendar ? undefined : (
                  <span className="flex flex-wrap items-center gap-2 touch:justify-center">
                    {status === null ? null : (
                      <Badge dot tone={status === 'active' ? 'success' : 'neutral'}>
                        {statusLabel(status)}
                      </Badge>
                    )}
                    {person.missing === null ? null : gaps.length === 0 ? (
                      <Badge tone="success">Complete</Badge>
                    ) : (
                      <MissingJump
                        labels={gaps.map((g) => g.label)}
                        onJump={() => {
                          const first = gaps[0];
                          if (first !== undefined) openOne(first.key);
                        }}
                      />
                    )}
                    {/* HR's: what day it is for them, on their own clock (PEO-119). */}
                    {state.calendar ? (
                      <Badge>
                        <icons.scheduled aria-hidden />
                        Their day:{' '}
                        <span data-testid="their-day">
                          {longDate(state.calendar.today)}, {state.calendar.timeZone}
                        </span>
                      </Badge>
                    ) : null}
                  </span>
                )
              }
              actions={
                <span className="flex items-center gap-2">
                  {askAll === null ? null : (
                    <Button
                      startIcon={<icons.send aria-hidden />}
                      className="touch:hidden"
                      onClick={askAll.run}
                    >
                      Ask {firstName}
                    </Button>
                  )}
                  <RecordActions
                    moves={moves}
                    onMove={(kind) => {
                      setOpened(`move:${kind}`);
                    }}
                    {...(state.placement && onPlace
                      ? {
                          onPlacement: () => {
                            setOpened('placement');
                          },
                        }
                      : {})}
                    firstMissing={gaps[0] ?? null}
                    onFirstMissing={(key) => {
                      openOne(key);
                    }}
                    askFor={askAll}
                    historyHref={historyHref}
                    onDownload={
                      onDownloadRecord === undefined
                        ? undefined
                        : () => {
                            setOpened('pdf');
                          }
                    }
                    viewAsLabel={viewAs === undefined ? null : `View as ${firstName}`}
                    onViewAs={() => {
                      setOpened('view-as');
                    }}
                  />
                  {firstWritable === undefined ? null : (
                    <Button
                      variant="primary"
                      startIcon={<icons.edit aria-hidden />}
                      onClick={() => {
                        setEditing(firstWritable.key);
                      }}
                    >
                      Edit
                    </Button>
                  )}
                </span>
              }
            />
            {notice === null ? null : (
              <p role="status" className="text-sm text-fg-muted">
                {notice}
              </p>
            )}
          </div>
        </div>
        {/*
          Under a finger, the ways to reach them, as a phone's contact card
          has them: only those their record holds for this viewer.
        */}
        <div className="hidden gap-2 touch:grid touch:grid-cols-3">
          {typeof values['work_email'] === 'string' && values['work_email'] !== '' ? (
            <Button asChild startIcon={<icons.email aria-hidden />}>
              <a href={`mailto:${values['work_email']}`}>Email</a>
            </Button>
          ) : null}
          {typeof values['work_phone'] === 'string' && values['work_phone'] !== '' ? (
            <Button asChild startIcon={<icons.phone aria-hidden />}>
              <a href={`tel:${values['work_phone']}`}>Call</a>
            </Button>
          ) : null}
          <Button asChild startIcon={<icons.organisation aria-hidden />}>
            <a href="/people/directory/org-chart">Org chart</a>
          </Button>
        </div>
      </div>
      {moving === null || onMove === undefined || !state.calendar ? null : (
        <EmploymentMove
          kind={moving}
          state={{ calendar: state.calendar, employment: state.employment ?? null }}
          onMove={onMove}
          name={person.name}
          placement={state.placement}
          onClose={close}
        />
      )}
      {onDownloadRecord === undefined ? null : (
        <RecordPdf
          name={firstName}
          open={opened === 'pdf'}
          onOpenChange={(next) => {
            setOpened(next ? 'pdf' : null);
          }}
          onDownload={onDownloadRecord}
        />
      )}
      {viewAs === undefined ? null : (
        <ViewAsDialog
          name={person.name}
          open={opened === 'view-as'}
          onOpenChange={(next) => {
            setOpened(next ? 'view-as' : null);
          }}
          onViewAs={viewAs}
        />
      )}
      {dating === null || onChangeDated === undefined ? null : (
        <DatedChange
          field={dating}
          name={person.name}
          current={values[dating.key]}
          today={state.calendar?.today ?? null}
          onChange={onChangeDated}
          onClose={close}
        />
      )}
      {/* Where they work (PEO-123): changed from Actions, dated, in a dialog. */}
      {state.placement && onPlace && opened === 'placement' ? (
        <PlacementDialog placement={state.placement} onPlace={onPlace} onClose={close} />
      ) : null}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 @5xl/page:grid-cols-[18rem_minmax(0,1fr)] @5xl/page:items-start">
        {/* The record card and the reporting line, the same for every viewer (D1). */}
        <Stack gap={6} className="@5xl/page:sticky @5xl/page:top-6">
          {parts.length + (history === null ? 0 : 1) < 2 && person.missing === null ? null : (
            <Card padded className="flex flex-col gap-4 touch:hidden">
              {person.missing === null ? null : (
                <div className="flex items-center gap-3">
                  <CircularProgress
                    value={percent}
                    size={52}
                    label={own ? 'Your record' : 'Complete'}
                    tone={percent === 100 ? 'success' : 'accent'}
                  />
                  <div className="min-w-0">
                    <p className="font-display text-md font-bold">
                      {own ? 'Your record' : `${String(percent)}% complete`}
                    </p>
                    <p className="text-sm text-fg-muted">
                      {gaps.length === 0
                        ? 'Nothing left to fill in'
                        : own
                          ? `${String(percent)}% complete · ${String(gaps.length)} ${gaps.length === 1 ? 'detail' : 'details'} left`
                          : `${String(gaps.length)} ${gaps.length === 1 ? 'detail' : 'details'} left${forOthers === 0 ? '' : `, ${String(forOthers)} for ${gaps.find((g) => g.readOnly)?.ownedBy ?? 'HR'}`}`}
                    </p>
                  </div>
                </div>
              )}
              <TertiaryNav label="Parts of the record" variant="fill" items={parts} />
              {history === null ? null : (
                <>
                  <Separator />
                  <TertiaryNav label="The record’s history" variant="fill" items={[history]} />
                </>
              )}
            </Card>
          )}
          {state.reportingLine === undefined ? null : (
            <div className="touch:hidden">
              <ReportingLine
                line={state.reportingLine}
                person={{ name: person.name, title: person.summary, avatarUrl: person.avatarUrl }}
              />
            </div>
          )}
        </Stack>
        <Stack gap={6} className="min-w-0">
          {/* Under a finger: how far along their own record is, first (MD2). */}
          {own && person.missing !== null ? (
            <Card padded className="hidden items-center gap-3 touch:flex">
              <CircularProgress
                value={percent}
                size={52}
                label="Your record"
                tone={percent === 100 ? 'success' : 'accent'}
              />
              <div className="min-w-0">
                <p className="font-display text-md font-bold">Your record</p>
                <p className="text-sm text-fg-muted">
                  {percent}% complete
                  {gaps.length === 0
                    ? ''
                    : ` · ${String(gaps.length)} ${gaps.length === 1 ? 'detail' : 'details'} left`}
                </p>
              </div>
            </Card>
          ) : null}
          <ReviewNotices
            reviews={state.reviews}
            onCorrect={(key) => {
              // The section that asks for it, open to edit.
              const at = sections.find((s) => s.fields.some((f) => f.key === key && !f.readOnly));
              if (at) setEditing(at.key);
            }}
          />
          {decidable === 0 ? null : (
            <Alert
              tone="warning"
              title={`${String(decidable)} ${decidable === 1 ? 'change waits' : 'changes wait'} for your approval`}
              action={
                onApprovals === undefined ? undefined : (
                  <Button size="sm" onClick={onApprovals}>
                    Open in Review
                  </Button>
                )
              }
            >
              Pending values are shown under their fields and are not applied until approved.
            </Alert>
          )}
          {/* Asked of them, on their own profile: what, and by whom. */}
          {onRequest !== undefined || requests.size === 0 ? null : (
            <Alert
              tone="info"
              icon={<icons.send aria-hidden />}
              title={`${[...requests.values()][0]?.by ?? 'HR'} asked you to add ${
                requests.size === 1 ? 'a detail' : `${String(requests.size)} details`
              }: ${[...requests.values()].map((r) => r.label).join(' and ')}.`}
              action={
                <Button
                  size="sm"
                  onClick={() => {
                    const first = [...requests.keys()][0];
                    if (first !== undefined) openOne(first);
                  }}
                >
                  {requests.size === 1 ? 'Add it' : 'Add them'}
                </Button>
              }
            />
          )}
          {/* Under a finger, the sections as pills, History last (MD1). */}
          {parts.length + (history === null ? 0 : 1) < 2 ? null : (
            <TertiaryNav
              label="Sections of the record"
              orientation="horizontal"
              className="hidden touch:block"
              items={history === null ? parts : [...parts, history]}
            />
          )}
          {sections.length === 0 ? (
            <EmptyState title="Nothing else to show" />
          ) : (
            sections.map((section) => {
              const writable = section.fields.some((f) => !f.readOnly);
              const isEditing = editing === section.key;
              return (
                <PageSection
                  key={section.key}
                  id={`section-${section.key}`}
                  surface
                  className="@container scroll-mt-4"
                  title={section.label}
                  actions={
                    <span className="flex items-center gap-2">
                      {gapsIn(section).length === 0 || isEditing ? null : (
                        <MissingMark count={gapsIn(section).length} />
                      )}
                      {section.readsLogged && !isEditing ? (
                        <Badge size="sm">
                          <icons.visible aria-hidden />
                          Reads are logged
                        </Badge>
                      ) : null}
                      {isEditing ? (
                        <Badge size="sm" tone="accent">
                          Editing
                        </Badge>
                      ) : writable ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          startIcon={<icons.edit aria-hidden />}
                          aria-label={`Edit ${section.label}`}
                          onClick={() => {
                            setEditing(section.key);
                          }}
                        >
                          Edit
                        </Button>
                      ) : null}
                    </span>
                  }
                >
                  {(held[section.key] ?? []).length === 0 || isEditing ? null : (
                    <Alert tone="info" title="Sent to HR for approval">
                      {(held[section.key] ?? []).join(' and ')}{' '}
                      {(held[section.key] ?? []).length === 1 ? 'is' : 'are'} not changed until HR
                      approves; the record keeps what it had until then.
                    </Alert>
                  )}
                  {isEditing ? (
                    <SectionForm
                      section={section}
                      values={values}
                      pending={pending}
                      columns={2}
                      wide={(f) => WIDE.has(f.dataType) || isFileField(f)}
                      hint="Only changed fields are sent."
                      {...(onWithdraw === undefined ? {} : { onWithdraw })}
                      {...(onSelfApprove === undefined ? {} : { onSelfApprove })}
                      {...(onCheck === undefined ? {} : { onCheck })}
                      {...(focus === undefined ? {} : { focusKey: focus })}
                      footer={
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setEditing(null);
                          }}
                        >
                          Cancel
                        </Button>
                      }
                      onSave={async (key, changed) => {
                        const outcome = await onSave(key, changed);
                        if (outcome.ok) {
                          // A value sent for approval is not the record's yet (PEO-077).
                          const waiting = new Set(outcome.held ?? []);
                          const applied = Object.fromEntries(
                            Object.entries(changed).filter(
                              ([k]) =>
                                !waiting.has(section.fields.find((f) => f.key === k)?.label ?? k),
                            ),
                          );
                          setValues((v) => ({ ...v, ...applied }));
                          setHeld((h) => ({ ...h, [key]: outcome.held ?? [] }));
                          setEditing(null);
                        }
                        return outcome;
                      }}
                    />
                  ) : (
                    <dl className="-mt-1 flex flex-col">
                      {section.fields.map((field) => (
                        <FieldRow
                          key={field.key}
                          field={field}
                          value={values[field.key]}
                          pending={pending.filter((p) => p.key === field.key)}
                          firstName={firstName}
                          asked={requests.get(field.key) ?? null}
                          onAdd={
                            field.readOnly
                              ? undefined
                              : () => {
                                  openOne(field.key);
                                }
                          }
                          onRequest={field.askable === true ? onRequest : undefined}
                          onDated={
                            onChangeDated === undefined ||
                            !state.calendar ||
                            field.readOnly ||
                            isFileField(field)
                              ? undefined
                              : () => {
                                  setOpened(`change:${field.key}`);
                                }
                          }
                          onWithdraw={onWithdraw}
                          onSelfApprove={onSelfApprove}
                        />
                      ))}
                    </dl>
                  )}
                </PageSection>
              );
            })
          )}
          <EmploymentPeriods periods={state.employment?.periods ?? []} />
          {state.reportingLine === undefined ? null : (
            <div className="hidden touch:block">
              <ReportingLine
                line={state.reportingLine}
                person={{ name: person.name, title: person.summary, avatarUrl: person.avatarUrl }}
              />
            </div>
          )}
        </Stack>
      </div>
    </Stack>
  );
}

/**
 * One field, read (D1): its label and what marks it, its value with anything
 * waiting under it, and on the row's end what may be done to it — a dated
 * change for HR, Ask or Asked for whoever may ask, Add for the person.
 */
function FieldRow({
  field,
  value,
  pending,
  firstName,
  asked,
  onAdd,
  onRequest,
  onDated,
  onWithdraw,
  onSelfApprove,
}: {
  readonly field: RecordField;
  readonly value: AttributeValue | undefined;
  readonly pending: readonly PendingValue[];
  readonly firstName: string;
  readonly asked: DetailRequest | null;
  readonly onAdd: (() => void) | undefined;
  readonly onRequest: ((keys: readonly string[]) => Promise<Outcome>) | undefined;
  readonly onDated: (() => void) | undefined;
  readonly onWithdraw: ProfileProps['onWithdraw'];
  readonly onSelfApprove: ProfileProps['onSelfApprove'];
}): JSX.Element {
  const empty = isMissing(value);
  const gap = field.missing === true && empty;
  const trail: ReactNode[] = [];
  if (onRequest !== undefined && empty) {
    trail.push(
      <AskButton
        key="ask"
        field={field.label}
        keyName={field.key}
        firstName={firstName}
        asked={asked}
        onRequest={onRequest}
      />,
    );
  } else if (gap && onAdd !== undefined) {
    trail.push(
      <Button key="add" size="xs" aria-label={`Add ${field.label}`} onClick={onAdd}>
        Add
      </Button>,
    );
  }
  if (onDated !== undefined) {
    trail.push(
      <Tooltip key="dated" content={`Change ${field.label} from a date`}>
        <Button
          variant="ghost"
          size="xs"
          aria-label={`Change ${field.label} from a date`}
          startIcon={<icons.history aria-hidden />}
          onClick={onDated}
        />
      </Tooltip>,
    );
  }
  return (
    <div className="grid min-h-12 items-center gap-x-4 gap-y-1 border-b border-border py-1.5 last:border-b-0 @md:grid-cols-[11.25rem_minmax(0,1fr)_auto] touch:py-2.5">
      <dt
        id={`field-${field.key}`}
        className="flex flex-wrap items-center gap-1.5 text-sm text-fg-muted"
      >
        {field.label}
        <SensitiveMark field={field} />
        {gap ? <MissingMark /> : null}
      </dt>
      <dd className="flex min-w-0 flex-col gap-1.5 text-sm font-medium touch:text-base">
        {gap ? (
          <span className="font-normal text-fg-muted">
            {field.readOnly
              ? `Not provided yet. ${field.ownedBy ?? 'HR'} fills this in.`
              : 'Not provided yet.'}
          </span>
        ) : (
          <DisplayValue field={field} value={value} />
        )}
        {pending.map((p) => (
          <PendingNote
            key={p.id}
            field={field}
            pending={p}
            onWithdraw={onWithdraw}
            onSelfApprove={onSelfApprove}
          />
        ))}
      </dd>
      {trail.length === 0 ? (
        <dd className="hidden @md:block" />
      ) : (
        <dd className="flex items-center gap-1 justify-self-start @md:justify-self-end">{trail}</dd>
      )}
    </div>
  );
}

/**
 * One value, changed from a date (D4): the new value, when it takes effect,
 * and what happens because of it, in a centred dialog since it is one value
 * and one date. Today, or a day People applies it on; a sensitive field goes
 * to Review and applies only once somebody else agrees. Every change keeps
 * the value it replaces in the history.
 */
function DatedChange({
  field,
  name,
  current,
  today,
  onChange,
  onClose,
}: {
  readonly field: RecordField;
  readonly name: string;
  readonly current: AttributeValue | undefined;
  /** Today on their calendar, from the record: never the browser's clock. */
  readonly today: string | null;
  readonly onChange: NonNullable<ProfileProps['onChangeDated']>;
  readonly onClose: () => void;
}): JSX.Element {
  const [value, setValue] = useState<AttributeValue>(current ?? null);
  const [when, setWhen] = useState<'today' | 'date'>('today');
  const [from, setFrom] = useState<IsoDate | null>(null);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const effectiveFrom = when === 'today' ? today : from;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-140">
        <form
          aria-label={`Change ${field.label}`}
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (effectiveFrom === null) return;
            setBusy(true);
            setRefused(null);
            void onChange({ values: { [field.key]: value }, effectiveFrom }).then((outcome) => {
              setBusy(false);
              if (outcome.ok) onClose();
              else setRefused(outcome.message);
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Change {field.label}</DialogTitle>
            <DialogDescription>{name} · the old value stays in the history</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Stack gap={4}>
              <AttributeInput
                field={{ ...field, label: 'New value', readOnly: false }}
                value={value}
                onChange={setValue}
              />
              <Field>
                <FieldLabel>When does it take effect?</FieldLabel>
                <RadioGroup
                  value={when}
                  orientation="horizontal"
                  className="grid gap-2.5 sm:grid-cols-2"
                  onValueChange={(next) => {
                    setWhen(next === 'date' ? 'date' : 'today');
                  }}
                >
                  <RadioCard value="today" description="From the start of their day.">
                    Today
                  </RadioCard>
                  <RadioCard value="date" description="It shows as scheduled until then.">
                    On a date
                  </RadioCard>
                </RadioGroup>
              </Field>
              {when === 'date' ? (
                <Field>
                  <FieldLabel>Takes effect on</FieldLabel>
                  <FieldControl>
                    <DatePicker
                      label="Takes effect on"
                      value={from}
                      onChange={setFrom}
                      {...(today === null ? {} : { today })}
                    />
                  </FieldControl>
                </Field>
              ) : null}
              {field.sensitive === true ? (
                <Alert tone="warning" title="This needs a second approver">
                  Another HR member approves sensitive changes. The record keeps what it has until
                  then.
                </Alert>
              ) : null}
              {refused === null ? null : (
                <Alert tone="danger" title="Not changed">
                  {refused}
                </Alert>
              )}
            </Stack>
          </DialogBody>
          <DialogFooter>
            <Button type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={busy}
              loadingLabel="Saving"
              disabled={effectiveFrom === null}
              shortcut="form.submit"
            >
              {field.sensitive === true ? 'Send for approval' : 'Save change'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Ask the person for one empty detail, on the field's row: "Ask", then
 * "Asked", its whole meaning in the tooltip and the accessible name alike.
 * Once asked, it says when and by whom; pressing it again within the day
 * records it and sends no second email.
 */
function AskButton({
  field,
  keyName,
  firstName,
  asked,
  onRequest,
}: {
  readonly field: string;
  readonly keyName: string;
  readonly firstName: string;
  readonly asked: DetailRequest | null;
  readonly onRequest: (keys: readonly string[]) => Promise<Outcome>;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const label =
    problem !== null
      ? `Not sent: ${problem}`
      : sent
        ? `Asked ${firstName} for ${field}`
        : asked !== null
          ? `${asked.by} asked ${firstName} for this on ${longDate(asked.requestedAt.slice(0, 10))}. Ask again`
          : `Ask ${firstName} to add ${field}`;
  const done = sent || asked !== null;
  return (
    <>
      <Tooltip content={label}>
        <Button
          size="xs"
          variant={done ? 'ghost' : 'secondary'}
          aria-label={label}
          loading={busy}
          loadingLabel={`Asking ${firstName}`}
          startIcon={done ? <icons.confirm aria-hidden /> : <icons.send aria-hidden />}
          onClick={() => {
            setBusy(true);
            setProblem(null);
            void onRequest([keyName]).then((outcome) => {
              setBusy(false);
              if (outcome.ok) setSent(true);
              else setProblem(outcome.message);
            });
          }}
        >
          {done ? 'Asked' : 'Ask'}
        </Button>
      </Tooltip>
      {problem === null ? null : (
        <span role="alert" className="text-xs text-danger-fg">
          {problem}
        </span>
      )}
    </>
  );
}

/** Each move's glyph in the Actions menu. */
const MOVE_ICON: Record<MoveKind, JSX.Element> = {
  giveNotice: <icons.signOut aria-hidden />,
  withdrawNotice: <icons.undo aria-hidden />,
  terminate: <icons.offboard aria-hidden />,
  endAccess: <icons.locked aria-hidden />,
  startLeave: <icons.vacation aria-hidden />,
  endLeave: <icons.vacation aria-hidden />,
  discard: <icons.delete aria-hidden />,
  rehire: <icons.hire aria-hidden />,
  hire: <icons.hire aria-hidden />,
};

/**
 * Everything one may do to this record, in one menu beside the page's primary
 * action (D2), in two groups: the moves that fit the status (only those, so
 * nothing is disabled to puzzle over), then the record's own. On one's own
 * record only History and the PDF are there.
 */
function RecordActions({
  moves,
  onMove,
  firstMissing,
  onFirstMissing,
  askFor,
  historyHref,
  onDownload,
  onPlacement,
  viewAsLabel,
  onViewAs,
}: {
  /** "View as Alan", where it is offered; null elsewhere. */
  readonly viewAsLabel: string | null;
  readonly onViewAs: () => void;
  readonly moves: readonly MoveKind[];
  readonly onMove: (kind: MoveKind) => void;
  /** Change their legal entity or work location, dated. */
  readonly onPlacement?: () => void;
  readonly firstMissing: { readonly key: string; readonly readOnly: boolean } | null;
  readonly onFirstMissing: (key: string) => void;
  readonly askFor: { readonly label: string; readonly run: () => void } | null;
  readonly historyHref: string | undefined;
  readonly onDownload: (() => void) | undefined;
}): JSX.Element | null {
  // An item that puts the cursor somewhere keeps it there: the menu would
  // otherwise hand focus back to its trigger as it closes.
  const moved = useRef(false);
  // The app's keys for it (`view-as` in its one table), as this person has them.
  const viewAsKeys = keysOf('view-as', useShortcutKeys());
  const record = [
    firstMissing === null ? null : (
      <DropdownMenuItem
        key="missing"
        onSelect={() => {
          moved.current = true;
          // After the menu has closed and let go of focus.
          setTimeout(() => {
            onFirstMissing(firstMissing.key);
          }, 0);
        }}
      >
        <icons.missing aria-hidden />
        {firstMissing.readOnly ? 'Show missing details' : 'Fill in missing details'}
      </DropdownMenuItem>
    ),
    askFor === null ? null : (
      <DropdownMenuItem key="ask" onSelect={askFor.run}>
        <icons.send aria-hidden />
        {askFor.label}
      </DropdownMenuItem>
    ),
    historyHref === undefined ? null : (
      <DropdownMenuItem key="history" asChild>
        <a href={historyHref}>
          <icons.history aria-hidden />
          History
        </a>
      </DropdownMenuItem>
    ),
    onDownload === undefined ? null : (
      <DropdownMenuItem key="pdf" onSelect={onDownload}>
        <icons.download aria-hidden />
        Download PDF
      </DropdownMenuItem>
    ),
    viewAsLabel === null ? null : (
      <DropdownMenuItem key="view-as" onSelect={onViewAs}>
        <icons.visible aria-hidden />
        {viewAsLabel}
        {viewAsKeys.length === 0 ? null : (
          <DropdownMenuShortcut>
            <KbdShortcut keys={viewAsKeys} />
          </DropdownMenuShortcut>
        )}
      </DropdownMenuItem>
    ),
  ].filter((x) => x !== null);
  const employment = [
    ...moves.map((kind) => (
      <DropdownMenuItem
        key={kind}
        destructive={isDestructiveMove(kind)}
        onSelect={() => {
          onMove(kind);
        }}
      >
        {MOVE_ICON[kind]}
        {moveLabel(kind)}
      </DropdownMenuItem>
    )),
    onPlacement === undefined ? null : (
      <DropdownMenuItem key="placement" onSelect={onPlacement}>
        <icons.location aria-hidden />
        Change placement
      </DropdownMenuItem>
    ),
  ].filter((x) => x !== null);
  if (employment.length === 0 && record.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label="Actions" startIcon={<icons.more aria-hidden />} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          if (moved.current) event.preventDefault();
          moved.current = false;
        }}
      >
        {employment.length === 0 ? null : (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Employment</DropdownMenuLabel>
            {employment}
          </DropdownMenuGroup>
        )}
        {employment.length === 0 || record.length === 0 ? null : <DropdownMenuSeparator />}
        {record.length === 0 ? null : (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Record</DropdownMenuLabel>
            {record}
          </DropdownMenuGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The photo, as the thing to press: a new one is uploaded as soon as it is
 * picked, and the picture shown is what People keeps once People has it.
 */
function PhotoPicker({
  name,
  src,
  onPhoto,
}: {
  readonly name: string;
  readonly src: string | null;
  readonly onPhoto: (file: File) => Promise<PhotoOutcome>;
}): JSX.Element {
  const [picked, setPicked] = useState<readonly UploadedImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [stored, setStored] = useState(src);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div className="flex shrink-0 flex-col items-start gap-2">
      <AvatarUploader
        label={busy ? 'Photo, uploading' : 'Photo'}
        controls="menu"
        size="lg"
        value={picked}
        src={stored}
        fallback={<Avatar size="xl" name={name} className="ring-0" />}
        accept={['image/png', 'image/jpeg', 'image/webp']}
        maxSize={20 * 1024 * 1024}
        disabled={busy}
        invalid={problem !== null}
        onReject={(rejections) => {
          setProblem(rejections[0]?.message ?? 'That image was not accepted.');
        }}
        onChange={(next) => {
          const file = next[0]?.file;
          setPicked(next);
          setProblem(null);
          if (file === undefined) return;
          setBusy(true);
          void onPhoto(file).then((outcome) => {
            setBusy(false);
            if (outcome.ok) setStored(outcome.avatarUrl);
            else {
              setProblem(outcome.message);
              setPicked([]);
            }
          });
        }}
      />
      {problem === null ? null : (
        <p role="alert" className="max-w-40 text-xs text-danger-fg">
          {problem}
        </p>
      )}
    </div>
  );
}

/**
 * Move somebody (PEO-123): a location, which names its legal entity, from a
 * date. A different entity is a transfer — People closes one employment
 * period and opens the next — so the screen says so before HR presses it.
 */
function PlacementDialog({
  placement,
  onPlace,
  onClose,
}: {
  readonly placement: PlacementState;
  readonly onPlace: (placement: PlacementChange) => Promise<Outcome>;
  readonly onClose: () => void;
}): JSX.Element {
  const [entity, setEntity] = useState(placement.legalEntityId ?? '');
  const [location, setLocation] = useState(placement.locationId ?? '');
  const [from, setFrom] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const transfer =
    entity !== '' && placement.legalEntityId !== null && entity !== placement.legalEntityId;
  const unchanged =
    entity === (placement.legalEntityId ?? '') && location === (placement.locationId ?? '');
  const was = placement.entities.find((e) => e.value === placement.legalEntityId)?.label;

  return (
    <RecordDialog
      title="Change placement"
      description="Their legal entity and work location, from a date."
      onClose={onClose}
      refusal={refused === null ? null : { title: 'Not moved', message: refused }}
      action={
        <Button
          type="submit"
          variant="primary"
          disabled={unchanged}
          loading={saving}
          loadingLabel="Moving"
        >
          Move
        </Button>
      }
      onSubmit={() => {
        setSaving(true);
        setRefused(null);
        void onPlace({
          legalEntityId: entity === '' ? null : entity,
          locationId: location === '' ? null : location,
          ...(from === null ? {} : { effectiveFrom: from }),
        }).then((outcome) => {
          setSaving(false);
          if (outcome.ok) onClose();
          else setRefused(outcome.message);
        });
      }}
    >
      <PlacementPickers
        placement={placement}
        entity={entity}
        location={location}
        onEntity={setEntity}
        onLocation={setLocation}
        locationHint="Their working day follows this location’s time zone."
      />
      <Field>
        <FieldLabel>Effective from</FieldLabel>
        <FieldControl>
          <DatePicker label="Effective from" value={from} onChange={setFrom} />
        </FieldControl>
      </Field>
      {transfer ? (
        <Alert tone="info" title="This is a transfer">
          {was === undefined
            ? 'The legal entity changes on this date.'
            : `The legal entity changes from ${was}.`}{' '}
          Service stays continuous.
        </Alert>
      ) : null}
    </RecordDialog>
  );
}

/**
 * The one shape every record dialog shares (D5, D6): a title, a one-line
 * explanation, only the inputs the task needs, the refusal in its own words,
 * and a primary button named after what it does. Centred, a phone's too.
 */
function RecordDialog({
  title,
  description,
  children,
  refusal,
  action,
  onSubmit,
  onClose,
  open = true,
  onOpenChange,
}: {
  readonly title: string;
  readonly description: ReactNode;
  readonly children: ReactNode;
  readonly refusal: { readonly title: string; readonly message: string } | null;
  readonly action: ReactNode;
  readonly onSubmit: () => void;
  readonly onClose: () => void;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}): JSX.Element {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange?.(next);
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-120">
        <form
          noValidate
          aria-label={title}
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Stack gap={4}>
              {children}
              {refusal === null ? null : (
                <Alert tone="danger" title={refusal.title}>
                  {refusal.message}
                </Alert>
              )}
            </Stack>
          </DialogBody>
          <DialogFooter>
            <Button type="button" onClick={onClose}>
              Cancel
            </Button>
            {action}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Viewing the app as this person (D6): what it means, said before it starts,
 * and the reason, which is required and kept in the activity log.
 */
function ViewAsDialog({
  name,
  open,
  onOpenChange: setOpen,
  onViewAs,
}: {
  readonly name: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onViewAs: (reason: string) => Promise<Outcome>;
}): JSX.Element | null {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const first = name.split(' ')[0] ?? name;
  if (!open) return null;
  return (
    <RecordDialog
      title={`View Kithena as ${first}`}
      description={`Shows Kithena exactly as ${first} sees it, private details included, for up to 30 minutes. Nothing can be changed meanwhile, and ${first} is told afterwards.`}
      onClose={() => {
        setOpen(false);
        setReason('');
        setRefused(null);
      }}
      refusal={refused === null ? null : { title: 'Not started', message: refused }}
      action={
        <Button
          type="submit"
          variant="primary"
          startIcon={<icons.visible aria-hidden />}
          loading={busy}
          loadingLabel="Starting"
        >
          View as {first}
        </Button>
      }
      onSubmit={() => {
        if (reason.trim() === '') {
          setRefused('Say why you are viewing as them.');
          return;
        }
        setBusy(true);
        setRefused(null);
        void onViewAs(reason.trim()).then((outcome) => {
          // On success the page becomes theirs; stay busy until it has.
          if (!outcome.ok) {
            setBusy(false);
            setRefused(outcome.message);
          }
        });
      }}
    >
      <Field required>
        <FieldLabel>Reason</FieldLabel>
        <FieldControl>
          <Input
            value={reason}
            maxLength={500}
            placeholder="Kept in the activity log"
            onChange={(e) => {
              setReason(e.target.value);
            }}
          />
        </FieldControl>
      </Field>
    </RecordDialog>
  );
}

/**
 * The employee record as a PDF (D6, PRD §15.5): what this viewer may read,
 * the rest counted in its footer. An export with pay or bank details in it
 * needs a reason, recorded with it (§15.1), so the reason is asked for up
 * front rather than after a refusal.
 */
function RecordPdf({
  name,
  open,
  onOpenChange: setOpen,
  onDownload,
}: {
  /** Whose record: "Adam". */
  readonly name: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onDownload: (reason: string) => Promise<Outcome>;
}): JSX.Element | null {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  if (!open) return null;
  return (
    <RecordDialog
      title={`Download ${name}’s record`}
      description="A PDF of what you can see. A reason is needed when it includes pay and bank details; it is kept with the export."
      onClose={() => {
        setOpen(false);
        setReason('');
        setRefused(null);
      }}
      refusal={refused === null ? null : { title: 'No PDF was made', message: refused }}
      action={
        <Button
          type="submit"
          variant="primary"
          startIcon={<icons.download aria-hidden />}
          loading={busy}
          loadingLabel="Preparing PDF"
        >
          Download
        </Button>
      }
      onSubmit={() => {
        setBusy(true);
        setRefused(null);
        void onDownload(reason.trim()).then((outcome) => {
          setBusy(false);
          if (outcome.ok) setOpen(false);
          else setRefused(outcome.message);
        });
      }}
    >
      <Field>
        <FieldLabel>Reason</FieldLabel>
        <FieldControl>
          <Input
            value={reason}
            maxLength={500}
            onChange={(e) => {
              setReason(e.target.value);
            }}
          />
        </FieldControl>
      </Field>
    </RecordDialog>
  );
}
