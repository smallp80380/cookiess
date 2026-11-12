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
  const remove = vi.fn(async (d: chrome.cookies.CookieDetails) => {
    items = items.filter((c) => c.name !== d.name);
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
      get: vi.fn(async (d: chrome.cookies.CookieDetails) => items.find((c) => c.name === d.name)),
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
  it("caps lifetimes beyond Chrome's 400-day limit in the preview instead of reporting a failed write", () => {
    const far = Date.now() / 1000 + 1000 * 86400;
    const [item] = previewImport(
      [{ ...cookie, session: false, expirationDate: far }],
      [],
      ctx,
      'replace',
    );
    expect(item.action).toBe('add');
    expect(item.cookie.expirationDate!).toBeLessThan(far);
    expect(item.cookie.expirationDate! - Date.now() / 1000).toBeCloseTo(400 * 86400, -2);
    expect(item.reason).toMatch(/400 дней/);
  });
  it('editor writes over 400 days are capped before writing, not reported as failures', async () => {
    const { api, set } = fake();
    const far = Date.now() / 1000 + 1000 * 86400;
    const saved = await api.set({ ...cookie, session: false, expirationDate: far }, ctx);
    const written = set.mock.calls[0][0].expirationDate!;
    expect(written - Date.now() / 1000).toBeCloseTo(400 * 86400, -2);
    expect(saved.expirationDate).toBe(written);
  });
  it('keeps the precise reason of each failed import record', async () => {
    const { api, set } = fake();
    set.mockRejectedValueOnce(new Error('synthetic failure'));
    const result = await applyImport([{ cookie, action: 'add' }], ctx, api, 'replace');
    expect(result.errors[0]).toMatch(/Запись 1 \(synthetic\): .*Chrome отклонил cookie/);
  });
  it('rechecks skip conflicts with a targeted lookup, not a full site re-read per record', async () => {
    const { api, browser } = fake();
    const items = previewImport(
      Array.from({ length: 5 }, (_, i) => ({ ...cookie, name: `n${i}` })),
      [],
      ctx,
      'skip',
    );
    browser.cookies.getAll.mockClear();
    await applyImport(items, ctx, api, 'skip');
    // Per record: one conflict lookup and one post-write verification.
    expect(browser.cookies.getAll).toHaveBeenCalledTimes(10);
    expect(browser.cookies.getAll.mock.calls.every(([d]) => d.name !== undefined)).toBe(true);
  });
  it('reports progress and stops when cancelled', async () => {
    const { api } = fake();
    const controller = new AbortController();
    const progress: number[] = [];
    const items = previewImport(
      Array.from({ length: 4 }, (_, i) => ({ ...cookie, name: `n${i}` })),
      [],
      ctx,
      'replace',
    );
    const result = await applyImport(items, ctx, api, 'replace', {
      signal: controller.signal,
      onProgress: (done) => {
        progress.push(done);
        if (done === 2) controller.abort();
      },
    });
    expect(result.cancelled).toBe(true);
    expect(result.success).toBe(2);
    expect(progress).toEqual([0, 1, 2]);
  });
  it('explains a tab whose URL is no longer visible instead of calling it unsupported', async () => {
    const { api, browser } = fake();
    browser.tabs.query.mockResolvedValueOnce([{ id: 1 }] as never);
    await expect(api.context()).rejects.toThrow(/Нет доступа к адресу вкладки/);
  });
  it('rename creates the new identity, then removes the old one', async () => {
    const { api, set, remove } = fake([cookie]);
    await api.save({ ...cookie, name: 'renamed' }, cookie, ctx);
    expect(set.mock.calls[0][0].name).toBe('renamed');
    expect(remove.mock.calls[0][0].name).toBe('synthetic');
    expect((await api.list(ctx)).map((c) => c.name)).toEqual(['renamed']);
  });
  it('rename refuses an identity that is already taken, before writing', async () => {
    const other = { ...cookie, name: 'taken' };
    const { api, set } = fake([cookie, other]);
    await expect(api.save(other, cookie, ctx)).rejects.toThrow(/уже занята/);
    expect(set).not.toHaveBeenCalled();
  });
  it('reports a non-atomic rename when the old record cannot be removed', async () => {
    const { api, remove } = fake([cookie]);
    remove.mockRejectedValueOnce(new Error('synthetic'));
    await expect(api.save({ ...cookie, name: 'renamed' }, cookie, ctx)).rejects.toThrow(
      /не атомарна/,
    );
  });
});
