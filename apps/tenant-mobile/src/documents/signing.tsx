import {
  ActionSheet,
  ActionSheetContent,
  ActionSheetItem,
  AdoptSignatureDialog,
  Alert,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Icon,
  Input,
  PdfPages,
  PlacementLayer,
  Signature,
  Text,
  type SignatureValue,
  allRequiredFilled,
  isFilled,
  nextToFill,
  readingOrder,
} from '@reach/ui-native';
import { File, Paths } from 'expo-file-system';
import { ArrowRight, Ellipsis, MessageCircle, PenLine, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Failed, Loading, Page } from '../frame';
import { ask, useSigned, type Signed } from '../people/api';
import { signatureFaces } from '../signature-faces';
import { markOf } from '../signature-mark';
import { askDocuments } from './api';

/**
 * Signing on the phone as on the web (`sign-view.tsx`), as DocuSign does it:
 * the document itself, with only this signer's boxes on it. "Start", then
 * "Next", takes them to each box in page order; pressing a box, or "Apply",
 * fills it — a signature with the one they adopted or keep on file, the date
 * with today's, their name with their name. When every box that must be
 * filled is, "Finish" signs.
 */

export interface SigningEnvelope {
  readonly id: string;
  readonly title: string;
  readonly sender: string;
  readonly signers: readonly { readonly id: string; readonly name: string }[];
  readonly fields: readonly EnvelopeField[];
  readonly me: { readonly signerId: string } | null;
}

type Kind = 'signature' | 'initials' | 'date' | 'name' | 'title' | 'checkbox' | 'text';

interface EnvelopeField {
  readonly id: string;
  readonly signerId: string;
  readonly kind: Kind;
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly required: boolean;
  readonly label: string | null;
}

const KIND_LABEL: Readonly<Record<Kind, string>> = {
  signature: 'Signature',
  initials: 'Initials',
  date: 'Date signed',
  name: 'Name',
  title: 'Job title',
  text: 'Text',
  checkbox: 'Tick box',
};

const HINT: Readonly<Record<Kind, string>> = {
  signature: 'Sign',
  initials: 'Initial',
  date: 'Date',
  name: 'Name',
  title: 'Title',
  text: 'Text',
  checkbox: '',
};

/**
 * Today on the signer's own calendar, as the phone has it: what a date box
 * shows and what the server records, within a day of its clock.
 */
const today = (): string =>
  new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  );

/** The web's `useSigning`: which box is due comes from Reach's placement model, as there. */
function useSigning(env: SigningEnvelope, name: string, onFile: SignatureValue | null) {
  const me = env.me?.signerId ?? '';
  // A fresh array from filter(), so sorting it in place is safe; Hermes has no toSorted.
  const mine = env.fields.filter((f) => f.signerId === me).sort(readingOrder);
  const [mark, setMark] = useState<SignatureValue | null>(onFile);
  const [filled, setFilled] = useState<Readonly<Record<string, string>>>({});
  const [focus, setFocus] = useState<string | null>(null);
  const [adopting, setAdopting] = useState(false);
  const [waiting, setWaiting] = useState<string | null>(null);

  // Reach's model of which box is due, the web's too: an optional tick box is never a step.
  const done = (f: EnvelopeField) => isFilled(filled[f.id]);
  const next = nextToFill(mine, filled, (f) => f.kind === 'checkbox');
  const ready = allRequiredFilled(mine, filled);

  const apply = (id: string) => {
    const f = mine.find((x) => x.id === id);
    if (f === undefined) return;
    setFocus(id);
    switch (f.kind) {
      case 'signature':
      case 'initials':
        if (mark === null) {
          setWaiting(f.id);
          setAdopting(true);
        } else setFilled((was) => ({ ...was, [f.id]: 'signed' }));
        return;
      case 'date':
        setFilled((was) => ({ ...was, [f.id]: today() }));
        return;
      case 'name':
        setFilled((was) => ({ ...was, [f.id]: name }));
        return;
      case 'checkbox':
        setFilled((was) => ({ ...was, [f.id]: was[f.id] === 'true' ? 'false' : 'true' }));
        return;
      case 'text':
      case 'title':
        setWaiting(f.id);
        return;
    }
  };

  return {
    mine,
    mark,
    filled,
    focus,
    next,
    ready,
    adopting,
    waiting,
    done,
    apply,
    closeAdopting: () => {
      setAdopting(false);
      setWaiting(null);
    },
    adopt: (m: SignatureValue) => {
      setMark(m);
      setAdopting(false);
      // The box that asked for it gets it at once.
      if (waiting !== null) setFilled((was) => ({ ...was, [waiting]: 'signed' }));
      setWaiting(null);
    },
    setText: (id: string, text: string) => {
      if (text !== '') setFilled((was) => ({ ...was, [id]: text }));
      setWaiting(null);
    },
    goNext: () => {
      if (next !== null) apply(next.id);
    },
    /** Values as the server takes them: typed text and ticks; signatures and dates it fills. */
    values: Object.fromEntries(
      mine.flatMap((f) =>
        f.kind === 'text' || f.kind === 'title' || f.kind === 'checkbox'
          ? [[f.id, filled[f.id] ?? '']]
          : [],
      ),
    ) as Readonly<Record<string, string>>,
  };
}

