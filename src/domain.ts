import { getDomain } from 'tldts';
export type Cookie = chrome.cookies.Cookie;
export type PartitionKey = chrome.cookies.CookiePartitionKey;
export interface SiteContext {
  tabId: number;
  url: string;
  host: string;
  storeId: string;
  partitionKey: PartitionKey;
}
export function bareDomain(domain: string): string {
  return domain.replace(/^\./, '').toLowerCase();
}
export function domainMatches(host: string, cookie: Pick<Cookie, 'domain' | 'hostOnly'>): boolean {
  const domain = bareDomain(cookie.domain);
  return host === domain || (!cookie.hostOnly && host.endsWith(`.${domain}`));
}
export function partitionIdentity(key?: PartitionKey): string {
  return key
    ? JSON.stringify([key.topLevelSite ?? '', key.hasCrossSiteAncestor ?? false])
    : 'unpartitioned';
}
export function identity(cookie: Cookie): string {
  return JSON.stringify([
    cookie.storeId,
    partitionIdentity(cookie.partitionKey),
    bareDomain(cookie.domain),
    cookie.hostOnly,
    cookie.path,
    cookie.name,
  ]);
}
// Chrome encodes host-only semantics in its canonical domain (the leading dot).
// Keep them separate even when callers provide an undotted domain cookie.
export function storageIdentity(cookie: Cookie): string {
  return identity(cookie);
}
export function inScope(cookie: Cookie, context: SiteContext): boolean {
  return (
    cookie.storeId === context.storeId &&
    domainMatches(context.host, cookie) &&
    (!cookie.partitionKey ||
      partitionIdentity(cookie.partitionKey) === partitionIdentity(context.partitionKey))
  );
}
export function accessPattern(host: string): string {
  const domain = getDomain(host, { allowPrivateDomains: true });
  return `*://${domain ? `*.${domain}` : host}/*`;
}
export function cookieUrl(cookie: Cookie, context: SiteContext): string {
  const host = cookie.hostOnly ? bareDomain(cookie.domain) : context.host;
  return `${cookie.secure ? 'https:' : new URL(context.url).protocol}//${host}${cookie.path}`;
}
export type FieldErrors = Record<string, string>;
export function validateCookie(cookie: Cookie, context?: SiteContext): FieldErrors {
  const errors: FieldErrors = {};
  try {
    const domain = bareDomain(cookie.domain);
    const parsed = new URL(`http://${domain}/`);
    if (
      !domain ||
      parsed.hostname !== domain ||
      parsed.port ||
      parsed.pathname !== '/' ||
      parsed.username ||
      parsed.password
    )
      errors.domain = 'Укажите корректный домен без схемы и пути (IDN в punycode).';
  } catch {
    errors.domain = 'Укажите корректный домен без схемы и пути.';
  }
  if (!cookie.path.startsWith('/') || /[\r\n?#]/.test(cookie.path))
    errors.path = 'Путь начинается с / и не содержит ?, # или переводов строк.';
  if (/[\x00-\x20\x7f()<>@,;:\\"/[\]?={}]/.test(cookie.name))
    errors.name = 'Имя содержит недопустимые символы.';
  if (/[\x00-\x1f\x7f;]/.test(cookie.value))
    errors.value = 'Значение содержит управляющие символы или ;.';
  if (!['unspecified', 'no_restriction', 'lax', 'strict'].includes(cookie.sameSite))
    errors.sameSite = 'Недопустимое значение SameSite.';
  if (cookie.sameSite === 'no_restriction' && !cookie.secure)
    errors.sameSite = 'SameSite=None требует Secure.';
  if (
    !cookie.session &&
    (!Number.isFinite(cookie.expirationDate) || cookie.expirationDate! <= Date.now() / 1000)
  )
    errors.expirationDate = 'Укажите срок в будущем (Unix seconds).';
  if (cookie.session && cookie.expirationDate !== undefined)
    errors.expirationDate = 'У session cookie не может быть срока.';
  if (cookie.name.startsWith('__Secure-') && !cookie.secure)
    errors.secure = '__Secure- требует Secure.';
  if (
    cookie.name.startsWith('__Host-') &&
    (!cookie.secure || !cookie.hostOnly || cookie.path !== '/')
  )
    errors.name = '__Host- требует Secure, host-only и путь /.';
  if (
    (cookie.name.startsWith('__Http-') || cookie.name.startsWith('__Host-Http-')) &&
    (!cookie.secure || !cookie.httpOnly)
  )
    errors.httpOnly = '__Http- требует Secure и HttpOnly.';
  if (cookie.partitionKey && (!cookie.secure || !cookie.partitionKey.topLevelSite))
    errors.partitionKey = 'Partitioned требует Secure и topLevelSite.';
  if (context && !inScope(cookie, context))
    errors.domain = 'Cookie вне текущего домена, store или top-level partition.';
  const root = getDomain(bareDomain(cookie.domain), { allowPrivateDomains: true });
  if (!cookie.hostOnly && !root && bareDomain(cookie.domain) !== 'localhost')
    errors.domain = 'Domain cookie на IP или публичном суффиксе не поддерживается.';
  return errors;
}
