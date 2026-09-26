import { describe, expect, it } from 'vitest';

import {
  ENTERPRISE_USER,
  KITHENA_USER,
  changesFor,
  isMappablePath,
  userResource,
  valuesOf,
} from './resource.js';

/**
 * A SCIM User and a Kithena record, both ways (PRD §13.5).
 *
 * The approved mapping names SCIM paths and attribute keys; nothing else of
 * a User reaches a record. `userName`, `externalId` and `active` belong to
 * the link between the two systems, not to any attribute.
 */

const okta = {
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', ENTERPRISE_USER, KITHENA_USER],
  userName: 'ada@acme.test',
  externalId: '00uAda',
  active: true,
  name: { givenName: 'Ada', familyName: 'Lovelace', formatted: 'Ada Lovelace' },
  nickName: 'Ada',
  title: 'Engineer',
  emails: [
    { value: 'ada@home.test', type: 'home' },
    { value: 'ada@acme.test', type: 'work', primary: true },
  ],
  phoneNumbers: [{ value: '+34 600 000 000', type: 'mobile' }],
  addresses: [{ locality: 'Madrid' }],
  [ENTERPRISE_USER]: { employeeNumber: 'E-042', department: 'Engineering' },
  [KITHENA_USER]: { t_shirt_size: 'M' },
};

describe('the paths a mapping may name', () => {
  it.each([
    'userName',
    'name.givenName',
    'name.familyName',
    'nickName',
    'title',
    'emails[type eq "work"].value',
    'phoneNumbers[type eq "mobile"].value',
    `${ENTERPRISE_USER}:employeeNumber`,
    `${ENTERPRISE_USER}:department`,
    `${KITHENA_USER}:t_shirt_size`,
  ])('may name %s', (path) => {
    expect(isMappablePath(path)).toBe(true);
  });

  it.each(['active', 'externalId', 'id', 'addresses', 'password', `${KITHENA_USER}:Bad-Key`])(
    'may not name %s',
    (path) => {
      expect(isMappablePath(path)).toBe(false);
    },
  );
});

describe('reading a User', () => {
  it('flattens what a mapping can name, and nothing else', () => {
    expect(valuesOf(okta)).toEqual({
      userName: 'ada@acme.test',
      'name.givenName': 'Ada',
      'name.familyName': 'Lovelace',
      nickName: 'Ada',
      title: 'Engineer',
      'emails[type eq "work"].value': 'ada@acme.test',
      'phoneNumbers[type eq "mobile"].value': '+34 600 000 000',
      [`${ENTERPRISE_USER}:employeeNumber`]: 'E-042',
      [`${ENTERPRISE_USER}:department`]: 'Engineering',
      [`${KITHENA_USER}:t_shirt_size`]: 'M',
    });
  });

  it('takes the primary email when none is typed work', () => {
    const values = valuesOf({ emails: [{ value: 'a@x.test' }, { value: 'b@x.test', primary: true }] });
    expect(values['emails[type eq "work"].value']).toBe('b@x.test');
  });

  it('reads attribute names in any case', () => {
    expect(valuesOf({ Name: { GivenName: 'Ada' } })['name.givenName']).toBe('Ada');
  });
});

describe('what a mapping writes', () => {
  const mapping = [
    { path: 'name.givenName', key: 'given_name' },
    { path: 'title', key: 'job_title' },
    { path: `${KITHENA_USER}:t_shirt_size`, key: 't_shirt_size' },
  ];

  it('writes the mapped values, as the record keys them', () => {
    expect(changesFor(valuesOf(okta), mapping, 'merge')).toEqual({
      given_name: 'Ada',
      job_title: 'Engineer',
      t_shirt_size: 'M',
    });
  });

  it('clears what a replacement leaves out, and keeps it on a merge', () => {
    const values = valuesOf({ name: { givenName: 'Ada' } });
    expect(changesFor(values, mapping, 'replace')).toEqual({
      given_name: 'Ada',
      job_title: null,
      t_shirt_size: null,
    });
    expect(changesFor(values, mapping, 'merge')).toEqual({ given_name: 'Ada' });
  });

  it('writes an empty string as a cleared value', () => {
    expect(changesFor({ title: '' }, mapping, 'merge')).toEqual({ job_title: null });
  });
});

describe('writing a User', () => {
  it('is the link plus the mapped values, in the RFC’s shape', () => {
    const user = userResource({
      id: '0189',
      userName: 'ada@acme.test',
      externalId: '00uAda',
      active: false,
      values: {
        'name.givenName': 'Ada',
        'emails[type eq "work"].value': 'ada@acme.test',
        [`${ENTERPRISE_USER}:department`]: 'Engineering',
        [`${KITHENA_USER}:t_shirt_size`]: 'M',
      },
      meta: {
        created: '2026-09-01T00:00:00.000Z',
        lastModified: '2026-09-02T00:00:00.000Z',
        location: 'https://api.test/scim/v2/Users/0189',
      },
    });
    expect(user).toEqual({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', ENTERPRISE_USER, KITHENA_USER],
      id: '0189',
      externalId: '00uAda',
      userName: 'ada@acme.test',
      active: false,
      name: { givenName: 'Ada' },
      emails: [{ value: 'ada@acme.test', type: 'work', primary: true }],
      [ENTERPRISE_USER]: { department: 'Engineering' },
      [KITHENA_USER]: { t_shirt_size: 'M' },
      meta: {
        resourceType: 'User',
        created: '2026-09-01T00:00:00.000Z',
        lastModified: '2026-09-02T00:00:00.000Z',
        location: 'https://api.test/scim/v2/Users/0189',
      },
    });
  });

  it('round-trips through reading', () => {
    const values = valuesOf(okta);
    const { userName: _u, ...rest } = values;
    const user = userResource({
      id: '1',
      userName: 'ada@acme.test',
      externalId: null,
      active: true,
      values: rest,
      meta: { created: 'x', lastModified: 'x', location: 'x' },
    });
    expect(valuesOf(user)).toEqual(values);
  });
});
