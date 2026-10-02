import { describe, expect, it } from 'vitest';

import { countryOfZone, placeIn, zoneOfCountry } from './place-hints.js';

describe('where a work location is, from what the file says of it', () => {
  it('reads a city in the name or the address', () => {
    expect(placeIn('Chicago HQ')).toEqual({
      country: 'US',
      timeZone: 'America/Chicago',
      city: 'Chicago',
    });
    expect(placeIn('Hamburg Port Office')).toMatchObject({
      country: 'DE',
      timeZone: 'Europe/Berlin',
    });
    expect(placeIn('Embassy TechVillage, Outer Ring Road, Bengaluru 560103')).toMatchObject({
      country: 'IN',
      timeZone: 'Asia/Kolkata',
    });
    expect(placeIn('NEW YORK OFFICE')).toMatchObject({ country: 'US', city: 'New York' });
  });

  it('reads a state or a province before its postcode', () => {
    expect(placeIn('2400 Aviation Dr, DFW Airport, TX 75261')).toEqual({
      country: 'US',
      timeZone: 'America/Chicago',
      city: null,
    });
    expect(placeIn('1 Main St, Somewhere, ON M5X 1A9')).toMatchObject({
      country: 'CA',
      timeZone: 'America/Toronto',
    });
  });

  it('reads a country it names, with its usual zone', () => {
    expect(placeIn('Industriestraße 4, Deutschland')).toMatchObject({
      country: 'DE',
      timeZone: 'Europe/Berlin',
    });
  });

  it('guesses nothing from a name that says nothing', () => {
    expect(placeIn('Warehouse 7')).toEqual({ country: null, timeZone: null, city: null });
  });

  it('knows each zone’s country, and each country’s usual zone', () => {
    expect(countryOfZone('America/New_York')).toBe('US');
    expect(countryOfZone('America/Toronto')).toBe('CA');
    expect(countryOfZone('Asia/Kolkata')).toBe('IN');
    expect(countryOfZone('Mars/Olympus')).toBeNull();
    expect(zoneOfCountry('ES')).toBe('Europe/Madrid');
  });
});
