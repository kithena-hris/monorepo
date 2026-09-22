import { startRegistration } from '@simplewebauthn/browser';
import {
  Alert,
  Button,
  Combobox,
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  PhoneField,
  Spinner,
  Stepper,
} from '@reach/ui';
import { useNavigate } from '@modern-js/runtime/router';

import { checkPersonName, checkPersonProfile, formatPersonName } from '@kithena/contracts';

import { useBrandRamp } from '../../lib/brand';
import { resolveTenant } from '../../lib/tenant';
import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';

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
 * **It asks for a name, a time zone and a number, and stops.** All three are
 * facts this service already holds columns for and already needs: the name is
 * what the passkey prompt renders, the zone is what every clock in the product
 * is drawn from, and the number is how an HR admin verifies somebody out of
 * band before re-issuing access — which `docs/authentication.md` calls the
 * actual differentiator.
 *
 * The zone is here because nothing else asks. Every invitation path defaults it
 * to `Etc/UTC` — `checkEmployment` does, and so does the first-administrator
 * path — so the clock on a tenant's home page read UTC for everybody. The
 * person enrolling is standing in front of the one device that knows the
 * answer, so this is where it is asked.
 *
 * A job title, a manager, a department, an emergency contact, a home address:
 * those are the People module's, and identity collecting them would give one
 * person two records that drift apart. The rule is in `CLAUDE.md` and the
 * boundary is worth more than a longer form.
 *
 * The employment start date is shown and not asked. `Account.enrol` refuses a
 * passkey before it — that is what stops a hire entered three weeks early
 * signing in during those three weeks — so a field the person enrolling could
 * edit would be a field that walks past their own check.
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
  { id: 'about', label: 'About you' },
  { id: 'review', label: 'Review' },
  { id: 'passkey', label: 'Your passkey' },
] as const;

interface Draft {
  given: string;
  family: string;
  preferred: string;
  /** IANA, and defaulted from the browser rather than left for somebody to find. */
  timeZone: string;
  /** The whole number, dial code included. Empty means none, which is allowed. */
  mobile: string;
}

