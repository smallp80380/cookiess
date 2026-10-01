import { describe, it, expect } from 'vitest';
import {
  accessPattern,
  domainMatches,
  identity,
  inScope,
  validateCookie,
  type Cookie,
  type SiteContext,
} from '../src/domain';
export const context: SiteContext = {
  host: 'app.example.com',
  url: 'https://app.example.com/',
  tabId: 1,
  storeId: '0',
  partitionKey: { topLevelSite: 'https://example.com', hasCrossSiteAncestor: false },
};
export const fixture: Cookie = {
  name: 'synthetic',
  value: 'test-only',
  domain: 'app.example.com',
  path: '/',
  storeId: '0',
  hostOnly: true,
  secure: true,
  httpOnly: true,
  session: true,
  sameSite: 'unspecified',
};
describe('current host scope', () => {
  it('includes parent domain and every path, excludes parent host-only and siblings', () => {
    expect(
      inScope({ ...fixture, domain: '.example.com', hostOnly: false, path: '/account' }, context),
    ).toBe(true);
    for (const c of [
      { domain: 'example.com', hostOnly: true },
      { domain: 'other.example.com', hostOnly: true },
      { domain: 'evil-example.com', hostOnly: false },
    ])
      expect(domainMatches(context.host, c)).toBe(false);
  });
  it('handles localhost, IPv4, public and private suffixes without last-two-label guessing', () => {
    expect(accessPattern('app.company.co.uk')).toBe('*://*.company.co.uk/*');
    expect(accessPattern('foo.github.io')).toBe('*://*.foo.github.io/*');
    expect(accessPattern('localhost')).toBe('*://localhost/*');
    expect(accessPattern('127.0.0.1')).toBe('*://127.0.0.1/*');
    expect(domainMatches('localhost', { domain: 'localhost', hostOnly: true })).toBe(true);
    expect(validateCookie({ ...fixture, domain: '.co.uk', hostOnly: false })).toHaveProperty(
      'domain',
    );
  });
  it('isolates stores and full partition context', () => {
    expect(inScope({ ...fixture, storeId: '1' }, context)).toBe(false);
    expect(
      inScope({ ...fixture, partitionKey: { topLevelSite: 'https://other.com' } }, context),
    ).toBe(false);
    expect(
      inScope(
        { ...fixture, partitionKey: { ...context.partitionKey, hasCrossSiteAncestor: true } },
        context,
      ),
    ).toBe(false);
    expect(inScope({ ...fixture, partitionKey: context.partitionKey }, context)).toBe(true);
  });
  it('does not collapse duplicate names', () => {
    const variants = [
      fixture,
      { ...fixture, path: '/account' },
      { ...fixture, domain: '.example.com', hostOnly: false },
      { ...fixture, storeId: '1' },
      { ...fixture, partitionKey: context.partitionKey },
    ];
    expect(new Set(variants.map(identity)).size).toBe(5);
  });
  it('rejects invalid attribute combinations and preserves unspecified/session', () => {
    expect(validateCookie(fixture, context)).toEqual({});
    expect(
      validateCookie({ ...fixture, sameSite: 'no_restriction', secure: false }),
    ).toHaveProperty('sameSite');
    expect(validateCookie({ ...fixture, name: '__Host-synthetic', path: '/x' })).toHaveProperty(
      'name',
    );
    expect(validateCookie({ ...fixture, expirationDate: 2000000000 })).toHaveProperty(
      'expirationDate',
    );
  });
});
