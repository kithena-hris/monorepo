import 'server-only';

import { SignatureMark } from '@kithena/contracts';

import { people } from './people';
import { t } from './t';

/**
 * A person's own signature, where People keeps one: the first field of type
 * `signature` on their record (Settings › Employee fields). Documents never
 * reads People; the shell joins the two (Documents PRD §5.4), so a request is
 * signed with the signature on file, and one adopted while signing is kept
 * when there is none.
 *
 * Null when People is not here, or the company has no signature field.
 */
export interface MySignature {
  /** Their legal first and last name: what a typed signature says, never a preferred name. */
  readonly name: string;
  /** The field it is kept in. */
  readonly key: string;
  readonly label: string;
  /** The signature on file, as Documents signs with it; null for none yet. */
  readonly mark: SignatureMark | null;
  /** A change to it is waiting for HR's approval. */
  readonly pending: boolean;
  /** They may set one now: none on file, none waiting, and theirs to write. */
  readonly canKeep: boolean;
  /** They may change it, in Settings: theirs to write. */
  readonly canChange: boolean;
}

interface ProfileField {
  readonly key: string;
  readonly label: string;
  readonly dataType: string;
  readonly readOnly: boolean;
}

const markOf = (text: string | undefined): SignatureMark | null => {
  if (text === undefined || text === '') return null;
  try {
    const parsed = SignatureMark.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

interface Profile {
  person: { name: string };
  sections: readonly { fields: readonly ProfileField[] }[];
  values: readonly { key: string; text?: string }[];
  pending: readonly { key: string }[];
}

/** "Ada Lovelace" from the legal names People keeps; their display name if those are empty. */
const legalOf = (profile: Profile): string => {
  const said = (key: string) => profile.values.find((v) => v.key === key)?.text?.trim() ?? '';
  return `${said('given_name')} ${said('family_name')}`.trim() || profile.person.name;
};

/**
 * The signer's legal first and last name, for the adopt dialog: a document is
 * signed with it, never with a preferred name. Null when People is not here.
 * The same read as `mySignature`, answered once per request.
 */
export async function myLegalName(): Promise<string | null> {
  const profile = await people<Profile>('Profile', { personId: null });
  return profile.ok ? legalOf(profile.data) : null;
}

export async function mySignature(): Promise<MySignature | null> {
  const profile = await people<Profile>('Profile', { personId: null });
  if (!profile.ok) return null;
  const field = profile.data.sections
    .flatMap((s) => s.fields)
    .find((f) => f.dataType === 'signature');
  if (field === undefined) return null;
  const mark = markOf(profile.data.values.find((v) => v.key === field.key)?.text);
  const pending = profile.data.pending.some((p) => p.key === field.key);
  return {
    name: legalOf(profile.data),
    key: field.key,
    label: field.label,
    mark,
    pending,
    canKeep: !field.readOnly && mark === null && !pending,
    canChange: !field.readOnly,
  };
}

/**
 * Keep a signature on the person's record, as their own change: held for HR
 * where the field needs approval, as any change of theirs is. `onlyIfNone`
 * keeps one adopted while signing from replacing one already there.
 */
export async function keepMySignature(
  mark: SignatureMark,
  onlyIfNone: boolean,
): Promise<{ ok: true; held: boolean } | { ok: false; message: string }> {
  const parsed = SignatureMark.safeParse(mark);
  if (!parsed.success)
    return {
      ok: false,
      message: t('lib.my-signature.that_is_not_a_signature', 'That is not a signature'),
    };
  const mine = await mySignature();
  if (mine === null)
    return {
      ok: false,
      message: t(
        'lib.my-signature.your_company_keeps_no_signature',
        'Your company keeps no signature on file',
      ),
    };
  if (onlyIfNone && !mine.canKeep) return { ok: true, held: mine.pending };
  if (!mine.canChange)
    return {
      ok: false,
      message: t(
        'lib.my-signature.your_signature_is_hrs_to_change',
        'Your signature is HR’s to change',
      ),
    };
  const saved = await people<{ ok: boolean; held: boolean | null }>('SaveOwnSection', {
    changed: [{ key: mine.key, text: JSON.stringify(parsed.data) }],
  });
  return saved.ok
    ? { ok: true, held: saved.data.held === true }
    : { ok: false, message: saved.message };
}
