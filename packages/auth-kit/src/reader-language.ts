import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The reader's language, for the words a module writes for them: an Inbox
 * task's title, a refusal. The shell knows it (the phone's, the device's, the
 * account's, else the company's) and sends it on every request as
 * `x-kithena-language`; the router passes it to each subgraph. Held for the
 * request here, so a module's `t` reads it wherever it is called, without
 * every use case taking it as an argument.
 *
 * An email is not the reader's: it is written in the company's language
 * (`mailWords`), whoever pressed the button.
 */
export const LANGUAGE_HEADER = 'x-kithena-language';

const held = new AsyncLocalStorage<string>();

/** A tag like `de` or `en-GB`; anything else is no language. */
const TAG = /^[a-z]{2}(-[A-Z]{2})?$/u;

type Headers = Readonly<Record<string, string | readonly string[] | undefined>>;

/** Run one request in the language its headers name; none named, none held. */
export function inReaderLanguage<T>(headers: Headers, fn: () => T): T {
  const said = headers[LANGUAGE_HEADER];
  const language = typeof said === 'string' && TAG.test(said) ? said : undefined;
  return language === undefined ? fn() : held.run(language, fn);
}

/** The language of the request being answered; null outside one, or when none was named. */
export function readerLanguage(): string | null {
  return held.getStore() ?? null;
}