export default function Enrol(): JSX.Element {
  const [state, setState] = useState<State>({ kind: 'checking' });
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>({
    given: '',
    family: '',
    preferred: '',
    // The browser's own zone, which is the best guess anybody has and usually
    // simply right: the person is enrolling from where they work. Overwritten
    // below when HR set one deliberately.
    timeZone: browserTimeZone(),
    mobile: '',
  });
  /**
   * When their employment starts, as the registry holds it.
   *
   * Shown on the review step and never editable here. `Account.enrol` refuses a
   * passkey before this date, so somebody who could change it on the way in
   * could walk past their own start-date check — and a person who cannot sign
   * in yet is far better served by being told why than by a refusal after the
   * ceremony has spent the link.
   */
  const [employmentStart, setEmploymentStart] = useState<string | null>(null);
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
  /**
   * The company's theme, so this page is the colour the button that opened it
   * was.
   *
   * The invitation email is filled with the accent an operator chose, and
   * arriving on a page in a different colour is the moment somebody wonders
   * whether the link went where it said. Present even for a company that asked
   * not to be named — an accent is one of six and identifies nobody.
   */
  const [themeId, setThemeId] = useState<string | null>(null);
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
        if (current) setThemeId(resolved.branding.themeId);
        const asked = await post('/api/identity/enrolment/status', {
          tenantId: resolved.id,
          token,
        });
        return (asked.body ?? { state: 'unknown' }) as {
          state: string;
          purpose?: string;
          name?: { given: string; family: string; preferred: string | null } | null;
          employmentStart?: string | null;
          timeZone?: string | null;
        };
      })
      .then(({ state: found, purpose, name, employmentStart: starts, timeZone: stored }) => {
        if (!current) return;

        if (typeof starts === 'string') setEmploymentStart(starts);

        /*
         * HR's zone wins over the browser's, unless HR did not choose one.
         *
         * `Etc/UTC` is what every invitation path writes when nobody types a
         * zone, so it means "not asked" far more often than it means "this
         * person works to UTC". Treating it as an answer is what put UTC on
         * every clock in the product; treating it as a blank is what this
         * form is for. Somebody who genuinely works to UTC picks it from the
         * list, and then it is on their row because they said so.
         */
        if (typeof stored === 'string' && stored !== '' && stored !== 'Etc/UTC') {
          setDraft((currentDraft) => ({ ...currentDraft, timeZone: stored }));
        }

        if (purpose === 'recovery') {
          setRecovering(true);
          setStep(2);
        }

        if (name) {
          // Prefilled, not skipped past. Review is still shown — it is where
          // somebody notices the name is wrong — and Edit goes back to a form
          // that already holds what the registry has rather than an empty one.
          // Updated rather than replaced: the zone resolved a few lines above
          // is already in this draft, and rewriting the whole object would
          // drop it back to the browser's default.
          setDraft((currentDraft) => ({
            ...currentDraft,
            given: name.given,
            family: name.family,
            preferred: name.preferred ?? '',
          }));
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
      /*
       * Written in the same transaction as the name and the credential.
       *
       * The zone in particular has to land here rather than in a settings
       * screen later: it is the value every clock in the product is drawn
       * from, and the default it replaces — `Etc/UTC` — is indistinguishable
       * from a deliberate choice once it is on the row.
       *
       * **Omitted entirely for a recovery link**, which is not a detail. A
       * recovery link goes straight to the passkey step and never shows the
       * form, so this draft holds the browser's zone and an empty number
       * rather than anything the person confirmed — sending it would move a
       * returning employee to wherever they happen to be sitting and delete
       * the number their HR team just used to verify them. Identity treats an
       * absent profile as "do not touch these columns".
       */
      ...(recovering
        ? {}
        : {
            profile: {
              timeZone: draft.timeZone,
              mobile: draft.mobile,
            },
          }),
    })) as {
      ok: boolean;
      // Neither `name_invalid` nor `profile_invalid` is a `Reason`: both are
      // form problems rather than something the person is told about their
      // link, and both are handled before the closed set is consulted.
      body: {
        accountId?: string;
        reason?: Reason | 'name_invalid' | 'profile_invalid';
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

    if (finished.body?.reason === 'name_invalid' || finished.body?.reason === 'profile_invalid') {
      // Back to the step that owns the field, rather than a dead end. The link
      // is spent by now, so this is the one refusal that cannot be retried —
      // which is exactly why the form is asked *before* the ceremony and this
      // branch should be unreachable.
      setProblem({
        field:
          finished.body.path?.[0] ??
          (finished.body.reason === 'profile_invalid' ? 'timeZone' : 'given'),
        message: finished.body.message ?? 'That could not be accepted.',
      });
      setStep(0);
      setState({ kind: 'idle' });
      return;
    }

    // `name_invalid` is already handled above, so whatever is left is one of
    // the closed set or nothing at all.
    setState({ kind: 'refused', reason: finished.body?.reason ?? 'link_invalid' });
  }, [navigate, draft, recovering]);

  /*
   * Every zone the runtime knows, plus whichever one this device reports.
   *
   * `Intl.supportedValuesOf('timeZone')` returns canonical names only, so a
   * phone in India reporting `Asia/Calcutta` would not find itself in its own
   * list — the value would be selected and the control would render a blank.
   * Prepending the detected zone is cheaper than canonicalising it, and it
   * keeps the alias the device actually reported, which is a legal zone.
   */
  const zones = useMemo(() => timeZoneOptions(draft.timeZone), [draft.timeZone]);

  useBrandRamp(themeId);

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

              {/*
                Where they work, not where the server is.

                Prefilled from this device, because the person filling the form
                in is almost always in the place the answer describes. It is
                still a question rather than a silent read: somebody enrolling
                from an airport would otherwise be given that airport's zone for
                as long as nobody noticed, and the value drives every clock and
                every calendar date in the product.
              */}
              <Field required invalid={problem?.field === 'timeZone'}>
                <FieldLabel>Where you work</FieldLabel>
                <FieldControl>
                  <Combobox
                    label="Time zone"
                    options={zones}
                    value={draft.timeZone}
                    searchPlaceholder="Search cities and zones…"
                    emptyMessage="No zone matches that."
                    onChange={(value) => {
                      setProblem(null);
                      if (typeof value === 'string') {
                        setDraft((current) => ({ ...current, timeZone: value }));
                      }
                    }}
                  />
                </FieldControl>
                {problem?.field === 'timeZone' ? (
                  <FieldError>{problem.message}</FieldError>
                ) : (
                  <FieldDescription>
                    Your time zone. Clocks and dates across Kithena are shown in it.
                  </FieldDescription>
                )}
              </Field>

              {/*
                A number, so a human can verify a human.

                This is the channel an HR admin uses before re-issuing access
                to somebody who has lost their device — the recovery story that
                makes dropping the emailed reset link possible. It is never a
                way to sign in: a code sent to a number an attacker can port is
                weaker than the passkey it would stand in for.
              */}
              <Field invalid={problem?.field === 'mobile'}>
                <FieldLabel>Mobile number</FieldLabel>
                <FieldControl>
                  <PhoneField
                    label="Mobile number"
                    value={draft.mobile}
                    autoComplete="tel"
                    onValueChange={(value) => {
                      setProblem(null);
                      setDraft((current) => ({ ...current, mobile: value }));
                    }}
                  />
                </FieldControl>
                {problem?.field === 'mobile' ? (
                  <FieldError>{problem.message}</FieldError>
                ) : (
                  <FieldDescription>
                    Optional. Used only so your HR team can check it is you if you lose your
                    device — never to sign you in.
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
                  // The same definition identity parses with, so this cannot
                  // block a value the server would take or promise one it
                  // would refuse.
                  const profile = checkPersonProfile(draft);
                  if (!profile.ok) {
                    setProblem(profile.problem);
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
                {/*
                  The zone as a place and a current time, not as an identifier.

                  `Europe/Madrid` is a string somebody has to translate before
                  it means anything; "Madrid · 18:42 right now" is the check
                  they can actually perform, and a wrong zone is obvious the
                  moment the clock disagrees with the one on their wall.
                */}
                <Detail label="Where you work">{describeZone(draft.timeZone)}</Detail>
                <Detail label="Mobile">
                  {draft.mobile.trim() === '' ? 'Not given' : draft.mobile.trim()}
                </Detail>
                {/*
                  Shown, never asked. Set by HR, and it is the date the passkey
                  step refuses before — so somebody arriving early is told why
                  here rather than after the ceremony has spent their link.
                */}
                {employmentStart === null ? null : (
                  <Detail label="Start date">{formatStartDate(employmentStart)}</Detail>
                )}
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
                    const profile = checkPersonProfile(draft);
                    if (!profile.ok) {
                      setProblem(profile.problem);
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

/**
 * The zone this device is in, or UTC when it will not say.
 *
 * `resolvedOptions()` is the only thing that knows, and it is right far more
 * often than the `Etc/UTC` every invitation path writes when HR types nothing.
 * It is a default for a field somebody confirms, not a value written behind
 * their back — the form is what turns a good guess into a fact.
 */
function browserTimeZone(): string {
  try {
    const found = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return found === '' ? 'Etc/UTC' : found;
  } catch {
    return 'Etc/UTC';
  }
}

/**
 * Every zone the runtime knows, with the detected one guaranteed present.
 *
 * `supportedValuesOf` returns canonical names only, so a device reporting
 * `Asia/Calcutta` — a legal zone and a real alias — would not find itself in
 * the list, and the control would render blank over a value that was in fact
 * selected. Prepending it is cheaper than canonicalising, and it keeps the name
 * the device gave us.
 *
 * The label is the city with its underscores removed and the region as the
 * second line. `America/Argentina/Buenos_Aires` is three segments and the last
 * is the one anybody searches for.
 */
function timeZoneOptions(
  detected: string,
): readonly { value: string; label: string; description: string }[] {
  const canonical = (() => {
    try {
      return Intl.supportedValuesOf('timeZone');
    } catch {
      // A runtime without it. The detected zone alone is a usable list: it is
      // the right answer for almost everybody, and a form with one correct
      // option beats a form with none.
      return [] as readonly string[];
    }
  })();

  const all = canonical.includes(detected) ? canonical : [detected, ...canonical];

  return all.map((zone) => {
    const parts = zone.split('/');
    const city = parts.at(-1) ?? zone;
    return {
      value: zone,
      label: city.replaceAll('_', ' '),
      description: parts.length > 1 ? `${parts[0] ?? ''} · ${zone}` : zone,
    };
  });
}

/**
 * A zone as a place and the time there, for somebody to check.
 *
 * The identifier is not the useful part on a review screen. The clock is: a
 * wrong zone is invisible as a string and obvious the moment the number
 * disagrees with the one on the wall behind them.
 */
function describeZone(zone: string): string {
  const city = (zone.split('/').at(-1) ?? zone).replaceAll('_', ' ');
  try {
    const now = new Date().toLocaleTimeString('en-GB', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
    });
    return `${city} · ${now} right now`;
  } catch {
    return city;
  }
}

/**
 * A calendar date, said in words.
 *
 * `2026-09-21` is ambiguous to half the world the moment it is reformatted with
 * slashes, and this is the date somebody checks against the one in their offer
 * letter. The month is spelled out so there is nothing to misread.
 *
 * No zone conversion: `employment_start` is a `date` and not an instant —
 * `CLAUDE.md` is explicit that hire, leave and birthday are calendar dates —
 * so parsing it into a `Date` and formatting it back would shift the day for
 * anybody west of Greenwich.
 */
function formatStartDate(date: string): string {
  const [year, month, day] = date.split('-');
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const name = months[Number(month) - 1];
  if (year === undefined || day === undefined || name === undefined) return date;
  return `${String(Number(day))} ${name} ${year}`;
}
