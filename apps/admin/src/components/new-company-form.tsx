'use client';

import { Alert, Button } from '@reach/ui';
import { useState, type JSX } from 'react';

type Result =
  | { ok: true; slug: string; invitations: { email: string; token: string }[] }
  | { ok: false; message: string };

export function NewCompanyForm({
  action,
}: {
  action: (form: FormData) => Promise<Result>;
}): JSX.Element {
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  if (result?.ok === true) {
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

  return (
    <form
      className="mt-8 flex flex-col gap-4"
      action={(form) => {
        setBusy(true);
        void action(form)
          .then(setResult)
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      {result?.ok === false ? (
        <Alert tone="danger" title="Not created">
          {result.message}
        </Alert>
      ) : null}

      <Field name="displayName" label="Company name" placeholder="Acme Corp" required />
      <Field
        name="slug"
        label="Address"
        placeholder="acme"
        required
        hint="Becomes acme.app.kithena.com. Lower case, no spaces."
      />
      <Field
        name="accentColor"
        label="Accent colour"
        placeholder="oklch(0.55 0.18 264)"
        hint="Optional. Re-points the design system's accent on their login page."
      />

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Administrators</span>
        <textarea
          name="admins"
          rows={3}
          required
          placeholder={'ada@acme.example\ngrace@acme.example'}
          className="border-border bg-bg rounded-md border px-3 py-2 text-sm"
        />
        <span className="text-fg-muted text-xs">
          One address per line, and at least two. A company where one person holds the only link is
          locked out if they leave before their start date, and recovery needs a second admin to
          have a quorum.
        </span>
      </label>

      <Button type="submit" disabled={busy}>
        {busy ? 'Creating…' : 'Create company'}
      </Button>
    </form>
  );
}

function Field({
  name,
  label,
  placeholder,
  hint,
  required,
}: {
  name: string;
  label: string;
  placeholder: string;
  hint?: string;
  required?: boolean;
}): JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      <input
        name={name}
        placeholder={placeholder}
        required={required}
        className="border-border bg-bg rounded-md border px-3 py-2 text-sm"
      />
      {hint === undefined ? null : <span className="text-fg-muted text-xs">{hint}</span>}
    </label>
  );
}
