import {
  Alert,
  Avatar,
  AvatarUploader,
  Badge,
  Button,
  DatePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  PageHeader,
  PageSection,
  Stack,
  Textarea,
  type UploadedImage,
} from '@reach/ui';
import { useEffect, useState, type JSX } from 'react';

import { Loaded, type Checked, type Loadable, type Outcome } from '../load';
import { PeopleSearch, type SearchPeople } from '../record/attribute-input';
import { DisplayValue } from '../record/display';
import { isMissing, type PendingValue, type RecordSection, type Values } from '../record/model';
import { MissingMark } from '../record/missing';
import { PendingNote, SensitiveMark } from '../record/pending';
import { ReviewNotices, type IdentifierReview } from '../record/review-notices';
import { SectionForm } from '../record/section-form';
import {
  Employment,
  PlacementPickers,
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
}: ProfileProps): JSX.Element {
  return (
    <PeopleSearch.Provider value={searchPeople ?? null}>
      <Loaded load={load} what="this profile">
        {(state) => (
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
          />
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
}: {
  readonly state: ProfileState;
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
  const required = sections.flatMap((s) => s.fields).filter((f) => f.required).length;

  return (
    <Stack gap={6}>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-6">
        {onPhoto !== undefined && person.canChangePhoto === true ? (
          <PhotoPicker name={person.name} src={person.avatarUrl} onPhoto={onPhoto} />
        ) : (
          <Avatar size="3xl" name={person.name} src={person.avatarUrl ?? undefined} />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <PageHeader
            title={person.name}
            description={person.summary ?? undefined}
            meta={
              person.missing === null ? undefined : gaps.length === 0 ? (
                <Badge tone="success">Complete</Badge>
              ) : (
                <MissingMark count={gaps.length} size="md" />
              )
            }
            actions={
              onHistory === undefined && onDownloadRecord === undefined ? undefined : (
                <>
                  {onHistory === undefined ? null : <Button onClick={onHistory}>History</Button>}
                  {onDownloadRecord ? <RecordPdf onDownload={onDownloadRecord} /> : null}
                </>
              )
            }
          />
          {person.missing === null || gaps.length === 0 ? null : (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-fg-muted">
              <p>
                <span className="font-medium text-fg tabular-nums">{gaps.length}</span> of{' '}
                <span className="tabular-nums">{required}</span> required{' '}
                {required === 1 ? 'detail' : 'details'} missing
              </p>
              <Button
                size="sm"
                onClick={() => {
                  const first = gaps[0];
                  if (first !== undefined) open(first.key);
                }}
              >
                {gaps[0]?.readOnly === true ? 'Show the first' : 'Fill in the first'}
              </Button>
            </div>
          )}
        </div>
      </div>
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
      {state.calendar ? (
        <Employment
          state={{ calendar: state.calendar, employment: state.employment ?? null }}
          onMove={onMove}
          name={person.name}
          placement={state.placement}
        />
      ) : null}
      {/* Where they work, beside their employment (PEO-123). */}
      {state.placement && onPlace ? (
        <PlacementSection placement={state.placement} onPlace={onPlace} />
      ) : null}
      {sections.length === 0 ? (
        <EmptyState title="Nothing else to show" />
      ) : (
        sections.map((section) => {
          const writable = section.fields.some((f) => !f.readOnly);
          return (
            <PageSection
              key={section.key}
              surface
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
                  {(held[section.key] ?? []).length === 1 ? 'is' : 'are'} not changed until HR
                  approves; the record keeps what it had until then.
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
                          ([k]) => !waiting.has(section.fields.find((f) => f.key === k)?.label ?? k),
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
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[minmax(10rem,auto)_1fr]">
                  {section.fields.map((field) => {
                    const gap = field.missing === true && isMissing(values[field.key]);
                    return (
                      <div key={field.key} className="contents">
                        <dt
                          id={`field-${field.key}`}
                          className="flex flex-wrap items-center gap-2 text-sm text-fg-muted"
                        >
                          {field.label}
                          <SensitiveMark field={field} />
                          {gap ? <MissingMark /> : null}
                        </dt>
                        <dd className="flex flex-col gap-1 text-sm">
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
    </Stack>
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
    <div className="flex max-w-xs flex-col gap-2">
      <AvatarUploader
        label="Photo"
        hint={busy ? 'Uploading…' : 'PNG, JPEG or WebP; sent as a 512px square.'}
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
        <p role="alert" className="text-xs text-danger-fg">
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
function PlacementSection({
  placement,
  onPlace,
}: {
  readonly placement: PlacementState;
  readonly onPlace: (placement: PlacementChange) => Promise<Outcome>;
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
    <PageSection surface title="Placement">
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
            if (!outcome.ok) setRefused(outcome.message);
          });
        }}
      >
        <Stack gap={4}>
          <PlacementPickers
            placement={placement}
            entity={entity}
            location={location}
            onEntity={setEntity}
            onLocation={setLocation}
            locationHint="Their day is this location’s, from the date below."
          />
          <DatePicker label="Effective from" value={from} onChange={setFrom} />
          {transfer ? (
            <Alert tone="info" title="This is a transfer">
              Their employment in the current legal entity ends the day before, and a new one starts
              on this date. Service is continuous.
            </Alert>
          ) : null}
          {refused === null ? null : (
            <Alert tone="danger" title="Not moved">
              {refused}
            </Alert>
          )}
          <div>
            <Button
              type="submit"
              variant="primary"
              disabled={unchanged}
              loading={saving}
              loadingLabel="Moving"
            >
              Move
            </Button>
          </div>
        </Stack>
      </form>
    </PageSection>
  );
}

/**
 * The employee record as a PDF (PRD §15.5): what this viewer may read, the
 * rest counted in its footer. An export with pay or bank details in it needs
 * a reason, recorded with it (§15.1), so the reason is asked for up front
 * rather than after a refusal.
 */
function RecordPdf({
  onDownload,
}: {
  readonly onDownload: (reason: string) => Promise<Outcome>;
}): JSX.Element {
  const [open, setOpen] = useState(false);
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
      <DialogTrigger asChild>
        <Button size="sm">Download PDF</Button>
      </DialogTrigger>
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
