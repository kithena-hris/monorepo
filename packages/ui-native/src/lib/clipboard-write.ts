import { setStringAsync } from 'expo-clipboard';

/** Puts text on the device's clipboard. Rejects when the platform refuses. */
export async function writeText(text: string): Promise<void> {
  if (!(await setStringAsync(text))) throw new Error('The clipboard refused the write.');
}
