import {
  Alert,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  RadioCard,
  RadioGroup,
  Stack,
  Text,
  useToast,
} from '@reach/ui-native';
import { useMemo, useRef, useState } from 'react';
import { ScrollView } from 'react-native';

import { Failed, Loading, Page } from '../frame';
import { AttributeInput } from './attribute-input';
import {
  ask,
  formInputs,
  isEmpty,
  sameValue,
  useRead,
  useSigned,
  valuesOf,
  type Entry,
  type Finding,
  type RecordField,
  type Value,
} from './api';
import type { PeopleScreen } from './routes';

interface SectionData {
  readonly person: { readonly name: string };
  readonly sections: readonly {
    readonly key: string;
    readonly label: string;
    readonly fields: readonly RecordField[];
  }[];
  readonly values: readonly Entry[];
}

/** The reporting line's attribute: a new manager is confirmed first, as on the web. */
const MANAGER_KEY = 'manager_id';

/** What a new manager touches in Performance, asked first (`PerformanceManagerChangeImpact`). */
interface ChangeQuestion {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly options: readonly { id: string; label: string; description: string }[];
  readonly value: string;
}

/** Values a save is checked for first (PEO-125): the identifiers People validates. */
const CHECKED = new Set(['national_id', 'bank_account']);

/** One section's form, its checks and its save: the page's and the modal's. */
function useSectionEdit(
  personId: string | undefined,
  sectionKey: string,
  onSaved: () => void,
): {
  readonly load: ReturnType<typeof useRead<SectionData>>['load'];
  readonly reload: () => void;
  readonly section: SectionData['sections'][number] | undefined;
  readonly form: React.ReactNode;
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly anyway: boolean;
  readonly held: boolean;
  readonly save: () => Promise<void>;
} {
  const signed = useSigned();
  const { toast } = useToast();
  const { load, reload } = useRead<SectionData>('Profile', { personId: personId ?? null });
  const [draft, setDraft] = useState<Readonly<Record<string, Value>>>({});
  const [warnings, setWarnings] = useState<readonly Finding[] | null>(null);
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // A new manager waiting on confirmation: what it touches, and the choice made.
  const [confirming, setConfirming] = useState<{
    readonly questions: readonly ChangeQuestion[];
    readonly answers: Readonly<Record<string, string>>;
  } | null>(null);
  const confirmed = useRef<Readonly<Record<string, string>> | null>(null);

  const section =
    load.status === 'ready' ? load.data.sections.find((s) => s.key === sectionKey) : undefined;
  const original = useMemo(
    () => (load.status === 'ready' ? valuesOf(load.data.values) : {}),
    [load],
  );
  const valueOf = (key: string): Value | undefined => (key in draft ? draft[key] : original[key]);
  const changed = Object.fromEntries(
    Object.entries(draft).filter(([key, value]) => !sameValue(value, original[key])),
  );
  const dirty = Object.keys(changed).length > 0;
  // Your own sensitive change waits for HR: the button says who it goes to.
  const held =
    personId === undefined &&
    (section?.fields.some((f) => f.sensitive === true && f.key in changed) ?? false);

  const save = async (): Promise<void> => {
    if (section === undefined) return;
    // A required field emptied here is refused before anything is sent.
    const emptied = Object.fromEntries(
      section.fields
        .filter((f) => f.required && f.key in changed && isEmpty(changed[f.key]))
        .map((f) => [f.key, `${f.label} is required.`]),
    );
    setProblems(emptied);
    if (Object.keys(emptied).length > 0) return;

    // Someone else's new manager is confirmed first, with what it touches in Performance.
    const manager = changed[MANAGER_KEY];
    const nextManager = typeof manager === 'string' && manager !== '' ? manager : null;
    const moving = personId !== undefined && MANAGER_KEY in changed;
    if (moving && confirmed.current === null) {
      setSaving(true);
      const asked = await ask<{ question: ChangeQuestion | null }>(
        signed,
        'PerformanceManagerChangeImpact',
        { personIds: personId, managerId: nextManager },
        'performance',
      );
      setSaving(false);
      const questions = asked.ok && asked.data.question !== null ? [asked.data.question] : [];
      setConfirming({
        questions,
        answers: Object.fromEntries(questions.map((q) => [q.id, q.value])),
      });
      return;
    }

    setSaving(true);
    setFailed(null);
    const inputs = formInputs(changed);
    if (
      warnings === null &&
      section.fields.some((f) => CHECKED.has(f.dataType) && f.key in changed)
    ) {
      const checked = await ask<{ findings: Finding[] }>(signed, 'IdentifierCheck', {
        personId: personId ?? null,
        changed: inputs,
      });
      if (checked.ok && checked.data.findings.length > 0) {
        setWarnings(checked.data.findings);
        setSaving(false);
        return;
      }
    }
    const answer = await ask<{ ok: boolean; held: readonly string[] | null }>(
      signed,
      personId === undefined ? 'SaveOwnSection' : 'SavePersonSection',
      personId === undefined ? { changed: inputs } : { personId, changed: inputs },
    );
    setSaving(false);
    if (!answer.ok) {
      setFailed(answer.message);
      return;
    }
    const waiting = answer.data.held ?? [];
    // HR's answer sent on, even while it waits for approval: carried out when it takes effect.
    const answers = confirmed.current;
    confirmed.current = null;
    const choice = answers?.['performance.manager-reviews'];
    if (moving && choice !== undefined) {
      const handed = await ask(
        signed,
        'ChoosePerformanceManagerHandover',
        {
          input: { personIds: [personId], managerId: nextManager, handOver: choice === 'reassign' },
        },
        'performance',
      );
      if (!handed.ok)
        toast({
          title: 'Their manager reviews were not handed over',
          description: handed.message,
          tone: 'danger',
        });
    }
    toast(
      waiting.length === 0
        ? { title: 'Saved', tone: 'success' }
        : {
            title: 'Sent to HR for approval',
            description: `${waiting.join(', ')} change when HR approves.`,
            tone: 'info',
          },
    );
    onSaved();
  };

  const form =
    load.status === 'loading' ? (
      <Loading label="Loading the section" />
    ) : load.status === 'error' ? (
      <Failed message={load.message} onRetry={reload} />
    ) : section === undefined ? (
      <Text tone="muted">This section is not on the record any more.</Text>
    ) : (
      <Stack gap={4}>
        {failed === null ? null : (
          <Alert tone="danger" title="That was not saved">
            {failed}
          </Alert>
        )}
        {confirming === null ? null : (
          <Dialog
            open
            onOpenChange={(open) => {
              if (!open) setConfirming(null);
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{`Change ${load.data.person.name.split(' ')[0] ?? ''}’s manager?`}</DialogTitle>
                <DialogDescription>
                  They report to the person you chose from now on.
                </DialogDescription>
              </DialogHeader>
              <DialogBody>
                {confirming.questions.map((q) => (
                  <Stack key={q.id} gap={2}>
                    <Text weight="semibold">{q.title}</Text>
                    <Text tone="muted">{q.description}</Text>
                    <RadioGroup
                      accessibilityLabel={q.title}
                      value={confirming.answers[q.id] ?? q.value}
                      onValueChange={(v) => {
                        setConfirming((c) =>
                          c === null ? c : { ...c, answers: { ...c.answers, [q.id]: v } },
                        );
                      }}
                    >
                      {q.options.map((o) => (
                        <RadioCard key={o.id} value={o.id} description={o.description}>
                          {o.label}
                        </RadioCard>
                      ))}
                    </RadioGroup>
                  </Stack>
                ))}
              </DialogBody>
              <DialogFooter>
                <Button
                  onPress={() => {
                    setConfirming(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onPress={() => {
                    confirmed.current = confirming.answers;
                    setConfirming(null);
                    void save();
                  }}
                >
                  Change manager
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
        {section.fields.map((field) => (
          <AttributeInput
            key={field.key}
            personId={personId ?? null}
            field={field}
            value={valueOf(field.key)}
            onChange={(value) => {
              setDraft((d) => ({ ...d, [field.key]: value }));
              // A changed identifier is checked again before it saves.
              if (CHECKED.has(field.dataType)) setWarnings(null);
            }}
            warning={warnings?.find((w) => w.key === field.key)?.message}
            problem={problems[field.key]}
          />
        ))}
      </Stack>
    );
  return {
    load,
    reload,
    section,
    form,
    dirty,
    saving,
    anyway: warnings !== null && warnings.length > 0,
    held,
    save,
  };
}

/**
 * Editing one section of a record (design D3) on a page of its own, for
 * where a step sends somebody to fill a section in (a checklist, onboarding).
 * The profile edits in a centred modal instead (`EditSectionDialog`).
 *
 * An identifier is checked before it is saved. When the checks doubt it, the
 * doubt is said under the field and the button becomes "Save anyway": the
 * person may know better, and HR reviews it either way. Some changes wait for
 * HR's approval instead of saving (PEO-077); the toast says which.
 */
export function EditSection({ navigation, route }: PeopleScreen<'EditSection'>): React.JSX.Element {
  const { personId, sectionKey, back } = route.params;
  const edit = useSectionEdit(personId, sectionKey, navigation.goBack);
  const foot =
    edit.load.status === 'ready' && edit.section !== undefined ? (
      <>
        <Button className="flex-1" fullWidth onPress={navigation.goBack} disabled={edit.saving}>
          Cancel
        </Button>
        <Button
          className="flex-1"
          fullWidth
          variant="primary"
          disabled={!edit.dirty}
          loading={edit.saving}
          loadingLabel="Saving"
          onPress={() => void edit.save()}
        >
          {edit.anyway ? 'Save anyway' : edit.held ? 'Send to HR' : 'Save'}
        </Button>
      </>
    ) : undefined;

  return (
    <Page
      {...(edit.section === undefined ? {} : { title: edit.section.label })}
      back={{ label: back, onPress: navigation.goBack }}
      {...(foot === undefined ? {} : { foot })}
    >
      {edit.form}
    </Page>
  );
}

/**
 * Changing a detail (design v3 P14): one centred modal per section, never a
 * page. When a change needs approval, the modal says so and the button says
 * who it goes to.
 */
export function EditSectionDialog({
  personId,
  sectionKey,
  onClose,
}: {
  personId: string | undefined;
  sectionKey: string;
  /** Closed, saved or not: the record reads itself again. */
  onClose: () => void;
}): React.JSX.Element {
  const edit = useSectionEdit(personId, sectionKey, onClose);
  const own = personId === undefined;
  const sensitive = edit.section?.fields.some((f) => f.sensitive === true) === true;
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {edit.section === undefined
              ? 'Edit'
              : own
                ? `Change your ${edit.section.label.toLowerCase()}`
                : `Edit ${edit.section.label.toLowerCase()}`}
          </DialogTitle>
          {own && sensitive ? (
            <DialogDescription>
              HR approves changes to some of these. Your record keeps the old value until then.
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogBody>
          <ScrollView style={{ flexGrow: 0, maxHeight: 440 }}>{edit.form}</ScrollView>
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose} disabled={edit.saving}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            disabled={!edit.dirty}
            loading={edit.saving}
            loadingLabel="Saving"
            onPress={() => void edit.save()}
          >
            {edit.anyway ? 'Save anyway' : edit.held ? 'Send to HR' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
