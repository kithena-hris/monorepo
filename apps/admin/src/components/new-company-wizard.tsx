'use client';

import {
  Alert,
  Badge,
  Button,
  Combobox,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Stepper,
} from '@reach/ui';
import {
  COUNTRIES,
  DEFAULT_THEME_ID,
  THEME_PRESETS,
  checkAddress,
  countryRules,
  type PostalAddress,
} from '@kithena/contracts';
import { useMemo, useState, type JSX } from 'react';

/**
 * Adding a company, in four steps.
 *
 * A wizard rather than one long form because the four groups need different
 * things from the person filling them in: a name is typed, an address is
 * looked up, administrators are gathered from someone else, and a theme is
 * chosen by eye. On one page the last of those sits below the fold and gets
 * whatever colour was first in the list.
 *
 * Each step validates before it will advance, and validates against the same
 * `@kithena/contracts` rules the identity service applies. That is the point of
 * importing them rather than restating them here: a client-side rule that
 * disagrees with the server is a form that either blocks a valid company or
 * promises one it cannot create. The server still checks everything — this is
 * for the person's benefit, not the database's.
 */

type Result =
  | { ok: true; slug: string; invitations: { email: string; token: string }[] }
  | { ok: false; message: string; path?: string[] };

interface Draft {
  displayName: string;
  slug: string;
  logoUrl: string | null;
  coverImageUrl: string | null;
  address: PostalAddress;
  admins: string[];
  themeId: string;
}

const EMPTY: Draft = {
  displayName: '',
  slug: '',
  logoUrl: null,
  coverImageUrl: null,
  address: { country: '', line1: '', line2: null, city: '', subdivision: null, postcode: null },
  admins: [],
  themeId: DEFAULT_THEME_ID,
};

const STEPS = [
  { id: 'identity', label: 'Company', description: 'Name and images' },
  { id: 'address', label: 'Address', description: 'Registered office' },
  { id: 'admins', label: 'Administrators', description: 'Who can sign in' },
  { id: 'theme', label: 'Theme', description: 'Their accent colour' },
] as const;

type Problems = Partial<Record<string, string>>;

/** The slug rules, restated as a hint rather than as a second source of truth. */
function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

