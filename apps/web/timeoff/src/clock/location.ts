/**
 * The one location check (MT3, PRD §11.2, §16): asked of the browser once,
 * at the moment of clocking in, and turned into "Office" or nothing on this
 * device. The coordinates never leave this file: nothing is stored, nothing
 * is sent, and the punch carries the work model it suggested, which the
 * person can change. Time Off refuses a punch that carries a latitude.
 */

/** A place a company works from, and how near counts as being there. */
export interface Office {
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  /** How far from the point still counts as the office, in metres. */
  readonly radiusMetres: number;
}

/** Metres between two points on the Earth, by the haversine formula. */
export function metresBetween(
  a: { readonly latitude: number; readonly longitude: number },
  b: { readonly latitude: number; readonly longitude: number },
): number {
  const rad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** The office this point is inside, or `null`. */
export function officeAt(
  point: { readonly latitude: number; readonly longitude: number },
  offices: readonly Office[],
): Office | null {
  return offices.find((o) => metresBetween(point, o) <= o.radiusMetres) ?? null;
}

/**
 * Where the browser says this device is, once, as the office it is inside:
 * `null` when it is in none, the person said no, or the browser cannot tell
 * within a few seconds. Never asks when there is no office to compare with.
 */
export function checkOnce(
  offices: readonly Office[],
  geolocation: Geolocation | undefined = globalThis.navigator?.geolocation,
): Promise<Office | null> {
  if (offices.length === 0 || geolocation === undefined) return Promise.resolve(null);
  return new Promise((resolve) => {
    geolocation.getCurrentPosition(
      (position) => {
        resolve(officeAt(position.coords, offices));
      },
      () => {
        resolve(null);
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 5000 },
    );
  });
}