/** The signature People keeps for this person, as the web's shell reads it (`my-signature.ts`). */
interface OnFile {
  readonly key: string;
  readonly mark: SignatureValue | null;
  /** None on file, none waiting for HR, and theirs to write: one adopted here is kept. */
  readonly canKeep: boolean;
}

async function onFileFor(signed: Signed): Promise<OnFile | null> {
  const profile = await ask<{
    sections: readonly {
      fields: readonly { key: string; dataType: string; readOnly: boolean }[];
    }[];
    values: readonly { key: string; text?: string }[];
    pending: readonly { key: string }[];
  }>(signed, 'Profile', { personId: null });
  if (!profile.ok) return null;
  const field = profile.data.sections
    .flatMap((s) => s.fields)
    .find((f) => f.dataType === 'signature');
  if (field === undefined) return null;
  const mark = markOf(profile.data.values.find((v) => v.key === field.key)?.text);
  const pending = profile.data.pending.some((p) => p.key === field.key);
  return { key: field.key, mark, canKeep: !field.readOnly && mark === null && !pending };
}

/** The file being signed, as a `data:` URL for `PdfPages`: fetched by the phone, never through the company's host. */
async function fileFor(signed: Signed, envelopeId: string): Promise<string> {
  const link = await askDocuments<{ url: string | null; base64: string | null }>(
    signed,
    'DocumentsEnvelopeFile',
    { envelopeId },
  );
  if (!link.ok) throw new Error(link.message);
  if (link.data.base64 !== null) return `data:application/pdf;base64,${link.data.base64}`;
  if (link.data.url === null) throw new Error('There is no file store here.');
  const file = await File.downloadFileAsync(
    link.data.url,
    new File(Paths.cache, `signing-${envelopeId}.pdf`),
    { idempotent: true },
  );
  const bytes = await file.base64();
  file.delete();
  return `data:application/pdf;base64,${bytes}`;
}

type Ready =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly src: string; readonly onFile: OnFile | null };

