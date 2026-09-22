'use client';

import { countryRules, COUNTRIES } from '@kithena/contracts';
import {
  Alert,
  AvatarUploader,
  Button,
  Card,
  Combobox,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Spinner,
  Switch,
  type UploadedImage,
} from '@reach/ui';
import Link from 'next/link';
import { useActionState, useCallback, useEffect, useRef, useState, type JSX } from 'react';

import { ThemePicker } from './theme-picker';

/**
 * What the form starts from, which is what the registry currently holds.
 *
 * Every field the PATCH accepts, and no others. The slug is absent because the
 * request has nowhere to put it — see `AmendRequest` in the identity service —
 * and the people are absent because accounts are created and revoked through
 * their own operations that raise their own events.
 */
export interface CompanyDraft {
  readonly displayName: string;
  readonly themeId: string;
  readonly logoUrl: string | null;
  readonly coverImageUrl: string | null;
  readonly brandingPublic: boolean;
  readonly address: {
    readonly country: string;
    readonly line1: string;
    readonly line2: string | null;
    readonly city: string;
    readonly subdivision: string | null;
    readonly postcode: string | null;
  } | null;
}

export type EditResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string; readonly path?: readonly string[] };

const EMPTY_ADDRESS = {
  country: 'GB',
  line1: '',
  line2: null,
  city: '',
  subdivision: null,
  postcode: null,
} as const;

/**
 * Editing a company that already exists.
 *
 * `useActionState` with a `FormData` action rather than a submit handler that
 * calls `fetch`. The internal token lives in the server action's process and
 * never reaches the browser, and the form keeps working through the render
 * before hydration finishes — which for a back-office on a bad connection is
 * the difference between a slow form and a broken one.
 *
 * The images are the exception and are uploaded as they are picked rather than
 * on submit. A multipart body through a server action would work, but it would
 * mean an operator who mistyped a postcode re-picking two files to find out.
 */
