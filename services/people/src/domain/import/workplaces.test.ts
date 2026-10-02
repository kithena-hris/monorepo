import { describe, expect, it } from 'vitest';

import { closestPlace, placeChoiceRef, placeKey, workplacesIn } from './workplaces.js';

/**
 * The work locations a file names, as HR decides them inside the import: map
 * each to one here, add it as a new one, or leave it empty for HR (the user:
 * "Set up workplaces inline").
 */
const HERE = [
  { id: 'l-ny', name: 'New York', country: 'US' },
  { id: 'l-scr', name: 'Scranton', country: 'US' },
  { id: 'l-old', name: 'Nashua', country: 'US', archived: true },
];
const ENTITIES = [
  { id: 'e-1', name: 'Dunder Mifflin', country: 'US', timeZone: 'America/New_York' },
];

const seen = (value: string, row: number, name: string | null = null) => ({ value, row, name });

describe('the work locations in a file', () => {
  it('lists each value once, with how many rows and who, in the file’s first spelling', () => {
    const [ny] = workplacesIn(
      [
        seen('New York', 2, 'Pam Beesly'),
        seen(' new  york ', 3, 'Jim Halpert'),
        seen('New York', 4),
      ],
      HERE,
      ENTITIES,
    );
    expect(ny).toMatchObject({
      key: 'new york',
      value: 'New York',
      rows: 3,
      people: ['Pam Beesly', 'Jim Halpert'],
      found: { id: 'l-ny', name: 'New York' },
      suggestion: null,
      proposed: { kind: 'map', locationId: 'l-ny' },
    });
  });

  it('finds one by its id here too', () => {
    const [byId] = workplacesIn([seen('l-scr', 2)], HERE, ENTITIES);
    expect(byId?.found).toEqual({ id: 'l-scr', name: 'Scranton' });
  });

  it('suggests a close name, and proposes it', () => {
    const [branch] = workplacesIn([seen('Scranton Branch', 2)], HERE, ENTITIES);
    expect(branch?.found).toBeNull();
    expect(branch?.suggestion).toEqual({ id: 'l-scr', name: 'Scranton' });
    expect(branch?.proposed).toEqual({ kind: 'map', locationId: 'l-scr' });
  });

  it('proposes a new one by the file’s name, its country and zone prefilled', () => {
    const [stamford] = workplacesIn([seen('Stamford', 2)], HERE, ENTITIES);
    expect(stamford?.proposed).toEqual({
      kind: 'add',
      name: 'Stamford',
      country: 'US',
      timeZone: 'America/New_York',
      legalEntityId: 'e-1',
    });
  });

  it('leaves another system’s id empty: there is no name to add it by', () => {
    const [id] = workplacesIn([seen('01a0e1d1-f26f-7000-be34-a7236a53ad47', 2)], HERE, ENTITIES);
    expect(id?.looksLikeId).toBe(true);
    expect(id?.proposed).toEqual({ kind: 'leave' });
  });

  it('never matches or suggests an archived one', () => {
    const [nashua] = workplacesIn([seen('Nashua', 2)], HERE, ENTITIES);
    expect(nashua?.found).toBeNull();
    expect(nashua?.suggestion).toBeNull();
    expect(nashua?.proposed.kind).toBe('add');
  });

  it('with nowhere to add one, proposes leaving it', () => {
    const [stamford] = workplacesIn([seen('Stamford', 2)], HERE, []);
    expect(stamford?.proposed).toEqual({ kind: 'leave' });
  });

  it('names at most twenty people for a value', () => {
    const many = Array.from({ length: 30 }, (_, i) => seen('Stamford', i + 2, `P${String(i)}`));
    expect(workplacesIn(many, HERE, ENTITIES)[0]?.people).toHaveLength(20);
  });
});

