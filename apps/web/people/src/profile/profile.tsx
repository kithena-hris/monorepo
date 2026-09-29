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
  DropdownMenuTrigger,
  EmptyState,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  PageHeader,
  PageSection,
  RadioGroup,
  RadioGroupItem,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Stack,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TertiaryNav,
  Textarea,
  Tooltip,
  icons,
  useCoarsePointer,
  usePageHeaderFrame,
  type IsoDate,
  type UploadedImage,
} from '@reach/ui';
import { useEffect, useRef, useState, type JSX } from 'react';

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
  /** Open the record as of a date, and its changes (PEO-064). */
  readonly onHistory?: () => void;
  /** Take back a change of one's own that waits for approval (PEO-077). */
  readonly onWithdraw?: (changeId: string) => Promise<Outcome>;
  /** A requester no other HR member can approve for, approving their own held change, once they confirm (PEO-077). */
  readonly onSelfApprove?: (changeId: string) => Promise<Outcome>;
  /** Open the approvals inbox, where HR decides (PEO-077). */
  readonly onApprovals?: () => void;
  /** This record as a PDF, as the viewer may read it (PEO-061). Absent where not offered. */
  readonly onDownloadRecord?: (reason: string) => Promise<Outcome>;
  /** A new photo, picked here: uploaded by the shell, which answers with where it now is. */
  readonly onPhoto?: (file: File) => Promise<PhotoOutcome>;
  /** Open with this field's section in edit mode and the cursor in it: a link to one missing detail. */
  readonly focusField?: string;
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
 * One person's record, for whoever is looking (PRD §6.6, design screen 6).
 *
 * One screen for HR, a manager and the person themselves, differing only by
 * the authorization decision that shaped `load`. A field the viewer cannot
 * read is absent: no label, no padlock, no greyed row, no empty section — each
 * of those would say the field exists, and for a self-ID answer that is the
 * disclosure itself. This component renders what it is given and cannot
 * re-add a key the application layer removed.
 */
export function Profile({
  load,
  onSave,
  onCheck,
  onMove,
  onPlace,
  searchPeople,
  onHistory,
  onWithdraw,
  onSelfApprove,
  onApprovals,
  onDownloadRecord,
  onPhoto,
  focusField,
  onRequest,
  onUploadFile,
  onChangeDated,
}: ProfileProps): JSX.Element {
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
            <Record
              state={state}
              onPhoto={onPhoto}
              focusField={focusField}
              onSave={onSave}
              onCheck={onCheck}
              onMove={onMove}
              onPlace={onPlace}
              onHistory={onHistory}
              onWithdraw={onWithdraw}
              onSelfApprove={onSelfApprove}
              onApprovals={onApprovals}
              onDownloadRecord={onDownloadRecord}
              onRequest={onRequest}
              onChangeDated={onChangeDated}
            />
          </FieldFiles.Provider>
        )}
      </Loaded>
    </PeopleSearch.Provider>
  );
}

