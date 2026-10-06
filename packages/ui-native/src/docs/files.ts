import type { PickedFile } from '../components/dropzone/files.ts';

/*
 * Stand-ins for what an app's picker returns, for stories: Reach opens no
 * picker itself. The photos are flat SVGs in the chart hues, drawn as the
 * design draws an image it does not have.
 */

const hues = [264, 160, 70, 25, 300, 200];

/** A placeholder photo: a soft field and a hill, in one of the chart hues. */
export function samplePhoto(index: number): string {
  const hue = hues[index % hues.length] ?? 264;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="hsl(${String(hue)} 45% 72%)"/><circle cx="86" cy="34" r="12" fill="hsl(${String(hue)} 60% 88%)"/><path d="M0 92 L38 58 L66 82 L86 66 L120 96 V120 H0Z" fill="hsl(${String(hue)} 40% 52%)"/></svg>`;
  // Base64: react-native-web draws an image from a base64 data URI, not a percent-encoded one.
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

export function sampleImage(name: string, index: number, width = 2400, height = 1600): PickedFile {
  return { uri: samplePhoto(index), name, size: 1_400_000, type: 'image/jpeg', width, height };
}

export function sampleDocument(name: string, type: string, size: number): PickedFile {
  return { uri: `file:///samples/${name}`, name, size, type };
}

/** A `pick` that resolves to these, as an app's picker would after a choice. */
export function pickOf(...files: readonly PickedFile[]): () => Promise<readonly PickedFile[]> {
  return () => Promise.resolve(files);
}
