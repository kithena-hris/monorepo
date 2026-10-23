import { CATALOGUE } from '../locales';
import type { Language, Messages, Namespace } from './languages';

/**
 * A language's words for these namespaces, as the server and the browser both
 * load them: each namespace a file of its own, only when a page needs it. A
 * namespace not translated yet is simply absent, and its English shows.
 */
export async function loadMessages(
  language: Language,
  namespaces: readonly Namespace[],
): Promise<Messages> {
  const loaders = CATALOGUE[language] ?? {};
  const loaded = await Promise.all(
    namespaces.map(async (ns) => {
      const load = loaders[ns];
      return [ns, load === undefined ? {} : (await load()).default] as const;
    }),
  );
  return Object.fromEntries(loaded);
}
