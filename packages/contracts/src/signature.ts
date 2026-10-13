import * as z from 'zod';

import { asIdentity, asPublic, policy } from './classification.js';

/**
 * A signature, defined once (`CLAUDE.md`: Zod is the single schema source):
 * typed in one of three handwriting faces, or drawn. Documents stamps it on a
 * signed PDF and People keeps a person's own as a field of type `signature`,
 * so both read and refuse it the same way.
 *
 * The faces are OFL fonts shipped twice, as TTF in `services/documents/assets/
 * fonts` (embedded in the sealed PDF) and as WOFF2 in Reach (drawn on screen):
 * Great Vibes, Sacramento and Mr Dafoe.
 */

export const SIGNATURE_STYLES = ['flowing', 'light', 'bold'] as const;
export const SignatureStyle = z.enum(SIGNATURE_STYLES).register(policy, asPublic());
export type SignatureStyle = z.infer<typeof SignatureStyle>;

/** Reach's `SignaturePad`: straight strokes in a 400 × 120 box, y down. */
export const SIGNATURE_PATH = /^[ML][\d.\sML-]*$/u;
export const SIGNATURE_BOX = { width: 400, height: 120 } as const;

export const SignatureMark = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('typed').register(policy, asPublic()),
    text: z.string().trim().min(1).max(120).register(policy, asIdentity()),
    style: SignatureStyle.default('flowing'),
  }),
  z.object({
    kind: z.literal('drawn').register(policy, asPublic()),
    path: z.string().trim().max(40_000).regex(SIGNATURE_PATH).register(policy, asIdentity()),
  }),
]);
export type SignatureMark = z.infer<typeof SignatureMark>;

/**
 * Where a drawn path's ink sits in its 400 × 120 box, so it can be centred in
 * a box of any shape; null for a path with no points.
 */
export function inkBounds(
  path: string,
): { x: number; y: number; width: number; height: number } | null {
  const numbers = path.match(/-?\d+(\.\d+)?/gu)?.map(Number) ?? [];
  if (numbers.length < 2) return null;
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    const [x = 0, y = 0] = [numbers[i], numbers[i + 1]];
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
