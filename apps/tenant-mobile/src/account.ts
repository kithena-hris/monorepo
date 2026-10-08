import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';

/**
 * Signing in, keeping the session and signing out, against the company's own
 * hostname — the same server the web app is, through `/api/mobile/*`.
 *
 * The passkey ceremony is the web's, on the web's origin: the app opens the
 * company's sign-in page in the system's authentication sheet and gets back a
 * code sealed to a challenge only it can answer (`apps/web/src/lib/app-sign-in.ts`
 * has the reasoning). So the relying party never changes and no app needs
 * associating with the domain, which is also what lets Expo Go sign in.
 */
export interface Company {
  readonly origin: string;
  readonly slug: string;
  readonly displayName: string | null;
  readonly logoUrl: string | null;
}

export interface Person {
  readonly workEmail: string | null;
  readonly name: { given: string; family: string; preferred: string | null } | null;
  readonly expiresAt: string | null;
  /** An administrator viewing the app as this person, read-only: who they are. */
  readonly viewing: { readonly adminAccountId: string; readonly adminName: string | null } | null;
}

/** The device's keychain: the session id is a credential. */
const ORIGIN = 'kithena.origin';
const SESSION = 'kithena.session';
/** While viewing as somebody: the administrator's own session, put aside. */
const OWN = 'kithena.own';
/** The address last signed in with, offered again rather than retyped. */
const EMAIL = 'kithena.email';

export async function lastEmail(): Promise<string> {
  return (await SecureStore.getItemAsync(EMAIL)) ?? '';
}

export async function restore(): Promise<{ origin: string | null; sessionId: string | null }> {
  const [origin, sessionId] = await Promise.all([
    SecureStore.getItemAsync(ORIGIN),
    SecureStore.getItemAsync(SESSION),
  ]);
  return { origin, sessionId };
}

/** Forgets a session identity no longer recognises: the company and the address stay. */
export async function forgetSession(): Promise<void> {
  // A view that lapsed hands the administrator their own session back.
  const own = await SecureStore.getItemAsync(OWN);
  if (own !== null) {
    await SecureStore.setItemAsync(SESSION, own);
    await SecureStore.deleteItemAsync(OWN);
    return;
  }
  await SecureStore.deleteItemAsync(SESSION);
}

/**
 * Viewing the app as somebody, read-only, for thirty minutes, saying why
 * (`/api/mobile/view-as`). The administrator's own session is kept aside in
 * the keychain and comes back when the view ends.
 */
export async function startViewing(
  origin: string,
  sessionId: string,
  personId: string,
  reason: string,
): Promise<{ ok: true; sessionId: string; person: Person } | { ok: false; message: string }> {
  const response = await fetch(`${origin}/api/mobile/view-as`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${sessionId}` },
    body: JSON.stringify({ personId, reason }),
  }).catch(() => null);
  const body = (await response?.json().catch(() => null)) as {
    ok?: boolean;
    message?: string;
    sessionId?: string;
    person?: Person;
  } | null;
  if (body?.ok !== true || body.sessionId === undefined || body.person === undefined) {
    return { ok: false, message: body?.message ?? 'Kithena could not be reached. Try again.' };
  }
  await SecureStore.setItemAsync(OWN, sessionId);
  await SecureStore.setItemAsync(SESSION, body.sessionId);
  return { ok: true, sessionId: body.sessionId, person: body.person };
}

/** Ends the view (identity records it) and puts the administrator's own session back: its id, or null. */
export async function endViewing(origin: string, viewSessionId: string): Promise<string | null> {
  await fetch(`${origin}/api/mobile/view-as`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${viewSessionId}` },
  }).catch(() => null);
  const own = await SecureStore.getItemAsync(OWN);
  await SecureStore.deleteItemAsync(OWN);
  if (own === null) {
    await SecureStore.deleteItemAsync(SESSION);
    return null;
  }
  await SecureStore.setItemAsync(SESSION, own);
  return own;
}

/** Forgets the company too, so the address is asked for again. */
export async function forgetCompany(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ORIGIN),
    SecureStore.deleteItemAsync(SESSION),
    SecureStore.deleteItemAsync(EMAIL),
    SecureStore.deleteItemAsync(OWN),
  ]);
}