export function NewCompanyWizard({
  action,
}: {
  action: (draft: Draft) => Promise<Result>;
}): JSX.Element {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [problems, setProblems] = useState<Problems>({});
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void => {
    setDraft((d) => ({ ...d, [key]: value }));
    setProblems((p) => ({ ...p, [key]: undefined }));
  };

  const setAddress = <K extends keyof PostalAddress>(key: K, value: PostalAddress[K]): void => {
    setDraft((d) => ({ ...d, address: { ...d.address, [key]: value } }));
    setProblems((p) => ({ ...p, [`address.${key}`]: undefined }));
  };

  const rules = useMemo(() => countryRules(draft.address.country), [draft.address.country]);

  if (result?.ok === true) return <Created result={result} />;

  const validate = (index: number): Problems => {
    const found: Problems = {};

    if (index === 0) {
      if (draft.displayName.trim() === '') found['displayName'] = 'A company needs a name.';
      if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(draft.slug)) {
        found['slug'] = '3 to 63 characters of a–z, 0–9 and hyphens, not starting or ending in one.';
      } else if (draft.slug.includes('--')) {
        found['slug'] = 'Two hyphens in a row are not allowed — they begin a punycode name.';
      }
    }

    if (index === 1) {
      if (draft.address.country === '') found['address.country'] = 'Choose a country.';
      if (draft.address.line1.trim() === '') found['address.line1'] = 'A street address is needed.';
      if (draft.address.city.trim() === '') found['address.city'] = 'A city or town is needed.';
      // The country-dependent half comes from the contract, so a Dutch postcode
      // is judged by Dutch rules without this file knowing what those are.
      if (draft.address.country !== '') {
        for (const problem of checkAddress(draft.address)) {
          found[`address.${problem.field}`] ??= capitalise(problem.message);
        }
      }
    }

    if (index === 2 && draft.admins.length === 0) {
      found['admins'] = 'Add at least one administrator, or nobody can sign in.';
    }

    return found;
  };

  const advance = (): void => {
    const found = validate(step);
    setProblems(found);
    if (Object.values(found).some(Boolean)) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const submit = (): void => {
    // Every step, not just the last. A person can reach step four, go back and
    // empty step one, and the only thing that would catch it is the server.
    const all: Problems = { ...validate(0), ...validate(1), ...validate(2) };
    setProblems(all);
    const firstBroken = [0, 1, 2].find((i) => Object.values(validate(i)).some(Boolean));
    if (firstBroken !== undefined) {
      setStep(firstBroken);
      return;
    }

    setBusy(true);
    void action(draft)
      .then((r) => {
        setResult(r);
        // A refusal that names a field sends the person to the step holding it
        // rather than showing a message four steps from what it is about.
        if (!r.ok && r.path?.[0]) {
          const field = r.path[0];
          setProblems({ [field]: r.message });
          const owner = field.startsWith('address.') ? 1 : field === 'admins' ? 2 : 0;
          setStep(owner);
          setResult(null);
        }
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div className="mt-8 flex flex-col gap-8">
      <Stepper
        steps={STEPS.map((s, i) => ({
          ...s,
          // Spread rather than set to `undefined`: `exactOptionalPropertyTypes`
          // distinguishes an absent key from one holding undefined, and
          // `StepperStep.status` accepts only the first.
          ...(i < step && Object.keys(validate(i)).length > 0
            ? { status: 'error' as const }
            : {}),
        }))}
        current={step}
        label="Adding a company"
        onStepChange={(index) => {
          // Backwards only. Jumping forward would skip the validation the steps
          // in between exist to do.
          if (index < step) setStep(index);
        }}
      />

      {result?.ok === false ? (
        <Alert tone="danger" title="Not created">
          {result.message}
        </Alert>
      ) : null}

      {step === 0 ? (
        <IdentityStep
          draft={draft}
          problems={problems}
          slugTouched={slugTouched}
          onName={(name) => {
            set('displayName', name);
            if (!slugTouched) set('slug', suggestSlug(name));
          }}
          onSlug={(slug) => {
            setSlugTouched(true);
            set('slug', slug);
          }}
          onImage={(kind, url) => {
            set(kind === 'logo' ? 'logoUrl' : 'coverImageUrl', url);
          }}
        />
      ) : null}

      {step === 1 ? (
        <AddressStep draft={draft} problems={problems} rules={rules} onChange={setAddress} />
      ) : null}

      {step === 2 ? (
        <AdminsStep
          admins={draft.admins}
          problem={problems['admins']}
          onChange={(admins) => {
            set('admins', admins);
          }}
        />
      ) : null}

      {step === 3 ? (
        <ThemeStep
          selected={draft.themeId}
          onChange={(id) => {
            set('themeId', id);
          }}
        />
      ) : null}

      <div className="border-border flex items-center justify-between border-t pt-6">
        <Button
          variant="ghost"
          disabled={step === 0 || busy}
          onClick={() => {
            setStep((s) => Math.max(0, s - 1));
          }}
        >
          Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={advance}>Continue</Button>
        ) : (
          <Button onClick={submit} disabled={busy}>
            {busy ? 'Creating…' : 'Create company'}
          </Button>
        )}
      </div>
    </div>
  );
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function IdentityStep({
  draft,
  problems,
  slugTouched,
  onName,
  onSlug,
  onImage,
}: {
  draft: Draft;
  problems: Problems;
  slugTouched: boolean;
  onName: (value: string) => void;
  onSlug: (value: string) => void;
  onImage: (kind: 'logo' | 'cover', url: string | null) => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      <Field invalid={Boolean(problems['displayName'])}>
        <FieldLabel htmlFor="displayName">Company name</FieldLabel>
        <Input
          id="displayName"
          value={draft.displayName}
          placeholder="Acme Corp"
          onChange={(e) => {
            onName(e.target.value);
          }}
        />
        <FieldError>{problems['displayName']}</FieldError>
      </Field>

      <Field invalid={Boolean(problems['slug'])}>
        <FieldLabel htmlFor="slug">Address</FieldLabel>
        <Input
          id="slug"
          value={draft.slug}
          placeholder="acme"
          onChange={(e) => {
            onSlug(e.target.value.toLowerCase());
          }}
        />
        <FieldDescription>
          {draft.slug === ''
            ? 'Becomes their sign-in address.'
            : `Becomes ${draft.slug}.app.kithena.com`}
          {slugTouched ? '' : ' Suggested from the name; edit it if you prefer.'}
        </FieldDescription>
        <FieldError>{problems['slug']}</FieldError>
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <ImageField
          kind="logo"
          label="Logo"
          hint="The mark, shown beside their name in lists. Square works best."
          url={draft.logoUrl}
          onChange={onImage}
        />
        <ImageField
          kind="cover"
          label="Company image"
          hint="Optional. Fills the left half of their sign-in page."
          url={draft.coverImageUrl}
          onChange={onImage}
        />
      </div>
    </div>
  );
}

/**
 * One image, uploaded on selection.
 *
 * Deliberately not `ImageUploader` from the design system: that component
 * manages a list and its own local object URLs, and this needs exactly one
 * image whose identity is the Blob URL the server returned. Wrapping it would
 * have meant fighting it for ownership of the value.
 */
function ImageField({
  kind,
  label,
  hint,
  url,
  onChange,
}: {
  kind: 'logo' | 'cover';
  label: string;
  hint: string;
  url: string | null;
  onChange: (kind: 'logo' | 'cover', url: string | null) => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = (file: File): void => {
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.set('file', file);
    body.set('kind', kind);
    void fetch('/api/upload', { method: 'POST', body })
      .then(async (response) => {
        const payload = (await response.json()) as { url?: string; message?: string };
        if (!response.ok) throw new Error(payload.message ?? 'That upload failed.');
        onChange(kind, payload.url ?? null);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'That upload failed.');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <Field invalid={Boolean(error)}>
      <FieldLabel htmlFor={`image-${kind}`}>{label}</FieldLabel>
      {url === null ? (
        <input
          id={`image-${kind}`}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          disabled={busy}
          className="border-border bg-bg text-fg-muted file:bg-surface file:text-fg file:border-border rounded-md border px-3 py-2 text-sm file:mr-3 file:rounded file:border file:px-2 file:py-1 file:text-xs"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
          }}
        />
      ) : (
        <div className="border-border flex items-center gap-3 rounded-md border p-3">
          {/* A plain img, not next/image: a Blob URL on a host next.config
              would have to list in remotePatterns. */}
          <img src={url} alt="" className="bg-surface size-12 rounded object-contain" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange(kind, null);
            }}
          >
            Remove
          </Button>
        </div>
      )}
      <FieldDescription>{busy ? 'Uploading…' : hint}</FieldDescription>
      <FieldError>{error}</FieldError>
    </Field>
  );
}