export function SignDocument({
  env,
  back,
  onAsk,
  onDecline,
  onSigned,
}: {
  readonly env: SigningEnvelope;
  readonly back: { label: string; onPress: () => void };
  readonly onAsk: () => void;
  readonly onDecline: () => void;
  readonly onSigned: (completed: boolean) => void;
}): React.JSX.Element {
  const signed = useSigned();
  const [load, setLoad] = useState<Ready>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setLoad({ status: 'loading' });
    // All at once: the faces and the signature on file are ready long before the file is.
    void Promise.all([fileFor(signed, env.id), onFileFor(signed), signatureFaces()]).then(
      ([src, onFile]) => {
        if (live) setLoad({ status: 'ready', src, onFile });
      },
      (e: unknown) => {
        if (live)
          setLoad({
            status: 'error',
            message: e instanceof Error ? e.message : 'The document could not be opened.',
          });
      },
    );
    return () => {
      live = false;
    };
  }, [signed, env.id, attempt]);

  if (load.status !== 'ready') {
    return (
      <Page title="Sign" back={back}>
        {load.status === 'error' ? (
          <Failed
            message={load.message}
            onRetry={() => {
              setAttempt((n) => n + 1);
            }}
          />
        ) : (
          <Loading label="Opening the document" />
        )}
      </Page>
    );
  }
  return (
    <Signing
      env={env}
      src={load.src}
      onFile={load.onFile}
      back={back}
      onAsk={onAsk}
      onDecline={onDecline}
      onSigned={onSigned}
    />
  );
}

