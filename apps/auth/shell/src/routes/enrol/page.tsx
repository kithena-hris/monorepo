import { startRegistration } from '@simplewebauthn/browser';
import {
  Alert,
  Button,
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Spinner,
  Stepper,
} from '@reach/ui';
import { useNavigate } from '@modern-js/runtime/router';

import { checkPersonName, formatPersonName } from '@kithena/contracts';

import { resolveTenant } from '../../lib/tenant';
import { useCallback, useEffect, useState, type JSX } from 'react';

/**
 * Creating a first passkey.
 *
 * A person reaches this with a link their HR team issued and a second channel
 * they satisfied in person — see `docs/authentication.md`, which explains why
 * the link alone is not enough and why SP 800-63B-4 makes that more than a
 * preference. This screen is the last step of that, not the whole of it.
 *
 * ### Why it is three steps and not one button
 *
 * It used to open straight onto "create a passkey". Two things were wrong with
 * that. The prompt the device shows is the moment somebody decides an account
 * is theirs, and all it had to show was a work address — `ada@acme.example` is
 * a poor way to ask that question. And the only thing this service ever learned
 * about a person was that address, so every screen afterwards greeted them by
 * their email.
 *
 * So: who you are, then what we already hold, then the passkey. Asking first
 * also means a refusal lands on a form somebody can correct rather than after a
 * ceremony that spends the link.
 *
 * **It asks for a name and stops.** A job title, a manager, a department, an
 * emergency contact: those are the People module's, and identity collecting
 * them would give one person two records that drift apart. The rule is in
 * `CLAUDE.md` and the boundary is worth more than a longer form.
 */
type State =
  /** Asking what the link is worth. The button is not offered yet. */
  | { readonly kind: 'checking' }
  | { readonly kind: 'idle' }
  | { readonly kind: 'working' }
  | { readonly kind: 'done' }
  /** They have a passkey already. Not a failure — a different destination. */
  | { readonly kind: 'already_enrolled' }
  | { readonly kind: 'refused'; readonly reason: Reason };

/**
 * What went wrong, in words a person can act on.
 *
 * Enrolment is allowed to say this where sign-in is not: reaching here requires
 * a 256-bit token handed over out of band, so whoever is reading already holds
 * the secret. Withholding the reason from them would turn a solvable problem
 * into a support call and protect nobody.
 */
type Reason =
  | 'link_invalid'
  | 'link_used_or_expired'
  | 'employment_not_started'
  | 'passkey_rejected'
  | 'cancelled';

const MESSAGES: Record<Reason, { title: string; body: string }> = {
  link_used_or_expired: {
    title: 'This link has already been used',
    body: 'Enrolment links work once. Ask your HR team for a new one.',
  },
  link_invalid: {
    title: 'This link is not valid',
    body: 'Check you opened the most recent link, or ask your HR team to send another.',
  },
  employment_not_started: {
    title: 'Your start date has not arrived yet',
    body: 'You can set up your passkey on your first day.',
  },
  passkey_rejected: {
    title: 'That passkey could not be accepted',
    body: 'Try again, or use a different device.',
  },
  cancelled: {
    title: 'Setup was cancelled',
    body: 'Your device did not finish creating the passkey. You can try again.',
  },
};

/**
 * Three, and the last one is the ceremony.
 *
 * `Stepper` renders them; the descriptions are what a person reads to know
 * whether they are about to be asked for something they do not have to hand.
 */
const STEPS = [
  { id: 'name', label: 'Your name' },
  { id: 'review', label: 'Review' },
  { id: 'passkey', label: 'Your passkey' },
] as const;

interface Draft {
  given: string;
  family: string;
  preferred: string;
}