describe('a new work location, filled in from the file', () => {
  // Meridian Freight's eight offices, as its export writes each row: the
  // office's time zone, its address and the legal entity, never a home.
  const MERIDIAN = [
    [
      'Chicago HQ',
      '233 S Wacker Dr, Chicago, IL 60606',
      'America/Chicago',
      'Meridian Freight Inc.',
    ],
    [
      'Atlanta Hub',
      '1600 Aviation Blvd, Atlanta, GA 30354',
      'America/New_York',
      'Meridian Freight Inc.',
    ],
    [
      'Dallas Distribution Center',
      '2400 Aviation Dr, DFW Airport, TX 75261',
      'America/Chicago',
      'Meridian Freight Inc.',
    ],
    [
      'Toronto Office',
      '100 King St W, Toronto, ON M5X 1A9',
      'America/Toronto',
      'Meridian Freight Canada Ltd.',
    ],
    [
      'London Office',
      '30 Finsbury Square, London EC2A 1AG',
      'Europe/London',
      'Meridian Freight UK Ltd',
    ],
    [
      'Hamburg Port Office',
      'Am Sandtorkai 41, 20457 Hamburg',
      'Europe/Berlin',
      'Meridian Freight GmbH',
    ],
    [
      'Madrid Office',
      'Paseo de la Castellana 259, 28046 Madrid',
      'Europe/Madrid',
      'Meridian Freight España S.L.',
    ],
    [
      'Bengaluru Tech Center',
      'Embassy TechVillage, Outer Ring Road, Bengaluru 560103',
      'Asia/Kolkata',
      'Meridian Freight Technologies Pvt. Ltd.',
    ],
  ] as const;
  const rows = MERIDIAN.map(([value, address, timeZone, entity], i) => ({
    ...seen(value, i + 2),
    address,
    timeZone,
    entity,
  }));
  const US = {
    id: 'e-us',
    name: 'Meridian Freight Inc.',
    country: 'US',
    timeZone: 'America/Chicago',
  };
  const IN = {
    id: 'e-in',
    name: 'Meridian Freight Technologies',
    country: 'IN',
    timeZone: 'Asia/Kolkata',
  };
  const added = (w: ReturnType<typeof workplacesIn>[number] | undefined) =>
    w?.proposed.kind === 'add' ? w.proposed : null;

  it('takes each office’s country and zone from the file, and its entity by name or country', () => {
    const places = workplacesIn(rows, [], [US, IN]);
    expect(
      places.map((w) => [
        w.value,
        added(w)?.country,
        added(w)?.timeZone,
        added(w)?.legalEntityId,
        w.note,
      ]),
    ).toEqual([
      ['Chicago HQ', 'US', 'America/Chicago', 'e-us', null],
      ['Atlanta Hub', 'US', 'America/New_York', 'e-us', null],
      ['Dallas Distribution Center', 'US', 'America/Chicago', 'e-us', null],
      ['Toronto Office', 'CA', 'America/Toronto', 'e-us', null],
      ['London Office', 'GB', 'Europe/London', 'e-us', null],
      ['Hamburg Port Office', 'DE', 'Europe/Berlin', 'e-us', null],
      ['Madrid Office', 'ES', 'Europe/Madrid', 'e-us', null],
      // Not this company's name for it, but the one entity in India.
      ['Bengaluru Tech Center', 'IN', 'Asia/Kolkata', 'e-in', null],
    ]);
  });

  it('with no time zone column, reads the address, then the name', () => {
    const places = workplacesIn(
      rows.map(({ timeZone: _z, address, ...r }, i) => ({
        ...r,
        address: i % 2 === 0 ? address : null,
      })),
      [],
      [US],
    );
    expect(places.map((w) => [added(w)?.country, added(w)?.timeZone])).toEqual([
      ['US', 'America/Chicago'],
      ['US', 'America/New_York'],
      ['US', 'America/Chicago'],
      ['CA', 'America/Toronto'],
      ['GB', 'Europe/London'],
      ['DE', 'Europe/Berlin'],
      ['ES', 'Europe/Madrid'],
      ['IN', 'Asia/Kolkata'],
    ]);
    expect(places.every((w) => w.note === null)).toBe(true);
  });

  it('takes the value most of its rows give', () => {
    const [chicago] = workplacesIn(
      [
        { ...seen('Chicago HQ', 2), timeZone: 'America/Chicago' },
        { ...seen('Chicago HQ', 3), timeZone: 'America/Chicago' },
        { ...seen('Chicago HQ', 4), timeZone: 'America/Denver' },
      ],
      [],
      [US],
    );
    expect(added(chicago)?.timeZone).toBe('America/Chicago');
  });

  it('says so when the city and the time zone disagree, and suggests the city’s', () => {
    const [chicago] = workplacesIn(
      [{ ...seen('Chicago HQ', 2), timeZone: 'Asia/Kolkata' }],
      [],
      [US],
    );
    expect(added(chicago)).toMatchObject({ country: 'US', timeZone: 'America/Chicago' });
    expect(chicago?.note).toBe(
      'Chicago is in United States but the file’s time zone is Asia/Kolkata: check the time zone.',
    );
  });

  it('says so when nothing tells where it is, and suggests the legal entity’s', () => {
    const [shed] = workplacesIn([seen('Warehouse 7', 2)], [], [US]);
    expect(added(shed)).toMatchObject({
      country: 'US',
      timeZone: 'America/Chicago',
      legalEntityId: 'e-us',
    });
    expect(shed?.note).toBe(
      'Nothing in the file says where “Warehouse 7” is, so Meridian Freight Inc.’s country and time zone are suggested: check them.',
    );
  });

  it('maps one already here, with no note', () => {
    const [chicago] = workplacesIn(rows.slice(0, 1), [{ id: 'l-chi', name: 'Chicago HQ' }], [US]);
    expect(chicago?.proposed).toEqual({ kind: 'map', locationId: 'l-chi' });
    expect(chicago?.note).toBeNull();
  });
});

describe('a close name', () => {
  it.each([
    ['Scranton Branch', 'l-scr'],
    ['Scrantn', 'l-scr'],
    ['NYC', null],
    ['Utica', null],
    ['ny', null],
  ])('%s is close to %s', (value, id) => {
    expect(closestPlace(value, HERE)?.id ?? null).toBe(id);
  });
});

describe('what HR chose for a value, as the import reads it', () => {
  it('maps to one here', () => {
    expect(placeChoiceRef({ kind: 'map', locationId: 'l-ny' }, HERE)).toEqual({
      kind: 'id',
      id: 'l-ny',
    });
  });

  it('refuses a mapping to one that is gone or archived', () => {
    expect(placeChoiceRef({ kind: 'map', locationId: 'l-old' }, HERE).kind).toBe('none');
    expect(placeChoiceRef({ kind: 'map', locationId: 'nope' }, HERE).kind).toBe('none');
  });

  it('adds a new one, or finds it once it has been added', () => {
    const add = {
      kind: 'add' as const,
      name: 'Stamford',
      country: 'US',
      timeZone: 'America/New_York',
    };
    expect(placeChoiceRef(add, HERE)).toEqual({ ...add, kind: 'new' });
    expect(placeChoiceRef(add, [...HERE, { id: 'l-st', name: 'stamford' }])).toEqual({
      kind: 'id',
      id: 'l-st',
    });
  });

  it('leaves it empty, and says HR chose so', () => {
    expect(placeChoiceRef({ kind: 'leave' }, HERE)).toEqual({
      kind: 'none',
      reason: 'left empty, as chosen in the import',
    });
  });

  it('keys a value as the file’s spelling varies', () => {
    expect(placeKey('  New   YORK ')).toBe(placeKey('new york'));
  });
});