function AddressStep({
  draft,
  problems,
  rules,
  onChange,
}: {
  draft: Draft;
  problems: Problems;
  rules: ReturnType<typeof countryRules>;
  onChange: <K extends keyof PostalAddress>(key: K, value: PostalAddress[K]) => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      <Field invalid={Boolean(problems['address.country'])}>
        <FieldLabel>Country</FieldLabel>
        <Combobox
          label="Country"
          options={COUNTRIES.map((c) => ({ value: c.code, label: c.name }))}
          value={draft.address.country === '' ? null : draft.address.country}
          placeholder="Choose a country"
          searchPlaceholder="Search countries"
          onChange={(value) => {
            // The subdivision and postcode belong to the old country. Keeping
            // them would leave a Spanish province filed against Germany, which
            // passes every per-field check.
            onChange('country', typeof value === 'string' ? value : '');
            onChange('subdivision', null);
            onChange('postcode', null);
          }}
        />
        <FieldDescription>Everything below depends on this.</FieldDescription>
        <FieldError>{problems['address.country']}</FieldError>
      </Field>

      <fieldset
        disabled={rules === undefined}
        className="flex flex-col gap-5 disabled:opacity-50"
      >
        <Field invalid={Boolean(problems['address.line1'])}>
          <FieldLabel htmlFor="line1">Street and number</FieldLabel>
          <Input
            id="line1"
            value={draft.address.line1}
            placeholder="Calle de Alcalá 45"
            onChange={(e) => {
              onChange('line1', e.target.value);
            }}
          />
          <FieldError>{problems['address.line1']}</FieldError>
        </Field>

        <Field>
          <FieldLabel htmlFor="line2">Door, floor or unit</FieldLabel>
          <Input
            id="line2"
            value={draft.address.line2 ?? ''}
            placeholder="3º izquierda"
            onChange={(e) => {
              onChange('line2', e.target.value === '' ? null : e.target.value);
            }}
          />
          <FieldDescription>Optional.</FieldDescription>
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field invalid={Boolean(problems['address.city'])}>
            <FieldLabel htmlFor="city">City or town</FieldLabel>
            <Input
              id="city"
              value={draft.address.city}
              placeholder="Madrid"
              onChange={(e) => {
                onChange('city', e.target.value);
              }}
            />
            <FieldError>{problems['address.city']}</FieldError>
          </Field>

          <Field invalid={Boolean(problems['address.subdivision'])}>
            <FieldLabel>{rules?.subdivisionLabel ?? 'Region'}</FieldLabel>
            <Combobox
              label={rules?.subdivisionLabel ?? 'Region'}
              options={(rules?.subdivisions ?? []).map((s) => ({ value: s.code, label: s.name }))}
              value={draft.address.subdivision}
              placeholder={rules ? `Choose a ${rules.subdivisionLabel.toLowerCase()}` : 'Choose a country first'}
              searchPlaceholder="Search"
              disabled={rules === undefined}
              onChange={(value) => {
                onChange('subdivision', typeof value === 'string' ? value : null);
              }}
            />
            <FieldError>{problems['address.subdivision']}</FieldError>
          </Field>
        </div>

        <Field invalid={Boolean(problems['address.postcode'])}>
          <FieldLabel htmlFor="postcode">{rules?.postcodeLabel ?? 'Postcode'}</FieldLabel>
          <Input
            id="postcode"
            value={draft.address.postcode ?? ''}
            placeholder={rules?.postcodeExample ?? ''}
            onChange={(e) => {
              onChange('postcode', e.target.value === '' ? null : e.target.value);
            }}
          />
          <FieldError>{problems['address.postcode']}</FieldError>
        </Field>
      </fieldset>
    </div>
  );
}

