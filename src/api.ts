import {
  accessPattern,
  cookieUrl,
  identity,
  storageIdentity,
  inScope,
  validateCookie,
  type Cookie,
  type SiteContext,
} from './domain';
export class CookieApi {
  constructor(private api: typeof chrome = chrome) {}
  async context(): Promise<SiteContext> {
    const [tab] = await this.api.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || !/^https?:/.test(tab.url))
      throw new Error(
        'Откройте обычный HTTP/HTTPS-сайт и нажмите Cookiess. Служебные страницы браузера не поддерживаются.',
      );
    const stores = await this.api.cookies.getAllCookieStores();
    const store = stores.find((s) => s.tabIds.includes(tab.id!));
    if (!store) throw new Error('Не удалось определить cookie store активной вкладки.');
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
      throw new Error('Сайт вкладки изменился. Нажмите обновление перед записью.');
    if (!(await this.hasAccess(context)))
      throw new Error('Нет доступа к cookies сайта. Предоставьте разрешение.');
  }
  hasAccess(context: SiteContext): Promise<boolean> {
    return this.api.permissions.contains({ origins: [accessPattern(context.host)] });
  }
  requestAccess(context: SiteContext): Promise<boolean> {
    return this.api.permissions.request({ origins: [accessPattern(context.host)] });
  }
  async list(context: SiteContext): Promise<Cookie[]> {
    if (!(await this.hasAccess(context))) throw new Error('Требуется разрешение для этого сайта.');
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
  async set(cookie: Cookie, context: SiteContext): Promise<Cookie> {
    await this.assertContext(context);
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
        throw new Error(
          'Chrome отклонил cookie. Проверьте домен, атрибуты, срок и размер записи (лимит около 4096 байт).',
        );
      });
    if (!result) throw new Error('Chrome не сохранил cookie.');
    const actual = (await this.list(context)).find((c) => identity(c) === identity(result));
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
      throw new Error(
        'Chrome изменил или отклонил identity/атрибуты (например, ограничил срок). Перечитайте список.',
      );
    return actual;
  }
  async remove(cookie: Cookie, context: SiteContext): Promise<void> {
    await this.assertContext(context);
    if (!inScope(cookie, context))
      throw new Error('Удаление за пределами текущего сайта запрещено.');
    const before = await this.list(context);
    const target = before.find((c) => identity(c) === identity(cookie));
    if (!target) throw new Error('Cookie уже удалена или её identity изменилась.');
    const details = {
      url: cookieUrl(cookie, context),
      name: cookie.name,
      storeId: context.storeId,
      ...(cookie.partitionKey ? { partitionKey: cookie.partitionKey } : {}),
    };
    const candidates = await this.api.cookies.getAll(details);
    // Conservatively refuse any ambiguity: get/remove URL selection isn't an identity API.
    if (candidates.length !== 1 || identity(candidates[0]) !== identity(cookie))
      throw new Error(
        'Точное удаление неоднозначно: одноимённые cookies подходят этому URL. Сначала удалите запись с более коротким путём или экспортируйте данные.',
      );
    const selected = await this.api.cookies.get(details);
    if (!selected || identity(selected) !== identity(cookie))
      throw new Error('Chrome выбирает другую cookie; удаление отменено.');
    await this.api.cookies.remove(details);
    const after = await this.list(context);
    if (after.some((c) => identity(c) === identity(cookie)))
      throw new Error('Cookie осталась после удаления.');
    if (
      before.some(
        (c) => identity(c) !== identity(cookie) && !after.some((a) => identity(a) === identity(c)),
      )
    )
      throw new Error('Параллельное изменение cookies: проверьте перечитанный список.');
  }
  async save(cookie: Cookie, original: Cookie | undefined, context: SiteContext): Promise<void> {
    if (
      original &&
      identity(original) !== identity(cookie) &&
      storageIdentity(original) !== storageIdentity(cookie)
    ) {
      const existing = (await this.list(context)).find(
        (c) => storageIdentity(c) === storageIdentity(cookie),
      );
      if (existing) throw new Error('Новая identity уже занята. Выберите другое имя/domain/path.');
      await this.set(cookie, context);
      try {
        await this.remove(original, context);
      } catch {
        throw new Error(
          'Новая cookie создана, но прежнюю удалить не удалось. Операция не атомарна; обе записи показаны в списке.',
        );
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
  const known = new Set(current.map(storageIdentity));
  return cookies.map((source) => {
    const cookie = { ...source, storeId: context.storeId };
    const errors = validateCookie(cookie, context);
    if (Object.keys(errors).length)
      return { cookie, action: 'skip', reason: Object.values(errors).join(' ') };
    const exists = known.has(storageIdentity(cookie));
    known.add(storageIdentity(cookie));
    return {
      cookie,
      action: exists ? (policy === 'skip' ? 'skip' : 'replace') : 'add',
      ...(exists && policy === 'skip' ? { reason: 'Identity уже существует.' } : {}),
    };
  });
}
export async function applyImport(
  items: ImportItem[],
  context: SiteContext,
  api: CookieApi,
  policy: 'replace' | 'skip',
): Promise<{ success: number; skipped: number; errors: string[] }> {
  const result = { success: 0, skipped: 0, errors: [] as string[] };
  await api.assertContext(context);
  for (const [index, item] of items.entries()) {
    if (item.action === 'skip') {
      result.skipped++;
      continue;
    }
    try {
      if (
        policy === 'skip' &&
        (await api.list(context)).some((c) => storageIdentity(c) === storageIdentity(item.cookie))
      ) {
        result.skipped++;
        continue;
      }
      await api.set(item.cookie, context);
      result.success++;
    } catch {
      result.errors.push(`Запись ${index + 1}: Chrome отклонил запись или контекст изменился.`);
    }
  }
  return result;
}