function Signing({
  env,
  src,
  onFile,
  back,
  onAsk,
  onDecline,
  onSigned,
}: {
  readonly env: SigningEnvelope;
  readonly src: string;
  readonly onFile: OnFile | null;
  readonly back: { label: string; onPress: () => void };
  readonly onAsk: () => void;
  readonly onDecline: () => void;
  readonly onSigned: (completed: boolean) => void;
}): React.JSX.Element {
  const signed = useSigned();
  const name = env.signers.find((s) => s.id === env.me?.signerId)?.name ?? '';
  const signing = useSigning(env, name, onFile?.mark ?? null);
  const [menu, setMenu] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const typing = signing.mine.find(
    (f) => f.id === signing.waiting && (f.kind === 'text' || f.kind === 'title'),
  );
  const focused = signing.mine.find((f) => f.id === signing.focus);
  const filledCount = signing.mine.filter(signing.done).length;
  const company = signed.company.displayName ?? signed.company.slug;
  const needsMark = signing.mine.some((f) => f.kind === 'signature' || f.kind === 'initials');
  // The signer's colour on the sender's screen: one of six, by their place in the order.
  const tone = ((Math.max(
    0,
    env.signers.findIndex((s) => s.id === env.me?.signerId),
  ) %
    6) +
    1) as 1 | 2 | 3 | 4 | 5 | 6;

  const finish = async () => {
    setBusy(true);
    setProblem(null);
    const r = await askDocuments<{ completed: boolean }>(signed, 'SignEnvelope', {
      envelopeId: env.id,
      input: {
        signature: signing.mark ?? { kind: 'typed', text: name },
        values: signing.values,
        day: today(),
        origin: signed.company.origin,
        companyName: company,
      },
    });
    setBusy(false);
    if (r.ok) onSigned(r.data.completed);
    else setProblem(r.message);
  };

  const keep = (m: SignatureValue) => {
    if (onFile?.canKeep !== true) return;
    // Kept as their own change: held for HR where the field needs approval.
    void ask(signed, 'SaveOwnSection', {
      changed: [{ key: onFile.key, text: JSON.stringify(m) }],
    });
  };

  return (
    <Page
      title="Sign"
      back={back}
      scroll={false}
      trailing={
        <Button
          variant="ghost"
          size="sm"
          accessibilityLabel="More"
          startIcon={<Icon icon={Ellipsis} />}
          onPress={() => {
            setMenu(true);
          }}
        />
      }
      foot={
        signing.ready ? (
          <Button
            className="flex-1"
            variant="primary"
            startIcon={<Icon icon={PenLine} tone="on-accent" />}
            disabled={needsMark && signing.mark === null}
            loading={busy}
            onPress={() => void finish()}
          >
            Finish
          </Button>
        ) : (
          <>
            {focused !== undefined &&
            (focused.kind === 'signature' || focused.kind === 'initials') &&
            !signing.done(focused) ? (
              <Button
                className="flex-1"
                variant="primary"
                startIcon={<Icon icon={PenLine} tone="on-accent" />}
                onPress={() => {
                  signing.apply(focused.id);
                }}
              >
                {signing.mark === null ? 'Adopt and apply' : 'Apply'}
              </Button>
            ) : null}
            <Button
              className="flex-1"
              variant={signing.focus === null ? 'primary' : 'secondary'}
              endIcon={
                <Icon icon={ArrowRight} tone={signing.focus === null ? 'on-accent' : 'default'} />
              }
              onPress={signing.goNext}
            >
              {signing.focus === null ? 'Start' : 'Next'}
            </Button>
          </>
        )
      }
    >
      <View className="gap-1" accessibilityLiveRegion="polite">
        <Text variant="headline" numberOfLines={1}>
          {env.title}
        </Text>
        <Text variant="footnote" tone="muted">
          {signing.ready
            ? 'Every box is filled. Finish to sign.'
            : `${String(filledCount)} of ${String(signing.mine.length)} boxes filled`}
        </Text>
      </View>
      {problem === null ? null : (
        <Alert tone="danger" title="Not signed">
          {problem}
        </Alert>
      )}
      <PdfPages
        src={src}
        label={env.title}
        overlay={(page) => (
          <PlacementLayer
            focus={signing.focus}
            onActivate={signing.apply}
            boxes={signing.mine
              .filter((f) => f.page === page.number)
              .map((f) => {
                const done = signing.done(f);
                return {
                  id: f.id,
                  x: f.x,
                  y: f.y,
                  w: f.w,
                  h: f.h,
                  tone,
                  label: done
                    ? `${KIND_LABEL[f.kind]}, filled`
                    : `${f.label ?? KIND_LABEL[f.kind]}${f.required ? '' : ', optional'}`,
                  hint: HINT[f.kind],
                  done,
                };
              })}
            render={(box) => {
              if (box.done !== true) return null;
              const f = signing.mine.find((x) => x.id === box.id);
              if (f === undefined) return null;
              if ((f.kind === 'signature' || f.kind === 'initials') && signing.mark !== null)
                return (
                  <Signature
                    value={signing.mark}
                    initials={f.kind === 'initials'}
                    label={`${name}’s ${f.kind === 'initials' ? 'initials' : 'signature'}`}
                    className="text-[var(--reach-neutral-900)]"
                  />
                );
              return (
                <Text
                  variant="caption"
                  numberOfLines={1}
                  className="px-1 text-[var(--reach-neutral-900)]"
                >
                  {f.kind === 'checkbox' ? '✓' : (signing.filled[f.id] ?? '')}
                </Text>
              );
            }}
          />
        )}
      />
      <Text variant="caption" tone="muted">
        Signed with your Kithena login. The time and your device are recorded.
      </Text>
      <AdoptSignatureDialog
        open={signing.adopting}
        name={name}
        action="Adopt and sign"
        onOpenChange={(open) => {
          if (!open) signing.closeAdopting();
        }}
        onAdopt={(m) => {
          signing.adopt(m);
          keep(m);
        }}
      />
      <Dialog
        open={typing !== undefined}
        onOpenChange={(open) => {
          if (!open && typing !== undefined) signing.setText(typing.id, '');
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{typing?.label ?? KIND_LABEL[typing?.kind ?? 'text']}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <Field>
              <FieldLabel>{typing?.label ?? KIND_LABEL[typing?.kind ?? 'text']}</FieldLabel>
              <Input value={text} maxLength={200} onChange={setText} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button
              className="flex-1"
              variant="primary"
              disabled={text.trim() === ''}
              onPress={() => {
                if (typing !== undefined) signing.setText(typing.id, text.trim());
                setText('');
              }}
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ActionSheet open={menu} onOpenChange={setMenu}>
        <ActionSheetContent title={env.title}>
          <ActionSheetItem icon={MessageCircle} onSelect={onAsk}>
            {`Ask ${env.sender} a question`}
          </ActionSheetItem>
          <ActionSheetItem icon={X} onSelect={onDecline}>
            Decline to sign
          </ActionSheetItem>
        </ActionSheetContent>
      </ActionSheet>
    </Page>
  );
}
