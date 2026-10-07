/*
 * The browser's clipboard, directly. `expo-clipboard` would do the same, but
 * its web build goes through `expo-modules-core`, whose TypeScript source the
 * Storybook bundler cannot load.
 */
type Clipboard = { writeText: (text: string) => Promise<void> };

/**
 * Puts text on the clipboard. Rejects when the browser refuses: an insecure
 * origin has no `navigator.clipboard` at all, and a denied permission rejects.
 */
export async function writeText(text: string): Promise<void> {
  const nav = (globalThis as { navigator?: { clipboard?: Clipboard } }).navigator;
  if (!nav?.clipboard) throw new Error('Clipboard API unavailable.');
  await nav.clipboard.writeText(text);
}
