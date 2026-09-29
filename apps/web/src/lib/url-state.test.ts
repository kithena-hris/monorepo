// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import {
  conditionsOf,
  directoryQuery,
  filtersOf,
  noteInAddress,
  oneOf,
  sortOf,
  withQuery,
} from './url-state';

describe('oneOf', () => {
  it('passes a known value and falls back on anything else', () => {
    expect(oneOf('asked', ['mine', 'asked'], null)).toBe('asked');
    expect(oneOf('ASKED', ['mine', 'asked'], null)).toBeNull();
    expect(oneOf('<script>', ['mine', 'asked'], 'mine')).toBe('mine');
    expect(oneOf(null, ['mine', 'asked'], 'mine')).toBe('mine');
    expect(oneOf(undefined, ['mine', 'asked'], undefined)).toBeUndefined();
  });
});

describe('withQuery', () => {
  it('sets, replaces and removes keys, keeping the rest in their order', () => {
    expect(withQuery('/p', 'q=ada&sort=name:asc', { sort: 'hire_date:desc' })).toBe(
      '/p?q=ada&sort=hire_date%3Adesc',
    );
    expect(withQuery('/p', '?q=ada&after=x', { after: null })).toBe('/p?q=ada');
    expect(withQuery('/p', { q: 'ada' }, { q: '' })).toBe('/p');
    expect(withQuery('/p', '', { tab: 'asked', kind: undefined })).toBe('/p?tab=asked');
  });

  it('round-trips a value that needs escaping', () => {
    const conditions = JSON.stringify([{ key: 'status', op: 'in', values: ['a&b=c'] }]);
    const to = withQuery('/p', '', { conditions });
    expect(new URL(to, 'https://x.test').searchParams.get('conditions')).toBe(conditions);
  });
});

describe('noteInAddress', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('pushes a deliberate choice and replaces while typing, keeping the path and the rest', () => {
    window.history.replaceState(null, '', '/people/approvals?x=1');
    const before = window.history.length;
    noteInAddress({ tab: 'asked' }, 'push');
    expect(window.location.pathname + window.location.search).toBe(
      '/people/approvals?x=1&tab=asked',
    );
    expect(window.history.length).toBe(before + 1);
    noteInAddress({ q: 'ad' }, 'replace');
    noteInAddress({ q: 'ada' }, 'replace');
    expect(window.location.search).toBe('?x=1&tab=asked&q=ada');
    expect(window.history.length).toBe(before + 1);
  });

  it('adds no entry when nothing changes', () => {
    window.history.replaceState(null, '', '/people/approvals?tab=asked');
    const before = window.history.length;
    noteInAddress({ tab: 'asked' }, 'push');
    expect(window.history.length).toBe(before);
  });
});

describe('the directory’s address', () => {
  it('reads every key People answers', () => {
    expect(
      directoryQuery({
        q: 'ada',
        filter: 'department:sales,location:mad',
        after: 'c1',
        segment: 's1',
        incomplete: 'true',
        conditions: '[{"key":"status","op":"in","values":["active"]}]',
        match: 'any',
        sort: 'hire_date:desc',
      }),
    ).toEqual({
      search: 'ada',
      filter: 'department:sales,location:mad',
      after: 'c1',
      segment: 's1',
      incomplete: true,
      conditions: [{ key: 'status', op: 'in', values: ['active'] }],
      match: 'any',
      sort: 'hire_date:desc',
    });
  });

  it('treats a garbled value as absent, never as an error', () => {
    const none = {
      search: null,
      filter: null,
      after: null,
      segment: null,
      incomplete: null,
      conditions: null,
      match: null,
      sort: null,
    };
    expect(
      directoryQuery({
        q: '   ',
        filter: ':x,y:,,nocolon',
        incomplete: 'yes',
        conditions: '{not json',
        match: 'some',
        sort: 'name; drop table',
      }),
    ).toEqual(none);
    expect(directoryQuery({})).toEqual(none);
  });

  it('keeps the well-formed parts of a half-garbled filter or condition list', () => {
    expect(filtersOf('department:sales,broken,:x')).toEqual({ department: 'sales' });
    expect(conditionsOf('[{"key":"a","op":"is","values":["1"]},{"key":1},"x"]')).toEqual([
      { key: 'a', op: 'is', values: ['1'] },
    ]);
    expect(sortOf('name:asc')).toBe('name:asc');
    expect(sortOf('name:sideways')).toBeNull();
  });
});
