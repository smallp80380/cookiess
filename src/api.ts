import {
  accessPattern,
  bareDomain,
  clampLifetime,
  cookieUrl,
  identity,
  inScope,
  validateCookie,
  type Cookie,
  type SiteContext,
} from './domain';
import { t } from './i18n';
export class CookieApi {
  constructor(private api: typeof chrome = chrome) {}
  async context(): Promise<SiteContext> {
    const [tab] = await this.api.tabs.query({ active: true, currentWindow: true });
    // activeTab exposes the URL only for the site the icon was clicked on. A missing URL on
    // an existing tab usually means it navigated elsewhere after the popup opened.
    if (tab?.id && !tab.url) throw new Error(t('errTabUrl'));
    if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) throw new Error(t('errNotSite'));
    const stores = await this.api.cookies.getAllCookieStores();
    const store = stores.find((s) => s.tabIds.includes(tab.id!));
    if (!store) throw new Error(t('errStore'));
    const host = new URL(tab.url).hostname;
    // getPartitionKey itself needs host permission for the schemeful top-level site.
    // Resolve only after consent; an inaccessible context can never be used to write.
    const hasAccess = await this.api.permissions.contains({ origins: [accessPattern(host)] });
    const partitionKey = hasAccess
      ? (await this.api.cookies.getPartitionKey({ tabId: tab.id, frameId: 0 })).partitionKey
      : {};
    return { tabId: tab.id, url: tab.url, host, storeId: store.id, partitionKey };
  }
  async assertContext(context: SiteContext): Promise<void> {
    const current = await this.context();
    if (
      current.tabId !== context.tabId ||
      new URL(current.url).origin !== new URL(context.url).origin ||
      current.storeId !== context.storeId ||
      JSON.stringify(current.partitionKey) !== JSON.stringify(context.partitionKey)
    )
      throw new Error(t('tabChanged'));
    if (!(await this.hasAccess(context))) throw new Error(t('errNoAccess'));
  }
  hasAccess(context: SiteContext): Promise<boolean> {
    return this.api.permissions.contains({ origins: [accessPattern(context.host)] });
  }
  requestAccess(context: SiteContext): Promise<boolean> {
    return this.api.permissions.request({ origins: [accessPattern(context.host)] });
  }
  async list(context: SiteContext): Promise<Cookie[]> {
    if (!(await this.hasAccess(context))) throw new Error(t('errPermissionRequired'));
    // No URL filter: cookies on every path. Chrome enforces granted host permissions;
    // exact domain/hostOnly + store + partition filtering defines the visible scope.
    const plain = await this.api.cookies.getAll({ storeId: context.storeId });
    const partitioned = await this.api.cookies.getAll({
      storeId: context.storeId,
      partitionKey: context.partitionKey,
    });
    return [
      ...new Map(
        [...plain, ...partitioned].filter((c) => inScope(c, context)).map((c) => [identity(c), c]),
      ).values(),
    ];
  }
  // Targeted lookup of one identity: a filtered getAll instead of re-reading the whole site,
  // so per-record checks during import stay O(1) in the number of site cookies.
  async find(cookie: Cookie, context: SiteContext): Promise<Cookie | undefined> {
    const found = await this.api.cookies.getAll({
      storeId: context.storeId,
      name: cookie.name,
      domain: bareDomain(cookie.domain),
      path: cookie.path,
      ...(cookie.partitionKey ? { partitionKey: cookie.partitionKey } : {}),
    });
    return found.find((c) => identity(c) === identity(cookie) && inScope(c, context));
  }
  async set(input: Cookie, context: SiteContext): Promise<Cookie> {
    await this.assertContext(context);
    const { cookie } = clampLifetime(input);
    const errors = validateCookie(cookie, context);
    if (Object.keys(errors).length) throw new Error(Object.values(errors).join(' '));
    const result = await this.api.cookies
      .set({
        url: cookieUrl(cookie, context),
        name: cookie.name,
        value: cookie.value,
        path: cookie.path,
        ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        storeId: context.storeId,
        ...(!cookie.session ? { expirationDate: cookie.expirationDate } : {}),
        ...(cookie.partitionKey ? { partitionKey: cookie.partitionKey } : {}),
      })
      .catch(() => {
        throw new Error(t('errChromeRejected'));
      });
    if (!result) throw new Error(t('errNotSaved'));
    const actual = await this.find(result, context);
    if (
      !actual ||
      identity(actual) !== identity(cookie) ||
      actual.value !== cookie.value ||
      actual.secure !== cookie.secure ||
      actual.httpOnly !== cookie.httpOnly ||
      actual.sameSite !== cookie.sameSite ||
      actual.session !== cookie.session ||
      (!cookie.session && Math.abs(actual.expirationDate! - cookie.expirationDate!) > 1)
    )
      throw new Error(t('errChromeChanged'));
    return actual;
  }
  async remove(cookie: Cookie, context: SiteContext): Promise<void> {
    await this.assertContext(context);
    if (!inScope(cookie, context)) throw new Error(t('errRemoveScope'));
    const before = await this.list(context);
    const target = before.find((c) => identity(c) === identity(cookie));
    if (!target) throw new Error(t('errAlreadyRemoved'));
    const details = {
      url: cookieUrl(cookie, context),
      name: cookie.name,
      storeId: context.storeId,
      ...(cookie.partitionKey ? { partitionKey: cookie.partitionKey } : {}),
    };
    const candidates = await this.api.cookies.getAll(details);
    // Conservatively refuse any ambiguity: get/remove URL selection isn't an identity API.
    if (candidates.length !== 1 || identity(candidates[0]) !== identity(cookie))
      throw new Error(t('errAmbiguous'));
    const selected = await this.api.cookies.get(details);
    if (!selected || identity(selected) !== identity(cookie)) throw new Error(t('errChromeOther'));
    await this.api.cookies.remove(details);
    const after = await this.list(context);
    if (after.some((c) => identity(c) === identity(cookie))) throw new Error(t('errStillThere'));
    if (
      before.some(
        (c) => identity(c) !== identity(cookie) && !after.some((a) => identity(a) === identity(c)),
      )
    )
      throw new Error(t('errConcurrent'));
  }
  async save(cookie: Cookie, original: Cookie | undefined, context: SiteContext): Promise<void> {
    if (original && identity(original) !== identity(cookie)) {
      if (await this.find(cookie, context)) throw new Error(t('errIdentityTaken'));
      await this.set(cookie, context);
      try {
        await this.remove(original, context);
      } catch {
        throw new Error(t('errNonAtomic'));
      }
    } else await this.set(cookie, context);
  }
}
export interface ImportItem {
  cookie: Cookie;
  action: 'add' | 'replace' | 'skip';
  reason?: string;
}
export function previewImport(
  cookies: Cookie[],
  current: Cookie[],
  context: SiteContext,
  policy: 'replace' | 'skip',
): ImportItem[] {
  const known = new Set(current.map(identity));
  return cookies.map((source) => {
    // Chrome silently caps lifetimes at 400 days. Cap here, before writing, so the
    // preview states what will be stored and the write is not reported as failed.
    const { cookie, clamped } = clampLifetime({ ...source, storeId: context.storeId });
    const errors = validateCookie(cookie, context);
    if (Object.keys(errors).length)
      return { cookie, action: 'skip', reason: Object.values(errors).join(' ') };
    const exists = known.has(identity(cookie));
    known.add(identity(cookie));
    const notes = [
      ...(clamped ? [t('noteClamped')] : []),
      ...(exists && policy === 'skip' ? [t('noteExists')] : []),
    ];
    return {
      cookie,
      action: exists ? (policy === 'skip' ? 'skip' : 'replace') : 'add',
      ...(notes.length ? { reason: notes.join(' ') } : {}),
    };
  });
}
export interface ImportResult {
  success: number;
  skipped: number;
  errors: string[];
  cancelled: boolean;
}
export interface ImportOptions {
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}
export async function applyImport(
  items: ImportItem[],
  context: SiteContext,
  api: CookieApi,
  policy: 'replace' | 'skip',
  options: ImportOptions = {},
): Promise<ImportResult> {
  const result: ImportResult = { success: 0, skipped: 0, errors: [], cancelled: false };
  await api.assertContext(context);
  for (const [index, item] of items.entries()) {
    options.onProgress?.(index, items.length);
    if (options.signal?.aborted) {
      result.cancelled = true;
      break;
    }
    if (item.action === 'skip') {
      result.skipped++;
      continue;
    }
    try {
      // A conflict may have appeared after preview; recheck just this identity.
      if (policy === 'skip' && (await api.find(item.cookie, context))) {
        result.skipped++;
        continue;
      }
      await api.set(item.cookie, context);
      result.success++;
    } catch (error) {
      const reason =
        error instanceof Error && error.message ? error.message : t('errImportGeneric');
      result.errors.push(
        t('importRecordError', { n: index + 1, name: item.cookie.name || t('unnamed'), reason }),
      );
    }
  }
  if (!result.cancelled) options.onProgress?.(items.length, items.length);
  return result;
}