export function EditCompanyForm({
  action,
  company,
  companyId,
}: {
  action: (previous: EditResult | null, form: FormData) => Promise<EditResult>;
  company: CompanyDraft;
  companyId: string;
}): JSX.Element {
  // What the registry holds, with the blanks a company that has no address on
  // file would start from. Both the inputs' defaults and the change check read
  // from this, so the two cannot disagree about what "unchanged" means.
  const stored = company.address ?? EMPTY_ADDRESS;
  const [result, submit, pending] = useActionState(action, null);

  /*
   * Save is offered only once something differs from the stored company.
   *
   * A permanently enabled Save on a form that starts full of the current values
   * invites a press that sends the row back to itself — a write, an event and a
   * revision for no change — and, worse, tells an operator nothing about
   * whether the thing they just typed registered.
   *
   * Compared against the values rather than tracked as "has anybody touched
   * anything": typing a character and deleting it again leaves the form
   * *touched* and unchanged, and a Save that stays lit after that is the same
   * lie in a smaller form. Retyping a value identical to the stored one
   * correctly puts it back to disabled.
   */
  const formRef = useRef<HTMLFormElement>(null);
  const [dirty, setDirty] = useState(false);

  const recheck = useCallback(() => {
    const form = formRef.current;
    if (form === null) return;
    const data = new FormData(form);
    const read = (key: string): string => {
      const value = data.get(key);
      return typeof value === 'string' ? value.trim() : '';
    };
    setDirty(
      read('displayName') !== company.displayName ||
        read('themeId') !== company.themeId ||
        read('logoUrl') !== (company.logoUrl ?? '') ||
        read('coverImageUrl') !== (company.coverImageUrl ?? '') ||
        (read('brandingPublic') !== '') !== company.brandingPublic ||
        read('country') !== stored.country ||
        read('line1') !== stored.line1 ||
        read('line2') !== (stored.line2 ?? '') ||
        read('city') !== stored.city ||
        read('subdivision') !== (stored.subdivision ?? '') ||
        read('postcode') !== (stored.postcode ?? ''),
    );
  }, [company, stored]);

  const [themeId, setThemeId] = useState(company.themeId);
  const [logoUrl, setLogoUrl] = useState(company.logoUrl);
  const [coverImageUrl, setCoverImageUrl] = useState(company.coverImageUrl);
  const [brandingPublic, setBrandingPublic] = useState(company.brandingPublic);
  const [country, setCountry] = useState(stored.country);
  const [subdivision, setSubdivision] = useState(stored.subdivision ?? '');

  /*
   * Recomputed after render, not inside the setters.
   *
   * Four of these values reach the action through hidden inputs, so the
   * `FormData` the check reads is only correct once React has re-rendered
   * them. Running it in the setter would compare against the previous frame
   * and report the change one keystroke late.
   */
  useEffect(recheck, [recheck, themeId, logoUrl, coverImageUrl, brandingPublic, country, subdivision]);

  const rules = countryRules(country);
  // The field a failure names, so the message lands under the input that caused
  // it rather than in a banner the operator has to map back onto the form.
  const failed = (field: string): string | undefined =>
    result && !result.ok && result.path?.[0] === field ? result.message : undefined;

  /*
   * Which fields can actually show a message of their own.
   *
   * The banner below used to render only when a refusal named *no* field, on
   * the reasoning that a named one is already shown under its input. That is
   * true only for the fields in this list, and `logoUrl` was not one of them:
   * an image refused by `imageIsOurs` came back as
   * `path: ['logoUrl', 'coverImageUrl']`, the banner suppressed itself because
   * the path was not empty, and the `ImageField` had nowhere to put it. The
   * operator pressed Save and the page did nothing at all — no change, no
   * error, no clue.
   *
   * So the rule is now the honest one: a message is suppressed here only when
   * something else is definitely rendering it.
   */
  const INLINE_FIELDS = new Set([
    'displayName',
    'address.country',
    'address.line1',
    'address.city',
    'address.subdivision',
    'address.postcode',
  ]);
  const shownInline = result && !result.ok && result.path?.[0] !== undefined
    ? INLINE_FIELDS.has(result.path[0])
    : false;

  return (
    // `onInput` covers the text inputs, which are uncontrolled; the effect
    // above covers everything set by a picker, a switch or an uploader.
    <form ref={formRef} action={submit} onInput={recheck} className="flex flex-col gap-8">
      {/* Hidden rather than controlled inputs: these four are set by controls
          that are not form fields — a picker, an uploader, a switch — and this
          is how their values reach the action alongside the text inputs. */}
      <input type="hidden" name="themeId" value={themeId} />
      <input type="hidden" name="logoUrl" value={logoUrl ?? ''} />
      <input type="hidden" name="coverImageUrl" value={coverImageUrl ?? ''} />
      <input type="hidden" name="brandingPublic" value={brandingPublic ? 'on' : ''} />
      {/* `Combobox` is a listbox, not an `<input>`, so it submits nothing of its
          own. These carry its value into the action. */}
      <input type="hidden" name="country" value={country} />
      <input type="hidden" name="subdivision" value={subdivision} />

      <Card variant="outlined" padded className="flex flex-col gap-5">
        <h2 className="text-sm font-medium">Identity</h2>

        <Field invalid={failed('displayName') !== undefined}>
          <FieldLabel htmlFor="displayName">Company name</FieldLabel>
          <Input
            id="displayName"
            name="displayName"
            defaultValue={company.displayName}
            required
          />
          <FieldDescription>
            Shown on their sign-in page and in this list. The hostname they sign in on does not
            change — that is baked into links already sent.
          </FieldDescription>
          <FieldError>{failed('displayName')}</FieldError>
        </Field>

        <div className="border-border bg-surface-sunken/40 grid gap-6 rounded-lg border p-5 sm:grid-cols-2">
          <ImageField
            kind="logo"
            label="Logo"
            ratio="square"
            fit="contain"
            hint="The mark, beside their name in lists."
            url={logoUrl}
            onChange={setLogoUrl}
          />
          <ImageField
            kind="cover"
            label="Company image"
            ratio="wide"
            fit="cover"
            hint="Fills half their sign-in page."
            url={coverImageUrl}
            onChange={setCoverImageUrl}
          />
        </div>

        {/* `Field` rather than a hand-stacked label and two spans. The label
            association, the description's `aria-describedby` and the text
            sizes are all things this already gets right, and a bespoke stack
            beside real `Field`s above it also looked subtly different. */}
        <Field orientation="horizontal">
          <Switch
            id="brandingPublic"
            checked={brandingPublic}
            onCheckedChange={setBrandingPublic}
            className="mt-0.5 shrink-0"
          />
          <div>
            <FieldLabel htmlFor="brandingPublic">
              Show their name and images on the sign-in page
            </FieldLabel>
            <FieldDescription>
              Turn this off for a company that does not want to be named on a page nobody has
              signed in to — mid-acquisition, or in a regulated matter. Their accent colour still
              applies, because it identifies nobody.
            </FieldDescription>
          </div>
        </Field>
      </Card>

      <Card variant="outlined" padded className="flex flex-col gap-5">
        <h2 className="text-sm font-medium">Accent colour</h2>
        <ThemePicker selected={themeId} onChange={setThemeId} />
      </Card>

      <Card variant="outlined" padded className="flex flex-col gap-5">
        <h2 className="text-sm font-medium">Registered address</h2>

        <Field>
          <Combobox
            label="Country"
            options={COUNTRIES.map((c) => ({ value: c.code, label: c.name }))}
            value={country}
            searchPlaceholder="Search countries"
            onChange={(value) => {
              setCountry(typeof value === 'string' ? value : '');
              // A subdivision belongs to the country it was chosen in, so it
              // cannot survive a change of country — keeping it would submit
              // 'ENG' against Germany and fail validation for a reason the
              // operator did not cause and cannot see.
              setSubdivision('');
            }}
          />
          <FieldError>{failed('address.country')}</FieldError>
        </Field>

        <Field invalid={failed('address.line1') !== undefined}>
          <FieldLabel htmlFor="line1">Street address</FieldLabel>
          <Input
            id="line1"
            name="line1"
            defaultValue={stored.line1}
            required
          />
          <FieldError>{failed('address.line1')}</FieldError>
        </Field>

        <Field>
          <FieldLabel htmlFor="line2">Address line 2</FieldLabel>
          <Input id="line2" name="line2" defaultValue={stored.line2 ?? ''} />
          <FieldDescription>Optional.</FieldDescription>
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field invalid={failed('address.city') !== undefined}>
            <FieldLabel htmlFor="city">City or town</FieldLabel>
            <Input
              id="city"
              name="city"
              defaultValue={stored.city}
              required
              />
            <FieldError>{failed('address.city')}</FieldError>
          </Field>

          {rules && rules.subdivisions.length > 0 ? (
            <Field>
              <Combobox
                label={rules.subdivisionLabel}
                options={rules.subdivisions.map((sub) => ({ value: sub.code, label: sub.name }))}
                value={subdivision === '' ? null : subdivision}
                placeholder={`Choose a ${rules.subdivisionLabel.toLowerCase()}`}
                searchPlaceholder="Search"
                onChange={(value) => {
                  setSubdivision(typeof value === 'string' ? value : '');
                }}
              />
              <FieldError>{failed('address.subdivision')}</FieldError>
            </Field>
          ) : null}
        </div>

        {rules?.postcode ? (
          <Field invalid={failed('address.postcode') !== undefined}>
            <FieldLabel htmlFor="postcode">{rules.postcodeLabel}</FieldLabel>
            <Input
              id="postcode"
              name="postcode"
              defaultValue={stored.postcode ?? ''}
              placeholder={rules.postcodeExample}
              />
            <FieldError>{failed('address.postcode')}</FieldError>
          </Field>
        ) : null}
      </Card>

      {/* Every failure that is not already shown under an input. Repeating one
          that is would have an operator fix the same thing twice; swallowing
          one that is not is a Save button that silently does nothing. */}
      {result && !result.ok && !shownInline ? (
        <Alert tone="danger" title="That did not save">
          {result.message}
        </Alert>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending || !dirty}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
        <Button asChild variant="ghost">
          <Link href={`/companies/${companyId}`}>Cancel</Link>
        </Button>
        {pending ? <Spinner size="sm" /> : null}
      </div>
    </form>
  );
}

/**
 * One image, uploaded the moment it is chosen.
 *
 * The same shape as the wizard's, and deliberately not shared with it. The two
 * differ in what they own — the wizard holds a draft that does not exist yet and
 * reports both images up to one reducer, this one holds a company that does —
 * and the version that served both would take a discriminator and a callback
 * shape neither of them wants. It is thirty lines; the abstraction is the more
 * expensive of the two.
 */
function ImageField({
  kind,
  label,
  hint,
  ratio,
  fit,
  url,
  onChange,
}: {
  kind: 'logo' | 'cover';
  label: string;
  hint: string;
  ratio: 'square' | 'wide';
  fit: 'cover' | 'contain';
  url: string | null;
  onChange: (url: string | null) => void;
}): JSX.Element {
  const [picked, setPicked] = useState<readonly UploadedImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = (next: readonly UploadedImage[]): void => {
    setError(null);
    const file = next.at(-1);

    if (file === undefined) {
      setPicked([]);
      onChange(null);
      return;
    }

    setPicked(next);
    setUploading(true);

    const body = new FormData();
    body.set('file', file.file);
    body.set('kind', kind);

    void fetch('/api/upload', { method: 'POST', body })
      .then(async (response) => {
        const payload = (await response.json()) as { url?: string; message?: string };
        if (!response.ok) throw new Error(payload.message ?? 'That upload failed.');
        onChange(payload.url ?? null);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'That upload failed.');
        setPicked([]);
      })
      .finally(() => {
        setUploading(false);
      });
  };

  return (
    <div>
      <AvatarUploader
        label={label}
        hint={uploading ? 'Uploading…' : hint}
        value={picked}
        onChange={accept}
        src={url}
        orientation="stacked"
        shape="rounded"
        ratio={ratio}
        fit={fit}
        accept={['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']}
        maxSize={2 * 1024 * 1024}
        disabled={uploading}
        invalid={error !== null}
        onReject={(rejections) => {
          setError(rejections[0]?.message ?? 'That image was not accepted.');
        }}
      />
      {error === null ? null : <p className="text-danger-fg mt-2 text-xs">{error}</p>}
    </div>
  );
}
