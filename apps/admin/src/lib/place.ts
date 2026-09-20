import 'server-only';

/**
 * Where a company is, and what it is like there right now.
 *
 * Decoration with a job: an operator reading a support ticket from a customer
 * has to know whether anybody is at their desk, and "23:40, dark" answers that
 * faster than a timezone name they then have to convert. The weather is the
 * part that makes somebody actually look at the tile.
 *
 * **This sends a city name to a third party.** Open-Meteo, which needs no key,
 * sets no cookie and is asked only for `<city>, <country>` — never a street, a
 * postcode or anything about a person. That is still a customer's location
 * leaving our infrastructure, so it is switchable: set `WEATHER_ENABLED=false`
 * and every caller gets `null`, which the tile already renders.
 *
 * Every failure is `null`. A company page must not depend on a free weather
 * service being up, and a tile that quietly loses its sky is a better outcome
 * than a detail screen that 500s because somebody else's API is slow.
 */
export interface Place {
  readonly city: string;
  readonly country: string;
  /** IANA zone from the geocoder, used for the local clock. */
  readonly timeZone: string;
  readonly temperatureC: number;
  readonly isDay: boolean;
  readonly condition: Condition;
}

export type Condition = 'clear' | 'cloud' | 'fog' | 'rain' | 'snow' | 'storm';

/** Open-Meteo is free for non-commercial use and rate limited by IP. */
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';

/**
 * A city does not move, so this is cached for a month. The request is also the
 * expensive half: geocoding is a search, the forecast is a lookup.
 */
const GEOCODE_TTL = 60 * 60 * 24 * 30;

/**
 * Open-Meteo publishes on a fifteen-minute interval — its own `interval` field
 * says 900 — so asking more often returns the same numbers and spends somebody
 * else's quota.
 */
const WEATHER_TTL = 60 * 15;

/** Four seconds. A tile is not worth making the page wait longer than that. */
const TIMEOUT_MS = 4000;

export async function placeFor(
  city: string | null,
  countryCode: string | null,
): Promise<Place | null> {
  if (process.env['WEATHER_ENABLED'] === 'false') return null;
  if (city === null || city.trim() === '') return null;

  try {
    const found = await geocode(city.trim(), countryCode);
    if (found === null) return null;

    const weather = await currentWeather(found.latitude, found.longitude);
    if (weather === null) return null;

    return {
      city: found.name,
      country: found.country,
      timeZone: found.timeZone,
      ...weather,
    };
  } catch {
    // Including the abort. Nothing here is worth a log line on every render of
    // every company page.
    return null;
  }
}

async function geocode(
  city: string,
  countryCode: string | null,
): Promise<{
  name: string;
  country: string;
  timeZone: string;
  latitude: number;
  longitude: number;
} | null> {
  const url = new URL(GEOCODE);
  url.searchParams.set('name', city);
  // Ten, not one: the API matches on name alone, so "Cambridge" is Cambridge
  // Massachusetts as readily as the English one. The country filter below is
  // what picks between them, and it can only do that if it is given a choice.
  url.searchParams.set('count', '10');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');

  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    next: { revalidate: GEOCODE_TTL },
  });
  if (!response.ok) return null;

  const body = (await response.json()) as { results?: unknown };
  if (!Array.isArray(body.results) || body.results.length === 0) return null;

  const matches = body.results as {
    name?: unknown;
    country?: unknown;
    country_code?: unknown;
    timezone?: unknown;
    latitude?: unknown;
    longitude?: unknown;
  }[];

  // The one in the right country, or nothing. A guess here puts a customer's
  // pin on the wrong continent, which is worse than an empty sky.
  const wanted = countryCode?.toUpperCase();
  const match =
    wanted === undefined
      ? matches[0]
      : matches.find(
          (result) => typeof result.country_code === 'string' && result.country_code.toUpperCase() === wanted,
        );
  if (match === undefined) return null;

  const { name, country, timezone, latitude, longitude } = match;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;

  return {
    name: typeof name === 'string' ? name : city,
    country: typeof country === 'string' ? country : (wanted ?? ''),
    timeZone: typeof timezone === 'string' ? timezone : 'UTC',
    latitude,
    longitude,
  };
}

async function currentWeather(
  latitude: number,
  longitude: number,
): Promise<{ temperatureC: number; isDay: boolean; condition: Condition } | null> {
  const url = new URL(FORECAST);
  // Rounded to three decimals, about 100 metres. Enough for weather, and it
  // means two companies in the same city share one cache entry instead of
  // asking the same question twice.
  url.searchParams.set('latitude', latitude.toFixed(3));
  url.searchParams.set('longitude', longitude.toFixed(3));
  url.searchParams.set('current', 'temperature_2m,is_day,weather_code');
  url.searchParams.set('timezone', 'auto');

  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    next: { revalidate: WEATHER_TTL },
  });
  if (!response.ok) return null;

  const body = (await response.json()) as { current?: unknown };
  if (typeof body.current !== 'object' || body.current === null) return null;

  const current = body.current as Record<string, unknown>;
  const temperature = current['temperature_2m'];
  const code = current['weather_code'];
  if (typeof temperature !== 'number' || typeof code !== 'number') return null;

  return {
    temperatureC: temperature,
    // `1` is day. Anything else, including a missing field, is night — which is
    // the darker tile, and the safer thing to be wrong about.
    isDay: current['is_day'] === 1,
    condition: conditionOf(code),
  };
}

/**
 * WMO code to the six skies this tile can draw.
 *
 * The full table has twenty-eight entries and distinguishes "light drizzle"
 * from "moderate drizzle", which is a distinction no background gradient can
 * carry. Grouping is the honest resolution.
 */
function conditionOf(code: number): Condition {
  if (code >= 95) return 'storm';
  if (code >= 71 && code <= 86) return 'snow';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 1 && code <= 3) return 'cloud';
  return 'clear';
}

/** What the weather is called, for the text beside the glyph. */
export function describeCondition(condition: Condition, isDay: boolean): string {
  switch (condition) {
    case 'clear': {
      return isDay ? 'Clear' : 'Clear night';
    }
    case 'cloud': {
      return 'Cloudy';
    }
    case 'fog': {
      return 'Fog';
    }
    case 'rain': {
      return 'Rain';
    }
    case 'snow': {
      return 'Snow';
    }
    case 'storm': {
      return 'Storm';
    }
  }
}