function Record({
  state,
  onSave,
  onCheck,
  onMove,
  onPlace,
  onHistory,
  onWithdraw,
  onSelfApprove,
  onApprovals,
  onDownloadRecord,
  onPhoto,
  focusField,
  onRequest,
  onChangeDated,
}: {
  readonly state: ProfileState;
  readonly onChangeDated: ProfileProps['onChangeDated'];
  readonly onPhoto: ProfileProps['onPhoto'];
  readonly focusField: ProfileProps['focusField'];
  readonly onSave: ProfileProps['onSave'];
  readonly onCheck: ProfileProps['onCheck'];
  readonly onMove: ProfileProps['onMove'];
  readonly onPlace: ProfileProps['onPlace'];
  readonly onHistory: ProfileProps['onHistory'];
  readonly onWithdraw: ProfileProps['onWithdraw'];
  readonly onSelfApprove: ProfileProps['onSelfApprove'];
  readonly onApprovals: ProfileProps['onApprovals'];
  readonly onDownloadRecord: ProfileProps['onDownloadRecord'];
  readonly onRequest: ProfileProps['onRequest'];
}): JSX.Element {
  // A link to one missing detail opens its section, with the cursor in it.
  const sectionOf = (key: string | undefined): string | null =>
    key === undefined
      ? null
      : (state.sections.find((s) => s.fields.some((f) => f.key === key && !f.readOnly))?.key ??
        null);
  const [editing, setEditing] = useState<string | null>(() => sectionOf(focusField));
  const [focus, setFocus] = useState<string | undefined>(focusField);
  const open = (key: string): void => {
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
  const [placing, setPlacing] = useState(false);
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
  const [moving, setMoving] = useState<MoveKind | null>(null);
  const [tab, setTab] = useState('overview');
  const [dating, setDating] = useState<RecordField | null>(null);
  const frame = usePageHeaderFrame();
  const coarse = useCoarsePointer();
  const firstWritable = sections.find((s) => s.fields.some((f) => !f.readOnly));
  // Their own record (W12): nobody moves their own employment or asks themselves.
  const own = onMove === undefined && onRequest === undefined && person.missing !== null;
  const required = sections.flatMap((s) => s.fields).filter((f) => f.required).length;
  const percent =
    required === 0
      ? 100
      : Math.round(((required - Math.min(gaps.length, required)) / required) * 100);
  const [pdf, setPdf] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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
                  <span className="flex flex-wrap items-center gap-2">
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
                          if (first !== undefined) open(first.key);
                        }}
                      />
                    )}
                    {/* HR's: what day it is for them, on their own clock (PEO-119). */}
                    {state.calendar ? (
                      <span className="text-sm text-fg-muted">
                        Their day{' '}
                        <span className="text-fg" data-testid="their-day">
                          {state.calendar.today} ({state.calendar.timeZone})
                        </span>
                      </span>
                    ) : null}
                  </span>
                )
              }
              actions={
                <span className="flex items-center gap-2">
                  <RecordActions
                    moves={onMove === undefined || !state.calendar ? [] : offeredMoves(status)}
                    onMove={setMoving}
                    {...(state.placement && onPlace
                      ? {
                          onPlacement: () => {
                            setPlacing(true);
                          },
                        }
                      : {})}
                    firstMissing={gaps[0] ?? null}
                    onFirstMissing={(key) => {
                      open(key);
                    }}
                    askFor={
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
                          }
                    }
                    onHistory={onHistory}
                    onDownload={
                      onDownloadRecord === undefined
                        ? undefined
                        : () => {
                            setPdf(true);
                          }
                    }
                  />
                  {firstWritable === undefined ? null : (
                    <Button
                      variant="primary"
                      startIcon={<icons.edit aria-hidden />}
                      onClick={() => {
                        setTab('overview');
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
            <a href="/people/org-chart">Org chart</a>
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
          onClose={() => {
            setMoving(null);
          }}
        />
      )}
      {onDownloadRecord === undefined ? null : (
        <RecordPdf open={pdf} onOpenChange={setPdf} onDownload={onDownloadRecord} />
      )}
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
                Review
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
          title={`${[...requests.values()][0]?.by ?? 'HR'} asked you to add ${
            requests.size === 1 ? 'a detail' : `${String(requests.size)} details`
          }`}
          action={
            <Button
              size="sm"
              onClick={() => {
                const first = [...requests.keys()][0];
                if (first !== undefined) open(first);
              }}
            >
              Add them
            </Button>
          }
        >
          {[...requests.values()].map((r) => r.label).join(', ')}.
        </Alert>
      )}
      {dating === null || onChangeDated === undefined ? null : (
        <DatedChange
          field={dating}
          name={firstName}
          current={values[dating.key]}
          today={state.calendar?.today ?? null}
          onChange={onChangeDated}
          onClose={() => {
            setDating(null);
          }}
        />
      )}
      {/* Where they work (PEO-123): changed from Actions, dated, in a dialog. */}
      {state.placement && onPlace && placing ? (
        <PlacementDialog
          placement={state.placement}
          onPlace={onPlace}
          onClose={() => {
            setPlacing(false);
          }}
        />
      ) : null}
      {/*
        The record in tabs (W8–W10): the overview holds every section, and each
        section has a tab of its own, so a long record is one click from any
        part of it. History is its own page, and the last tab goes there.
      */}
      <Tabs
        value={tab}
        onValueChange={(next) => {
          if (next === 'history') onHistory?.();
          else setTab(next);
        }}
      >
        {sections.length < 2 || own ? null : (
          <TabsList
            variant={coarse ? 'pill' : 'line'}
            aria-label="Parts of the record"
            className="max-w-full overflow-x-auto"
          >
            <TabsTrigger value="overview">Overview</TabsTrigger>
            {sections.map((section) => (
              <TabsTrigger key={section.key} value={section.key}>
                {section.label}
              </TabsTrigger>
            ))}
            {onHistory === undefined ? null : <TabsTrigger value="history">History</TabsTrigger>}
          </TabsList>
        )}
        {/* The record, and beside it on a desk who they report to. */}
        <TabsContent
          value={tab}
          className={
            own
              ? 'grid grid-cols-[minmax(0,1fr)] gap-6 @5xl/page:grid-cols-[16.25rem_minmax(0,1fr)] @5xl/page:items-start'
              : 'grid grid-cols-[minmax(0,1fr)] gap-6 @5xl/page:grid-cols-[minmax(0,1fr)_20rem] @5xl/page:items-start'
          }
        >
          {own ? (
            // How complete their record is, and each part of it, done or not (W12).
            <Card
              padded
              className="flex flex-col items-center gap-3 @5xl/page:sticky @5xl/page:top-6"
            >
              <CircularProgress
                value={percent}
                size={84}
                label="Your record"
                tone={percent === 100 ? 'success' : 'accent'}
              />
              <p className="font-bold">
                {percent === 100 ? 'Your record is complete' : `${String(percent)}% complete`}
              </p>
              {gaps.length === 0 ? null : (
                <p className="text-sm text-fg-muted">
                  {gaps.length} {gaps.length === 1 ? 'detail' : 'details'} left
                </p>
              )}
              <TertiaryNav
                label="Parts of your record"
                variant="fill"
                touchLayout="pills"
                className="w-full"
                items={sections.map((section) => ({
                  id: `section-${section.key}`,
                  label: section.label,
                  status:
                    gapsIn(section).length === 0 ? ('success' as const) : ('warning' as const),
                }))}
              />
            </Card>
          ) : null}
          <Stack gap={6} className="min-w-0">
            {sections.length === 0 ? (
              <EmptyState title="Nothing else to show" />
            ) : (
              sections
                .filter((section) => tab === 'overview' || tab === section.key)
                .map((section) => {
                  const writable = section.fields.some((f) => !f.readOnly);
                  return (
                    <PageSection
                      key={section.key}
                      id={`section-${section.key}`}
                      surface
                      className="@container scroll-mt-4"
                      title={section.label}
                      actions={
                        <span className="flex items-center gap-2">
                          {gapsIn(section).length === 0 ? null : (
                            <MissingMark count={gapsIn(section).length} />
                          )}
                          {section.readsLogged ? <Badge size="sm">Reads are logged</Badge> : null}
                          {writable && editing !== section.key ? (
                            <Button
                              size="sm"
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
                      {(held[section.key] ?? []).length === 0 || editing === section.key ? null : (
                        <Alert tone="info" title="Sent to HR for approval">
                          {(held[section.key] ?? []).join(' and ')}{' '}
                          {(held[section.key] ?? []).length === 1 ? 'is' : 'are'} not changed until
                          HR approves; the record keeps what it had until then.
                        </Alert>
                      )}
                      {editing === section.key ? (
                        <SectionForm
                          section={section}
                          values={values}
                          pending={pending}
                          {...(onWithdraw === undefined ? {} : { onWithdraw })}
                          {...(onSelfApprove === undefined ? {} : { onSelfApprove })}
                          {...(onCheck === undefined ? {} : { onCheck })}
                          {...(focus === undefined ? {} : { focusKey: focus })}
                          footer={
                            <Button
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
                                    !waiting.has(
                                      section.fields.find((f) => f.key === k)?.label ?? k,
                                    ),
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
                          {section.fields.map((field) => {
                            const gap = field.missing === true && isMissing(values[field.key]);
                            return (
                              <div
                                key={field.key}
                                className="relative grid min-h-12 items-center gap-x-4 gap-y-1 border-b border-border py-1.5 last:border-b-0 @md:grid-cols-[11.25rem_minmax(0,1fr)] touch:py-2.5"
                              >
                                <dt
                                  id={`field-${field.key}`}
                                  className="flex flex-wrap items-center gap-1.5 text-sm text-fg-muted"
                                >
                                  {field.label}
                                  <SensitiveMark field={field} />
                                  {gap ? <MissingMark /> : null}
                                </dt>
                                <dd className="flex min-w-0 flex-col gap-1 text-sm font-medium touch:text-base">
                                  {onChangeDated === undefined ||
                                  !state.calendar ||
                                  field.readOnly ||
                                  isFileField(field) ? null : (
                                    <Button
                                      variant="ghost"
                                      size="xs"
                                      className="relative tap-target self-end -my-1 @md:absolute @md:end-4"
                                      aria-label={`Change ${field.label} from a date`}
                                      startIcon={<icons.history aria-hidden />}
                                      onClick={() => {
                                        setDating(field);
                                      }}
                                    />
                                  )}
                                  {gap ? (
                                    <span className="flex flex-wrap items-center gap-2 text-fg-muted">
                                      {field.readOnly
                                        ? `Not provided yet. ${field.ownedBy ?? 'HR'} fills this in.`
                                        : 'Not provided yet.'}
                                      {field.readOnly ? null : (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          aria-label={`Add ${field.label}`}
                                          onClick={() => {
                                            open(field.key);
                                          }}
                                        >
                                          Add
                                        </Button>
                                      )}
                                      {onRequest !== undefined && field.askable === true ? (
                                        <AskButton
                                          field={field.label}
                                          keyName={field.key}
                                          firstName={firstName}
                                          asked={requests.get(field.key) ?? null}
                                          onRequest={onRequest}
                                        />
                                      ) : null}
                                    </span>
                                  ) : onRequest !== undefined &&
                                    field.askable === true &&
                                    isMissing(values[field.key]) ? (
                                    <span className="flex flex-wrap items-center gap-1">
                                      <DisplayValue field={field} value={values[field.key]} />
                                      <AskButton
                                        field={field.label}
                                        keyName={field.key}
                                        firstName={firstName}
                                        asked={requests.get(field.key) ?? null}
                                        onRequest={onRequest}
                                      />
                                    </span>
                                  ) : (
                                    <DisplayValue field={field} value={values[field.key]} />
                                  )}
                                  {pending
                                    .filter((p) => p.key === field.key)
                                    .map((p) => (
                                      <PendingNote
                                        key={p.id}
                                        field={field}
                                        pending={p}
                                        onWithdraw={onWithdraw}
                                        onSelfApprove={onSelfApprove}
                                      />
                                    ))}
                                </dd>
                              </div>
                            );
                          })}
                        </dl>
                      )}
                    </PageSection>
                  );
                })
            )}
            {tab === 'overview' ? (
              <EmploymentPeriods periods={state.employment?.periods ?? []} />
            ) : null}
          </Stack>
          {state.reportingLine === undefined ? null : (
            <aside className="@5xl/page:sticky @5xl/page:top-6">
              <ReportingLine
                line={state.reportingLine}
                person={{ name: person.name, title: person.summary, avatarUrl: person.avatarUrl }}
              />
            </aside>
          )}
        </TabsContent>
      </Tabs>
    </Stack>
  );
}

/**
 * One value, changed from a date (W11): the new value, when it takes effect,
 * and what happens because of it. Today, or a day People applies it on; a
 * sensitive field goes to Approvals and applies only once somebody else
 * agrees. Every change keeps the value it replaces in the history.
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
  readonly today: string | null;
  readonly onChange: NonNullable<ProfileProps['onChangeDated']>;
  readonly onClose: () => void;
}): JSX.Element {
  const [value, setValue] = useState<AttributeValue>(current ?? null);
  const [when, setWhen] = useState<'today' | 'date'>('today');
  const [from, setFrom] = useState<IsoDate | null>(null);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const day = today ?? new Date().toISOString().slice(0, 10);
  const effectiveFrom = when === 'today' ? day : from;
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent size="lg">
        <SheetHeader>
          <SheetTitle>Change {field.label.toLowerCase()}</SheetTitle>
          <SheetDescription>{name} · the old value stays in the history</SheetDescription>
        </SheetHeader>
        <SheetBody>
          <form
            aria-label={`Change ${field.label}`}
            id={`dated-${field.key}`}
            className="flex flex-col gap-5"
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
            <AttributeInput
              field={{ ...field, readOnly: false }}
              value={value}
              onChange={setValue}
            />
            <Field>
              <FieldLabel>When does it take effect?</FieldLabel>
              <RadioGroup
                value={when}
                onValueChange={(next) => {
                  setWhen(next === 'date' ? 'date' : 'today');
                }}
              >
                <RadioGroupItem value="today" description="From the start of their day.">
                  Today
                </RadioGroupItem>
                <RadioGroupItem value="date" description="It shows as scheduled until then.">
                  On a date
                </RadioGroupItem>
              </RadioGroup>
            </Field>
            {when === 'date' ? (
              <DatePicker label="Takes effect on" value={from} onChange={setFrom} />
            ) : null}
            {field.sensitive === true ? (
              <Alert tone="warning" title="This needs a second approver">
                {field.label} is sensitive, so somebody else in HR approves it before it applies.
              </Alert>
            ) : null}
            {refused === null ? null : (
              <Alert tone="danger" title="Not changed">
                {refused}
              </Alert>
            )}
          </form>
        </SheetBody>
        <SheetFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            form={`dated-${field.key}`}
            variant="primary"
            loading={busy}
            loadingLabel="Saving"
            disabled={effectiveFrom === null}
          >
            {field.sensitive === true ? 'Send for approval' : 'Save change'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Ask the person for one empty detail: an icon beside it, its meaning in the
 * tooltip and the accessible name alike. Once asked, it says when and by
 * whom; pressing it again within the day records it and sends no second email.
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
  return (
    <>
      <Tooltip content={label}>
        <Button
          size="sm"
          variant="ghost"
          aria-label={label}
          loading={busy}
          loadingLabel={`Asking ${firstName}`}
          startIcon={
            sent || asked !== null ? <icons.success aria-hidden /> : <icons.send aria-hidden />
          }
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
          {null}
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

/**
 * Everything one may do to this record, in one menu beside the page's primary
 * action: the moves the status allows, then the record's own. A header with a
 * button per verb reads as a toolbar; this reads as a page.
 */
function RecordActions({
  moves,
  onMove,
  firstMissing,
  onFirstMissing,
  askFor,
  onHistory,
  onDownload,
  onPlacement,
}: {
  readonly moves: readonly MoveKind[];
  readonly onMove: (kind: MoveKind) => void;
  /** Change their legal entity or work location, dated. */
  readonly onPlacement?: () => void;
  readonly firstMissing: { readonly key: string; readonly readOnly: boolean } | null;
  readonly onFirstMissing: (key: string) => void;
  readonly askFor: { readonly label: string; readonly run: () => void } | null;
  readonly onHistory: (() => void) | undefined;
  readonly onDownload: (() => void) | undefined;
}): JSX.Element | null {
  // An item that puts the cursor somewhere keeps it there: the menu would
  // otherwise hand focus back to its trigger as it closes.
  const moved = useRef(false);
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
    onHistory === undefined ? null : (
      <DropdownMenuItem key="history" onSelect={onHistory}>
        <icons.history aria-hidden />
        History
      </DropdownMenuItem>
    ),
    onDownload === undefined ? null : (
      <DropdownMenuItem key="pdf" onSelect={onDownload}>
        <icons.download aria-hidden />
        Download PDF
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
        {moveLabel(kind)}
      </DropdownMenuItem>
    )),
    onPlacement === undefined ? null : (
      <DropdownMenuItem key="placement" onSelect={onPlacement}>
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

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <form
          noValidate
          aria-label="Placement"
          onSubmit={(e) => {
            e.preventDefault();
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
          <DialogHeader>
            <DialogTitle>Change placement</DialogTitle>
            <DialogDescription>
              Their legal entity and work location, from a date.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Stack gap={4}>
              <PlacementPickers
                placement={placement}
                entity={entity}
                location={location}
                onEntity={setEntity}
                onLocation={setLocation}
                locationHint="Their working day follows this location’s time zone."
              />
              <DatePicker label="Effective from" value={from} onChange={setFrom} />
              {transfer ? (
                <Alert tone="info" title="This is a transfer">
                  Employment moves to the new legal entity on this date. Service stays continuous.
                </Alert>
              ) : null}
              {refused === null ? null : (
                <Alert tone="danger" title="Not moved">
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
              disabled={unchanged}
              loading={saving}
              loadingLabel="Moving"
            >
              Move
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The employee record as a PDF (PRD §15.5): what this viewer may read, the
 * rest counted in its footer. An export with pay or bank details in it needs
 * a reason, recorded with it (§15.1), so the reason is asked for up front
 * rather than after a refusal.
 */
function RecordPdf({
  open,
  onOpenChange: setOpen,
  onDownload,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onDownload: (reason: string) => Promise<Outcome>;
}): JSX.Element {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setReason('');
          setRefused(null);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Download the employee record</DialogTitle>
          <DialogDescription>
            A PDF of what you can see here. Anything withheld from you is counted in its footer.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Stack gap={4}>
            <Field>
              <FieldLabel>Reason</FieldLabel>
              <FieldControl>
                <Textarea
                  value={reason}
                  maxLength={500}
                  onChange={(e) => {
                    setReason(e.target.value);
                  }}
                />
              </FieldControl>
              <FieldDescription>
                Needed when the record includes pay or bank details. Kept with the export.
              </FieldDescription>
            </Field>
            {refused === null ? null : (
              <Alert tone="danger" title="No PDF was made">
                {refused}
              </Alert>
            )}
          </Stack>
        </DialogBody>
        <DialogFooter>
          <Button
            onClick={() => {
              setOpen(false);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            loadingLabel="Preparing PDF"
            onClick={() => {
              setBusy(true);
              setRefused(null);
              void onDownload(reason.trim()).then((outcome) => {
                setBusy(false);
                if (outcome.ok) setOpen(false);
                else setRefused(outcome.message);
              });
            }}
          >
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
