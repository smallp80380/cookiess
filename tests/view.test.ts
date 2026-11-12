import { describe, it, expect } from 'vitest';
import type { Cookie } from '../src/domain';
import {
  expiryLabel,
  formatRelative,
  fromLocalInput,
  toLocalInput,
  visibleCookies,
} from '../src/view';
import { decodeBase64, decodeJwt, decodeValue } from '../src/decode';
import { en } from '../src/locales/en';
import { ru } from '../src/locales/ru';

const base: Cookie = {
  name: 'a',
  value: 'v',
  domain: 'example.com',
  path: '/',
  hostOnly: true,
  secure: false,
  httpOnly: false,
  sameSite: 'unspecified',
  session: true,
  storeId: '0',
};
const now = 1_800_000_000;
const list: Cookie[] = [
  { ...base, name: 'session-secure', secure: true },
  {
    ...base,
    name: 'late',
    session: false,
    expirationDate: now + 86400 * 30,
    value: 'needle-in-value',
  },
  { ...base, name: 'soon', session: false, expirationDate: now + 600, httpOnly: true },
  {
    ...base,
    name: 'part',
    secure: true,
    partitionKey: { topLevelSite: 'https://example.com', hasCrossSiteAncestor: false },
  },
];
const names = (cookies: Cookie[]) => cookies.map((c) => c.name);

describe('list view helpers', () => {
  it('searches the value as well as name, domain and path', () => {
    expect(names(visibleCookies(list, 'NEEDLE', 'name'))).toEqual(['late']);
  });
  it('filters by flag', () => {
    expect(names(visibleCookies(list, '', 'name', 'secure'))).toEqual(['part', 'session-secure']);
    expect(names(visibleCookies(list, '', 'name', 'httpOnly'))).toEqual(['soon']);
    expect(names(visibleCookies(list, '', 'name', 'persistent'))).toEqual(['late', 'soon']);
    expect(names(visibleCookies(list, '', 'name', 'session'))).toEqual(['part', 'session-secure']);
    expect(names(visibleCookies(list, '', 'name', 'partitioned'))).toEqual(['part']);
  });
  it('sorts by expiry with session cookies last', () => {
    expect(names(visibleCookies(list, '', 'expiry'))).toEqual([
      'soon',
      'late',
      'part',
      'session-secure',
    ]);
  });
  it('formats relative expiry', () => {
    expect(formatRelative(now - 1, now)).toBe('истекла');
    expect(formatRelative(now + 600, now)).toBe('через 10 мин');
    expect(formatRelative(now + 7200, now)).toBe('через 2 ч');
    expect(formatRelative(now + 86400 * 3, now)).toBe('через 3 дн.');
    expect(expiryLabel(base, now)).toBe('session');
  });
  it('round-trips local date-time input to Unix seconds', () => {
    const text = toLocalInput(now);
    expect(text).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(fromLocalInput(text)).toBe(now);
    expect(fromLocalInput(text.slice(0, 16))).toBe(now - (now % 60));
    expect(fromLocalInput('garbage')).toBeUndefined();
    expect(toLocalInput(Number.NaN)).toBe('');
  });
});

describe('value decoding', () => {
  it('decodes URL escapes and plus signs', () => {
    expect(decodeValue('a%20b+c')).toEqual([{ kind: 'url', text: 'a b c' }]);
  });
  it('decodes standard and URL-safe Base64 text', () => {
    expect(decodeBase64(btoa('hello world'))).toBe('hello world');
    expect(decodeBase64('aGk_Pz8')).toBe('hi???');
    expect(decodeValue(btoa('{"user":1}'))).toEqual([{ kind: 'base64', text: '{"user":1}' }]);
  });
  it('ignores values that are not Base64 text', () => {
    expect(decodeBase64('abc')).toBeUndefined();
    expect(decodeBase64('true')).toBeUndefined();
    expect(decodeValue('synthetic-only')).toEqual([]);
  });
  it('shows JWT header and payload without verifying', () => {
    const part = (o: object) =>
      btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const jwt = `${part({ alg: 'HS256' })}.${part({ sub: 'synthetic' })}.signature`;
    expect(decodeJwt(jwt)).toContain('"sub": "synthetic"');
    expect(decodeValue(jwt).map((d) => d.kind)).toEqual(['jwt']);
    expect(decodeJwt('a.b')).toBeUndefined();
  });
});

describe('translations', () => {
  it('English has the same placeholders as Russian for every message', () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(ru) as (keyof typeof ru)[])
      expect(vars(en[key]), key).toEqual(vars(ru[key]));
  });
});
