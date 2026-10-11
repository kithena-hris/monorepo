import * as Location from 'expo-location';

/**
 * The office area (S16): a clock-in checks where the phone is once, at that
 * moment, and Time Off is told only whether it was inside an office. The
 * coordinates stay in this file and are dropped when the check returns.
 */

export interface Office {
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly radiusMetres: number;
}

type Point = { readonly latitude: number; readonly longitude: number };

/** Metres between two points on the Earth, by the haversine formula. */
export function metresBetween(a: Point, b: Point): number {
  const rad = (deg: number): number => (deg * Math.PI) / 180;
  const h =
    Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** The office this point is inside, or `null`. */
export function officeAt(point: Point, offices: readonly Office[]): Office | null {
  return offices.find((o) => metresBetween(point, o) <= o.radiusMetres) ?? null;
}

/** Where the phone is, once: `null` when the person said no or it cannot tell. */
export async function hereOnce(): Promise<Point | null> {
  const { granted } = await Location.requestForegroundPermissionsAsync();
  if (!granted) return null;
  try {
    const { coords } = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return { latitude: coords.latitude, longitude: coords.longitude };
  } catch {
    return null;
  }
}

/** What a punch says about the office area: `null` unless the company asks at a clock-in. */
export async function insideFor(
  kind: string,
  clock: { readonly offices: readonly Office[]; readonly onlyInOfficeArea: boolean },
): Promise<boolean | null> {
  if (kind !== 'in' || !clock.onlyInOfficeArea) return null;
  const here = await hereOnce();
  return here !== null && officeAt(here, clock.offices) !== null;
}