function AdminsStep({
  admins,
  problem,
  onChange,
}: {
  admins: string[];
  problem: string | undefined;
  onChange: (admins: string[]) => void;
}): JSX.Element {
  const [entry, setEntry] = useState('');
  const [local, setLocal] = useState<string | null>(null);

  const add = (): void => {
    const email = entry.trim().toLowerCase();
    if (email === '') return;
    // Deliberately loose. The authority on whether an address works is whether
    // the invitation arrives; a stricter pattern here rejects real addresses.
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setLocal('That does not look like an email address.');
      return;
    }
    if (admins.includes(email)) {
      setLocal('That person is already on the list.');
      return;
    }
    onChange([...admins, email]);
    setEntry('');
    setLocal(null);
  };

  return (
    <div className="flex flex-col gap-5">
      <Field invalid={Boolean(problem ?? local)}>
        <FieldLabel htmlFor="admin-entry">Administrators</FieldLabel>
        <div className="flex gap-2">
          <Input
            id="admin-entry"
            value={entry}
            placeholder="ada@acme.example"
            onChange={(e) => {
              setEntry(e.target.value);
              setLocal(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button variant="secondary" onClick={add}>
            Add
          </Button>
        </div>
        <FieldDescription>
          Each is sent their own single-use link and enrols themselves. Nobody here is given a
          credential.
        </FieldDescription>
        <FieldError>{problem ?? local}</FieldError>
      </Field>

      {admins.length === 0 ? (
        <Alert tone="warning" title="Nobody added yet">
          A company with no administrator is one nobody can sign in to.
        </Alert>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Administrators to invite">
          {admins.map((email) => (
            <li
              key={email}
              className="border-border bg-surface flex items-center justify-between gap-3 rounded-md border p-3"
            >
              <span className="flex items-center gap-2 text-sm">
                {/* The visual feedback that this person is on the list. */}
                <span
                  aria-hidden
                  className="bg-success-solid text-fg-on-solid grid size-5 place-items-center rounded-full text-xs"
                >
                  ✓
                </span>
                {email}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onChange(admins.filter((a) => a !== email));
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      {admins.length === 1 ? (
        <Alert tone="info" title="One administrator is enough, but two is safer">
          If this person leaves before their start date, nobody can reach the account and recovery
          has no second admin to confirm it.
        </Alert>
      ) : null}
    </div>
  );
}

function ThemeStep({
  selected,
  onChange,
}: {
  selected: string;
  onChange: (id: string) => void;
}): JSX.Element {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="text-sm font-medium">Accent colour</legend>
      <p className="text-fg-muted text-sm">
        Re-points the accent on their sign-in page. Each of these carries white text at WCAG AA, so
        whichever is chosen stays legible.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {THEME_PRESETS.map((preset) => {
          const isSelected = preset.id === selected;
          return (
            <label
              key={preset.id}
              className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 transition ${
                isSelected ? 'border-accent bg-accent-subtle' : 'border-border hover:bg-surface'
              }`}
            >
              <input
                type="radio"
                name="theme"
                value={preset.id}
                checked={isSelected}
                className="sr-only"
                onChange={() => {
                  onChange(preset.id);
                }}
              />
              <span
                aria-hidden
                className="border-border size-9 shrink-0 rounded-full border"
                style={{ background: preset.accent }}
              />
              <span className="flex flex-col">
                <span className="text-sm font-medium">{preset.name}</span>
                <span className="text-fg-muted text-xs">
                  {preset.contrastOnWhite.toFixed(1)}:1 on white
                </span>
              </span>
              {isSelected ? (
                <Badge tone="success" className="ml-auto">
                  Chosen
                </Badge>
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function Created({
  result,
}: {
  result: { slug: string; invitations: { email: string; token: string }[] };
}): JSX.Element {
  return (
    <div className="mt-8 flex flex-col gap-4">
      <Alert tone="success" title={`${result.slug} created`}>
        Send each person their own link. They are shown once — the database holds only their
        hashes, so there is no way to read them back.
      </Alert>
      <ul className="flex flex-col gap-3">
        {result.invitations.map((invitation) => (
          <li key={invitation.email} className="border-border rounded-md border p-3">
            <p className="text-sm font-medium">{invitation.email}</p>
            <code className="text-fg-muted mt-1 block text-xs break-all">
              {`https://${result.slug}.app.kithena.com/enrol?token=${invitation.token}`}
            </code>
          </li>
        ))}
      </ul>
    </div>
  );
}