/** The company at an address, null when there is none, `unreachable` when nothing answered. */
export async function companyAt(origin: string): Promise<Company | null | 'unreachable'> {
  const response = await fetch(`${origin}/api/mobile/tenant`).catch(() => null);
  if (response === null) return 'unreachable';
  if (!response.ok) return response.status === 404 ? null : 'unreachable';

  const body = (await response.json()) as Omit<Company, 'origin'>;
  await SecureStore.setItemAsync(ORIGIN, origin);
  return {
    origin,
    slug: body.slug,
    displayName: body.displayName,
    // An uploaded logo may be a path on the company's own host.
    logoUrl: body.logoUrl?.startsWith('/') === true ? `${origin}${body.logoUrl}` : body.logoUrl,
  };
}

/** `base64` as `base64url`, unpadded: what RFC 7636 and the server expect. */
const urlSafe = (base64: string): string =>
  base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export type SignInOutcome =
  | { readonly kind: 'signed-in'; readonly sessionId: string; readonly person: Person }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'refused' };

/**
 * Signing in as `workEmail` at `origin`. The address goes in the fragment of
 * the sign-in page's URL, which the page reads and no server or log ever sees;
 * the page then starts the passkey prompt as the sheet opens.
 */
export async function signIn(origin: string, workEmail: string): Promise<SignInOutcome> {
  // PKCE (S256): the verifier never leaves this function except to the server
  // that sealed the code, over TLS, after the sheet has closed.
  // Two random UUIDs without their dashes: 64 characters, 244 random bits,
  // inside RFC 7636's alphabet and length.
  const verifier = `${Crypto.randomUUID()}${Crypto.randomUUID()}`.replace(/-/g, '');
  const challenge = urlSafe(
    await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
      encoding: Crypto.CryptoEncoding.BASE64,
    }),
  );
  // `kithena://signed-in` in a build of this app; Expo Go's own address while
  // it is developed there. The server accepts exactly those two schemes.
  const redirect = Linking.createURL('signed-in');

  const sheet = await WebBrowser.openAuthSessionAsync(
    `${origin}/login?app=${encodeURIComponent(redirect)}&challenge=${challenge}#email=${encodeURIComponent(workEmail)}`,
    redirect,
    // Nothing of the sheet's is kept: the session is the app's, not Safari's.
    { preferEphemeralSession: true },
  );
  if (sheet.type !== 'success') return { kind: 'cancelled' };

  const code = Linking.parse(sheet.url).queryParams?.['code'];
  if (typeof code !== 'string') return { kind: 'refused' };

  const response = await fetch(`${origin}/api/mobile/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, verifier }),
  }).catch(() => null);
  if (response?.ok !== true) return { kind: 'refused' };

  const { sessionId, person } = (await response.json()) as { sessionId: string; person: Person };
  await Promise.all([
    SecureStore.setItemAsync(SESSION, sessionId),
    SecureStore.setItemAsync(EMAIL, workEmail),
  ]);
  return { kind: 'signed-in', sessionId, person };
}

/** Who the stored session is, `signed-out` once it no longer is anybody, `unreachable` offline. */
export async function whoAmI(
  origin: string,
  sessionId: string,
): Promise<Person | 'signed-out' | 'unreachable'> {
  const response = await fetch(`${origin}/api/mobile/session`, {
    headers: { authorization: `Bearer ${sessionId}` },
  }).catch(() => null);
  if (response === null) return 'unreachable';
  if (response.status === 401) {
    await SecureStore.deleteItemAsync(SESSION);
    return 'signed-out';
  }
  return response.ok ? ((await response.json()) as Person) : 'unreachable';
}

/**
 * Ends the session in identity, then forgets it here whatever identity said:
 * whoever asked to sign out is signed out on this phone.
 */
export async function signOut(origin: string, sessionId: string): Promise<void> {
  // Signing out while viewing as somebody ends the view and signs the administrator out too.
  const own = await SecureStore.getItemAsync(OWN);
  for (const id of [sessionId, own]) {
    if (id === null) continue;
    await fetch(`${origin}/api/mobile/session`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${id}` },
    }).catch(() => null);
  }
  await Promise.all([SecureStore.deleteItemAsync(SESSION), SecureStore.deleteItemAsync(OWN)]);
}

/** The web's recovery page, in an in-app browser: a fresh setup link by email. */
export async function openRecovery(origin: string): Promise<void> {
  await WebBrowser.openBrowserAsync(`${origin}/recover`);
}
