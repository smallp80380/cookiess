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
  it('re-imports every name Chrome stores, so an export is never refused by its own import', () => {
    const names = ['a b', 'a(b)', 'a"b', 'a,b', 'a:b', 'a/b', 'a[b]', 'a{b}', 'a?b', 'a@b', 'a<b>', 'a\\b', 'имя'];
    const cookies = names.map((name) => ({ ...cookie, name }));
    for (const format of ['cookiess', 'cookie-editor'] as const) {
      const parsed = parse(serialize(cookies, format).text);
      expect(parsed.errors).toEqual([]);
      expect(parsed.cookies.map((c) => c.name)).toEqual(names);
    }
  });
  it("refuses records over Chrome's size limits at parse time, counting UTF-8 bytes", () => {
    const fits = { ...cookie, name: 'n', value: 'x'.repeat(4095) };
    expect(parse(JSON.stringify([fits])).errors).toEqual([]);
    for (const bad of [
      { ...cookie, name: 'n', value: 'x'.repeat(4096) },
      { ...cookie, name: 'n', value: 'я'.repeat(2048) },
      { ...cookie, path: '/' + 'p'.repeat(1024) },
    ])
      expect(parse(JSON.stringify([bad])).errors[0]).toMatch(/лимит Chrome/);
  });
  it('normalizes foreign SameSite spellings only in legacy arrays', () => {
    const spellings = { Lax: 'lax', STRICT: 'strict', None: 'no_restriction', no_restriction: 'no_restriction' };
    for (const [input, expected] of Object.entries(spellings))
      expect(parse(JSON.stringify([{ ...cookie, sameSite: input }])).cookies[0].sameSite).toBe(expected);
    expect(
      parse(JSON.stringify({ format: 'cookiess', version: 1, cookies: [{ ...cookie, sameSite: 'Lax' }] })).errors,
    ).toHaveLength(1);
  });
  it('still refuses names Chrome refuses (control chars, =, ;, outer spaces)', () => {
    for (const name of ['a=b', 'a;b', 'a\u0001b', ' lead', 'trail ', 'a\tb']) {
      expect(parse(JSON.stringify([{ ...cookie, name }])).errors).toHaveLength(1);
    }
  });
});
