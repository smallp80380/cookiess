import { describe, it, expect } from 'vitest';
import { parse, serialize } from '../src/formats';
import { type Cookie } from '../src/domain';
const cookie: Cookie = {
  name: 'synthetic',
  value: 'test-only=α',
  domain: '.example.com',
  path: '/account',
  hostOnly: false,
  secure: true,
  httpOnly: true,
  sameSite: 'unspecified',
  session: true,
  storeId: 'synthetic-store',
};
describe('file contracts', () => {
  it('Cookiess and Cookie-Editor round trips preserve all attributes and complete partition', () => {
    const cookies = [
      cookie,
      {
        ...cookie,
        name: 'persistent',
        session: false,
        expirationDate: Date.now() / 1000 + 86400,
        partitionKey: { topLevelSite: 'https://example.com', hasCrossSiteAncestor: false },
      },
    ];
    for (const format of ['cookiess', 'cookie-editor'] as const)
      expect(parse(serialize(cookies, format).text)).toEqual({
        cookies: format === 'cookiess' ? cookies : cookies.map((c) => ({ ...c, storeId: '' })),
        errors: [],
        warnings: [],
      });
  });
  it('adapts actual Cookie-Editor null store/unspecified only for legacy arrays', () => {
    const legacy = { ...cookie, storeId: null, sameSite: null };
    expect(parse(JSON.stringify([legacy])).cookies[0]).toEqual({ ...cookie, storeId: '' });
    expect(
      parse(JSON.stringify({ format: 'cookiess', version: 1, cookies: [legacy] })).errors,
    ).toHaveLength(1);
  });
  it('Netscape preserves empty value, HttpOnly, CRLF and boolean host semantics', () => {
    const parsed = parse('# comment\r\n#HttpOnly_example.com\tTRUE\t/\tTRUE\t0\tname\t\r\n');
    expect(parsed.errors).toEqual([]);
    expect(parsed.cookies[0]).toMatchObject({
      hostOnly: false,
      httpOnly: true,
      session: true,
      sameSite: 'unspecified',
      value: '',
    });
    expect(parse(serialize([cookie], 'netscape').text).cookies[0]).toMatchObject({
      ...cookie,
      storeId: '',
    });
    expect(parsed.warnings.length).toBeGreaterThan(0);
  });
  it('never silently flattens partitions or tab/newline fields for Netscape', () => {
    expect(() =>
      serialize([{ ...cookie, partitionKey: { topLevelSite: 'https://example.com' } }], 'netscape'),
    ).toThrow();
    expect(() => serialize([{ ...cookie, value: 'test\tdata' }], 'netscape')).toThrow();
  });
  it('rejects wrong roots, versions, types, expiry and incomplete partitions without echoing values', () => {
    for (const text of [
      '{',
      'null',
      '{"format":"cookiess","version":2,"cookies":[]}',
      JSON.stringify([{ ...cookie, value: { secret: 'DO_NOT_ECHO' } }]),
      JSON.stringify([{ ...cookie, expirationDate: 'abc' }]),
      JSON.stringify([{ ...cookie, partitionKey: { bad: 'DO_NOT_ECHO' } }]),
    ]) {
      const result = parse(text);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.join()).not.toContain('DO_NOT_ECHO');
    }
  });
  it('keeps XSS-like text as data and warns for unknown fields', () => {
    const result = parse(
      JSON.stringify([{ ...cookie, value: '<script>alert(1)</script>', unknown: true }]),
    );
    expect(result.cookies[0].value).toBe('<script>alert(1)</script>');
    expect(result.warnings).toHaveLength(1);
  });
});
