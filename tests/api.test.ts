import { describe, it, expect, vi } from 'vitest';
import { CookieApi, applyImport, previewImport } from '../src/api';
import { identity, type Cookie, type SiteContext } from '../src/domain';
const ctx: SiteContext = {
  host: 'app.example.com',
  url: 'https://app.example.com/',
  tabId: 1,
  storeId: '0',
  partitionKey: { topLevelSite: 'https://example.com', hasCrossSiteAncestor: false },
};
const cookie: Cookie = {
  name: 'synthetic',
  value: 'test-only',
  domain: 'app.example.com',
  path: '/',
  hostOnly: true,
  secure: true,
  httpOnly: false,
  session: true,
  sameSite: 'unspecified',
  storeId: '0',
};
function fake(initial: Cookie[] = []) {
  let items = [...initial];
  const remove = vi.fn(async () => {
    items = [];
    return {};
  });
  const set = vi.fn(async (d: chrome.cookies.SetDetails) => {
    const result: Cookie = {
      ...cookie,
      ...d,
      domain: d.domain ?? new URL(d.url).hostname,
      hostOnly: !d.domain,
      session: d.expirationDate === undefined,
    };
    items = items.filter((c) => identity(c) !== identity(result));
    items.push(result);
    return result;
  });
  const browser = {
    permissions: { contains: vi.fn(async () => true), request: vi.fn(async () => false) },
    tabs: { query: vi.fn(async () => [{ id: 1, url: ctx.url }]) },
    cookies: {
      getPartitionKey: vi.fn(async () => ({ partitionKey: ctx.partitionKey })),
      getAllCookieStores: vi.fn(async () => [{ id: '0', tabIds: [1] }]),
      getAll: vi.fn(async (d: chrome.cookies.GetAllDetails) =>
        items.filter((c) => (d.url ? c.name === d.name : !c.partitionKey || !!d.partitionKey)),
      ),
      get: vi.fn(async () => items[0]),
      set,
      remove,
    },
  };
  return { browser, api: new CookieApi(browser as unknown as typeof chrome), set, remove };
}
describe('safe API operations', () => {
  it('does not call getPartitionKey before optional host permission is granted', async () => {
    const { api, browser } = fake();
    browser.permissions.contains.mockResolvedValue(false);
    expect(await api.context()).toMatchObject({ host: ctx.host, partitionKey: {} });
    expect(browser.cookies.getPartitionKey).not.toHaveBeenCalled();
  });
  it('distinguishes permission denial from empty cookies', async () => {
    const { api, browser } = fake();
    browser.permissions.contains.mockResolvedValue(false);
    await expect(api.list(ctx)).rejects.toThrow('разрешение');
    expect(browser.cookies.getAll).not.toHaveBeenCalled();
  });
  it('rejects stale navigation before write', async () => {
    const { api, browser, set } = fake();
    browser.tabs.query.mockResolvedValue([{ id: 1, url: 'https://other.example.com' }]);
    await expect(api.set(cookie, ctx)).rejects.toThrow('изменился');
    expect(set).not.toHaveBeenCalled();
  });
  it('maps writable fields; preserves session, unspecified and full partition', async () => {
    const { api, set } = fake();
    await api.set(cookie, ctx);
    expect(set.mock.calls[0][0]).not.toHaveProperty('expirationDate');
    expect(set.mock.calls[0][0]).not.toHaveProperty('domain');
    expect(set.mock.calls[0][0].sameSite).toBe('unspecified');
  });
  it('refuses ambiguous same-name URL deletion before remove', async () => {
    const { api, remove } = fake([cookie, { ...cookie, path: '/account' }]);
    await expect(api.remove(cookie, ctx)).rejects.toThrow('неоднозначно');
    expect(remove).not.toHaveBeenCalled();
  });
  it('previews foreign scope, duplicates and destination store explicitly', () => {
    const items = previewImport(
      [{ ...cookie, storeId: 'source' }, cookie, { ...cookie, domain: 'other.example.com' }],
      [],
      ctx,
      'skip',
    );
    expect(items.map((i) => i.action)).toEqual(['add', 'skip', 'skip']);
    expect(items[0].cookie.storeId).toBe('0');
  });
  it('keeps hostOnly and domain cookies separate when domain path and name coincide', () => {
    const domainCookie = { ...cookie, domain: '.app.example.com', hostOnly: false };
    expect(previewImport([cookie, domainCookie], [], ctx, 'skip').map((i) => i.action)).toEqual([
      'add',
      'add',
    ]);
    expect(previewImport([domainCookie], [cookie], ctx, 'skip')[0].action).toBe('add');
  });
  it('counts partial API failure without claiming full success', async () => {
    const { api, set } = fake();
    set.mockRejectedValueOnce(new Error('synthetic failure'));
    const result = await applyImport(
      previewImport([cookie, { ...cookie, name: 'second' }], [], ctx, 'replace'),
      ctx,
      api,
      'replace',
    );
    expect(result.success).toBe(1);
    expect(result.errors).toHaveLength(1);
  });
  it('rechecks skip policy when a cookie arrives after preview', async () => {
    const { api, set } = fake([cookie]);
    const result = await applyImport([{ cookie, action: 'add' }], ctx, api, 'skip');
    expect(result.skipped).toBe(1);
    expect(set).not.toHaveBeenCalled();
  });
});