export default function Enrol(): JSX.Element {
  const [state, setState] = useState<State>({ kind: 'checking' });
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>({ given: '', family: '', preferred: '' });
  /**
   * Which field is wrong and why, in the words the server would use.
   *
   * `checkPersonName` is the same Zod definition identity parses with, so this
   * cannot block a name the server would take or promise one it would refuse.
   * Set on Continue rather than on every keystroke: telling somebody their name
   * is too short while they are still typing it is a form arguing with them.
   */
  const [problem, setProblem] = useState<{ field: string; message: string } | null>(null);
  const navigate = useNavigate();

  /*
   * Which account this passkey is for.
   *
   * One device holds passkeys for many accounts — a contractor at three
   * customers, or one person testing two environments — and the system prompt
   * only shows what it was told at registration. Saying it on the page as well
   * means the choice is made before the prompt appears rather than guessed at
   * inside it, and it is the difference between "create a passkey" and "create
   * a passkey for this person at this company".
   *
   * Read once, on render, because the query string does not change under us.
   */
  const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
  const account = params.get('name');
  const slug = params.get('tenant');
  /*
   * The company's own name, once the status check has resolved it.
   *
   * The link carries the slug, which is a hostname label and not a name —
   * "Join acme" is the address talking, not the employer. `branding.displayName`
   * is null when a company has asked not to be named before sign-in, and the
   * slug is the honest fallback for exactly that case.
   */
  const [company, setCompany] = useState<string | null>(slug);
  /*
   * Whether the registry already knows what this person is called.
   *
   * This, and not the kind of link, is what decides whether the form is shown.
   * A recovery link usually belongs to somebody with a name on file and an
   * invitation usually does not — but "usually" is the wrong word to build a
   * flow on: an account enrolled before names were collected has none, and
   * asking it again is the only way it ever gets one.
   *
   * Defaults to false, the stricter reading: a status endpoint that reports no
   * name gets a form rather than a silently skipped step.
   */
  const [onFile, setOnFile] = useState(false);
  /*
   * Whether this link replaces a passkey rather than creating a first one.
   *
   * A recovery link belongs to somebody who already works here and has just
   * lost a device. Walking them through "your name" and "review" to get back in
   * is a form standing between a person and the thing they came for — and the
   * registry already knows everything on it. So recovery is one screen: a
   * greeting and the button.
   *
   * The onboarding steps stay for an invitation, where the questions are the
   * first anybody has been asked.
   */
  const [recovering, setRecovering] = useState(false);

  /*
   * What this link is worth, asked before the button appears.
   *
   * This page used to find out by trying: it ran the whole ceremony — a real
   * prompt, on a real device — and then said "this link has already been used".
   * Somebody returning to a bookmark, or opening it on a second device, is the
   * ordinary case rather than the strange one, and the useful thing to tell
   * them is that they are already set up and where to sign in.
   */
  useEffect(() => {
    // Read here rather than closing over the object built during render: a new
    // `URLSearchParams` every render would be a new dependency every render.
    const query = new URLSearchParams(window.location.search);
    const tenant = query.get('tenant') ?? '';
    const token = query.get('token') ?? '';
    if (tenant === '' || token === '') {
      setState({ kind: 'refused', reason: 'link_invalid' });
      return;
    }

    let current = true;
    void resolveTenant(tenant)
      .then(async (resolved) => {
        if (resolved === null) return { state: 'unknown' as const };
        if (current && resolved.branding.displayName !== null) {
          setCompany(resolved.branding.displayName);
        }
        const asked = await post('/api/identity/enrolment/status', {
          tenantId: resolved.id,
          token,
        });
        return (asked.body ?? { state: 'unknown' }) as {
          state: string;
          purpose?: string;
          name?: { given: string; family: string; preferred: string | null } | null;
        };
      })
      .then(({ state: found, purpose, name }) => {
        if (!current) return;

        if (purpose === 'recovery') {
          setRecovering(true);
          setStep(2);
        }

        if (name) {
          // Prefilled, not skipped past. Review is still shown — it is where
          // somebody notices the name is wrong — and Edit goes back to a form
          // that already holds what the registry has rather than an empty one.
          setDraft({
            given: name.given,
            family: name.family,
            preferred: name.preferred ?? '',
          });
          setOnFile(true);
          // Only for an invitation. A recovery link has already gone to the
          // last step above and must not be walked back into a review of
          // details nobody asked about.
          if (purpose !== 'recovery') setStep(1);
        }
        if (found === 'usable') setState({ kind: 'idle' });
        else if (found === 'already_enrolled') setState({ kind: 'already_enrolled' });
        else if (found === 'spent') setState({ kind: 'refused', reason: 'link_used_or_expired' });
        else if (found === 'expired') setState({ kind: 'refused', reason: 'link_used_or_expired' });
        else setState({ kind: 'refused', reason: 'link_invalid' });
      })
      .catch(() => {
        // Unreachable identity is not a spent link, and saying so would send
        // somebody to ask HR for a replacement they do not need.
        if (current) setState({ kind: 'refused', reason: 'link_invalid' });
      });

    return () => {
      current = false;
    };
  }, []);

  const enrol = useCallback(async () => {
    setState({ kind: 'working' });
    const tenant = await resolveTenant(params.get('tenant') ?? '');
    if (tenant === null) {
      setState({ kind: 'refused', reason: 'link_invalid' });
      return;
    }

    /*
     * The name they just typed, not the address the link carried.
     *
     * This is the string the device prints in its prompt, and the prompt is
     * where somebody decides whether the account being created is theirs. One
     * device holds passkeys for several accounts — a contractor at three
     * customers — and "Ada Lovelace at Acme" answers that where
     * `ada@acme.example` makes them guess.
     */
    const named = checkPersonName(draft);
    const begun = (await post('/api/identity/webauthn/register/begin', {
      identityId: params.get('identity'),
      // The same formatting the service uses, from the same module, so the
      // prompt and the greeting afterwards cannot disagree about what somebody
      // is called.
      displayName: named.ok
        ? formatPersonName(named.value)
        : (params.get('name') ?? 'Kithena'),
    })) as { body: { options?: unknown } | null };

    if (!begun.body?.options) {
      setState({ kind: 'refused', reason: 'link_invalid' });
      return;
    }

    let attestation;
    try {
      attestation = await startRegistration({ optionsJSON: begun.body.options as never });
    } catch {
      // The device said no, or the person did. Distinct from anything the
      // server decided, and the only message that should suggest trying again
      // with the same link — because the link has not been spent yet.
      setState({ kind: 'refused', reason: 'cancelled' });
      return;
    }

    const finished = (await post('/api/identity/webauthn/register/finish', {
      tenantId: tenant.id,
      token: params.get('token'),
      origin: window.location.origin,
      response: attestation,
      /*
       * Written in the same transaction as the credential, so an account is
       * never usable and nameless. Identity re-checks it — `checkName` is the
       * rule and this form is a convenience, not the enforcement.
       */
      name: {
        given: draft.given,
        family: draft.family,
        preferred: draft.preferred,
      },
    })) as {
      ok: boolean;
      // `name_invalid` is not a `Reason`: it is a form problem rather than
      // something the person is told about their link, and it is handled
      // before the closed set is consulted.
      body: {
        accountId?: string;
        reason?: Reason | 'name_invalid';
        path?: string[];
        message?: string;
      } | null;
    };

    if (finished.ok && finished.body?.accountId !== undefined) {
      setState({ kind: 'done' });
      // Straight on to signing in. Leaving someone on a success screen with a
      // spent link is how they press the button again and are told, correctly
      // and uselessly, that their link has been used.
      window.setTimeout(
        () => void navigate(`/login?tenant=${encodeURIComponent(tenant.slug)}`),
        900,
      );
      return;
    }

    if (finished.body?.reason === 'name_invalid') {
      // Back to the step that owns the field, rather than a dead end. The link
      // is spent by now, so this is the one refusal that cannot be retried —
      // which is exactly why the form is asked *before* the ceremony and this
      // branch should be unreachable.
      setProblem({
        field: finished.body.path?.[0] ?? 'given',
        message: finished.body.message ?? 'That name could not be accepted.',
      });
      setStep(0);
      setState({ kind: 'idle' });
      return;
    }

    // `name_invalid` is already handled above, so whatever is left is one of
    // the closed set or nothing at all.
    setState({ kind: 'refused', reason: finished.body?.reason ?? 'link_invalid' });
  }, [navigate, draft]);

  const onboarding = state.kind !== 'already_enrolled';

  /*
   * What to call them, which is the preferred name where there is one.
   *
   * Null when the registry holds no name — an account enrolled before names
   * were collected — and the heading falls back to the plain instruction rather
   * than greeting somebody by an empty string.
   */
  const greeting =
    draft.preferred.trim() !== ''
      ? draft.preferred.trim()
      : draft.given.trim() !== ''
        ? draft.given.trim()
        : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-6 px-6 py-10">
      <div>
        {/*
          Two headings, because two different people are reading this.

          Somebody joining is being invited somewhere new. Somebody recovering
          already works here and has lost a device — greeting them with "Join
          Acme Corp" reads as a mistake, and their own name is what tells them
          the link is theirs.
        */}
        <h1 className="text-xl font-semibold">
          {recovering
            ? greeting === null
              ? 'Set up a new passkey'
              : `Hi ${greeting}`
            : company === null
              ? 'Set up your account'
              : `Join ${company}`}
        </h1>
        {account === null ? null : (
          <p className="text-fg-muted mt-1 text-sm">
            {recovering ? 'Signing in as' : 'Invited as'}{' '}
            <strong className="text-fg font-medium">{account}</strong>
          </p>
        )}
      </div>

      {state.kind === 'checking' ? <Spinner label="Checking your link" /> : null}

      {/*
        The map, above whichever step is open. Finished steps are clickable and
        steps ahead are not: jumping forward would skip the validation the steps
        between exist to do, which is `Stepper`'s own rule rather than one
        invented here.
      */}
      {onboarding && !recovering && state.kind !== 'checking' && state.kind !== 'refused' ? (
        <Stepper
          label="Setting up your account"
          /*
            Labels only. The descriptions truncated to `Your …` at this width,
            which is worse than not showing them — and each step's own copy says
            the same thing in full a few pixels below.
          */
          steps={STEPS.map((entry) => ({ id: entry.id, label: entry.label }))}
          current={step}
          size="sm"
          onStepChange={(index) => {
            if (index < step) setStep(index);
          }}
        />
      ) : null}

      {state.kind === 'refused' ? (
        <Alert tone="danger" title={MESSAGES[state.reason].title}>
          {MESSAGES[state.reason].body}
        </Alert>
      ) : null}

      {state.kind === 'done' ? (
        <Alert tone="success" title="You are all set">
          Taking you to sign in…
        </Alert>
      ) : null}

      {/*
        Only ever reached from a link that cannot be used: an original signup
        link opened again, or a recovery link already spent. A live recovery
        link never lands here — it goes straight to the passkey step, which is
        the whole point of `purpose` on the token.
      */}
      {state.kind === 'already_enrolled' ? (
        <>
          <Alert tone="info" title="You already have a passkey">
            This link has done its job. Sign in with the passkey on the device you set up — or set
            up a new one if that device is gone.
          </Alert>
          <div className="flex flex-col gap-2">
            <Button variant="primary" onClick={() => void navigate('/login')}>
              Go to sign in
            </Button>
            {/*
              Lost the device rather than forgotten the page. Asks for a fresh
              link by email rather than for the passkey they no longer have —
              which is what the previous version of this button did, correct as
              a gate and useless in the only case it was for.

              The label is the heading of the page it opens, and the same words
              the sign-in page uses. It said "I no longer have that passkey"
              while sign-in said "I no longer have my passkey" and the login
              screen offered "Ask for a new setup link" — three phrasings for
              one destination, which is how an interface stops being learnable.
            */}
            {/*
              With the company, which this button used to drop.

              `/recover` reads the tenant from its own query string — it is on
              the shared auth origin and has no hostname to read one from — so
              arriving without it meant `resolveTenant('')`, a null, and the
              generic "that could not be sent". Every route into recovery
              dead-ended, which is the whole of why it never worked.
            */}
            <Button
              variant="secondary"
              onClick={() =>
                void navigate(slug === null ? '/recover' : `/recover?tenant=${encodeURIComponent(slug)}`)
              }
            >
              Set up a new passkey
            </Button>
          </div>
        </>
      ) : null}

      {onboarding && state.kind !== 'checking' && state.kind !== 'done' ? (
        <>
          {step === 0 ? (
            <div className="flex flex-col gap-4">
              <p className="text-fg-muted text-sm">
                Your legal name is what appears on payroll and on anything official. If you go by
                something else, tell us that too — it is what colleagues will see.
              </p>

              <Field required invalid={problem?.field === 'given'}>
                <FieldLabel>Legal first name</FieldLabel>
                <FieldControl>
                  <Input
                    value={draft.given}
                    autoComplete="given-name"
                    onChange={(event) => {
                      setProblem(null);
                      setDraft((current) => ({ ...current, given: event.target.value }));
                    }}
                  />
                </FieldControl>
                {problem?.field === 'given' ? <FieldError>{problem.message}</FieldError> : null}
              </Field>

              <Field required invalid={problem?.field === 'family'}>
                <FieldLabel>Legal last name</FieldLabel>
                <FieldControl>
                  <Input
                    value={draft.family}
                    autoComplete="family-name"
                    onChange={(event) => {
                      setProblem(null);
                      setDraft((current) => ({ ...current, family: event.target.value }));
                    }}
                  />
                </FieldControl>
                {problem?.field === 'family' ? <FieldError>{problem.message}</FieldError> : null}
              </Field>

              <Field invalid={problem?.field === 'preferred'}>
                <FieldLabel>Preferred name</FieldLabel>
                <FieldControl>
                  <Input
                    value={draft.preferred}
                    autoComplete="nickname"
                    placeholder={draft.given.trim() === '' ? undefined : draft.given.trim()}
                    onChange={(event) => {
                      setProblem(null);
                      setDraft((current) => ({ ...current, preferred: event.target.value }));
                    }}
                  />
                </FieldControl>
                {problem?.field === 'preferred' ? (
                  <FieldError>{problem.message}</FieldError>
                ) : (
                  <FieldDescription>
                    Optional. Leave it empty if your first name is what you go by.
                  </FieldDescription>
                )}
              </Field>

              <Button
                variant="primary"
                onClick={() => {
                  const checked = checkPersonName(draft);
                  if (!checked.ok) {
                    setProblem(checked.problem);
                    return;
                  }
                  setProblem(null);
                  setStep(1);
                }}
              >
                Continue
              </Button>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="flex flex-col gap-4">
              <p className="text-fg-muted text-sm">
                {onFile
                  ? 'This is what we hold for you. Check it before you set up your passkey.'
                  : 'Check this before you carry on. You can change it now; afterwards it is your HR team who can.'}
              </p>

              {/*
                The tidied name, not the raw draft.

                `Augusta   Ada` is stored as `Augusta Ada` — whitespace is
                collapsed by the same rule the service applies — so rendering
                the draft here showed one thing and saved another. A review step
                that does that is worse than none, because it is the screen
                somebody trusts.
              */}
              <dl className="border-border divide-border divide-y rounded-md border text-sm">
                <Detail label="Legal name">{asStored(draft).legal}</Detail>
                <Detail label="Goes by">{asStored(draft).goesBy}</Detail>
                <Detail label="Work email">{account ?? 'Not given'}</Detail>
                <Detail label="Company">{company ?? 'Not given'}</Detail>
              </dl>

              <div className="flex gap-2">
                {/*
                  Edit rather than Back, because this is the first screen for
                  anybody whose name was already on file — "back" would name a
                  step they have never seen.
                */}
                <Button
                  variant="secondary"
                  onClick={() => {
                    setProblem(null);
                    setStep(0);
                  }}
                >
                  Edit
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={() => {
                    // Re-checked on the way out of review as well as into it:
                    // a name loaded from the registry has never been through
                    // this form, and a row written before a rule tightened is
                    // exactly the one that would surprise somebody at the
                    // ceremony, when the link is already spent.
                    const checked = checkPersonName(draft);
                    if (!checked.ok) {
                      setProblem(checked.problem);
                      setStep(0);
                      return;
                    }
                    setStep(2);
                  }}
                >
                  That is right
                </Button>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="flex flex-col gap-4">
              <p className="text-fg-muted text-sm">
                {recovering
                  ? 'Your device will ask for your fingerprint, face or PIN. Nothing leaves it. The passkey you lost stays where it is — this one is for the device you are on now.'
                  : 'Your device will ask for your fingerprint, face or PIN. Nothing leaves it. The passkey is saved under your name and your company, so you can tell it apart from any others on this device.'}
              </p>

              <div className="flex gap-2">
                {/* Nothing to go back to when the form was never shown. */}
                {recovering ? null : (
                  <Button
                    variant="secondary"
                    disabled={state.kind === 'working'}
                    onClick={() => {
                      setStep(1);
                    }}
                  >
                    Back
                  </Button>
                )}
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={() => void enrol()}
                  disabled={state.kind === 'working'}
                >
                  {state.kind === 'working'
                    ? 'Waiting for your device…'
                    : recovering
                      ? 'Set up a new passkey'
                      : 'Create a passkey'}
                </Button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </main>
  );
}

/** One row of the summary. A `dl`, because these are labels and their values. */
function Detail({ label, children }: { label: string; children: JSX.Element | string }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-4 px-3 py-2.5">
      <dt className="text-fg-muted shrink-0">{label}</dt>
      <dd className="min-w-0 truncate text-end font-medium">{children}</dd>
    </div>
  );
}

/**
 * Through this origin's proxy, which adds the credential identity requires.
 *
 * The status is returned alongside the body rather than thrown on, because a
 * 401 here carries a reason worth reading — unlike on sign-in, where it
 * deliberately carries nothing.
 */
async function post(path: string, body: unknown): Promise<{ ok: boolean; body: unknown }> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { ok: response.ok, body: text === '' ? null : JSON.parse(text) };
}

/**
 * The name as it will actually be stored, for the review step to show.
 *
 * Runs the draft through the same rule the service does, so what somebody
 * confirms is what ends up on their row: whitespace collapsed, and a preferred
 * name that merely repeats the given one folded away. Falls back to the raw
 * draft only when the name does not pass, which is a state the review step is
 * never reached in.
 */
function asStored(draft: Draft): { legal: string; goesBy: string } {
  const checked = checkPersonName(draft);
  if (!checked.ok) {
    return {
      legal: `${draft.given.trim()} ${draft.family.trim()}`,
      goesBy: draft.preferred.trim() === '' ? draft.given.trim() : draft.preferred.trim(),
    };
  }

  const { given, family, preferred } = checked.value;
  return { legal: `${given} ${family}`, goesBy: preferred ?? given };
}
