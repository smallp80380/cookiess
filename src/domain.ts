import { getDomain } from 'tldts';
import { t } from './i18n';
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
export function inScope(cookie: Cookie, context: SiteContext): boolean {
  return (
    cookie.storeId === context.storeId &&
    domainMatches(context.host, cookie) &&
    (!cookie.partitionKey ||
      partitionIdentity(cookie.partitionKey) === partitionIdentity(context.partitionKey))
  );
}
// Splits a host into its subdomain part and the registrable domain access is granted for.
export function splitHost(host: string): [string, string] {
  const root = getDomain(host, { allowPrivateDomains: true });
  if (!root || root === host || !host.endsWith(`.${root}`)) return ['', host];
  return [host.slice(0, -root.length), root];
}
export function accessPattern(host: string): string {
  const domain = getDomain(host, { allowPrivateDomains: true });
  return `*://${domain ? `*.${domain}` : host}/*`;
}
export function cookieUrl(cookie: Cookie, context: SiteContext): string {
  const host = cookie.hostOnly ? bareDomain(cookie.domain) : context.host;
  return `${cookie.secure ? 'https:' : new URL(context.url).protocol}//${host}${cookie.path}`;
}
// Chrome rejects cookie lifetimes beyond 400 days by clamping them after the write.
export const CHROME_MAX_COOKIE_AGE_SECONDS = 400 * 24 * 60 * 60;
export const CHROME_MAX_NAME_VALUE_BYTES = 4096;
// Returns a copy whose expiry is within Chrome's limit, so a write stores exactly what was
// validated instead of being silently shortened by Chrome after the fact.
export function clampLifetime(
  cookie: Cookie,
  now = Date.now() / 1000,
): { cookie: Cookie; clamped: boolean } {
  const cap = Math.floor(now + CHROME_MAX_COOKIE_AGE_SECONDS);
  if (cookie.session || cookie.expirationDate === undefined || cookie.expirationDate <= cap)
    return { cookie, clamped: false };
  return { cookie: { ...cookie, expirationDate: cap }, clamped: true };
}
export const CHROME_MAX_ATTRIBUTE_BYTES = 1024;
const encoder = new TextEncoder();
const utf8Length = (s: string): number => encoder.encode(s).length;

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
      errors.domain = t('vDomain');
  } catch {
    errors.domain = t('vDomainShort');
  }
  if (!cookie.path.startsWith('/') || /[\r\n?#]/.test(cookie.path)) errors.path = t('vPath');
  // Mirror Chrome's accepted names: spaces, quotes, separators and non-ASCII are valid
  // inside a name (Chrome stores them and exports them); control chars, '=', ';' and
  // leading/trailing spaces are refused. Rejecting more would make Cookiess unable to
  // re-import its own export.
  if (/[\x00-\x1f\x7f=;]/.test(cookie.name) || /^ | $/.test(cookie.name)) errors.name = t('vName');
  if (/[\x00-\x1f\x7f;]/.test(cookie.value)) errors.value = t('vValue');
  // Chrome refuses name+value over 4096 bytes and path/domain attributes over 1024 bytes.
  // Checking here lets preview and the editor report it instead of a failed write.
  else if (utf8Length(cookie.name + cookie.value) > CHROME_MAX_NAME_VALUE_BYTES)
    errors.value = t('vSize', { n: CHROME_MAX_NAME_VALUE_BYTES });
  if (utf8Length(cookie.path) > CHROME_MAX_ATTRIBUTE_BYTES)
    errors.path = t('vPathLong', { n: CHROME_MAX_ATTRIBUTE_BYTES });
  if (utf8Length(cookie.domain) > CHROME_MAX_ATTRIBUTE_BYTES)
    errors.domain = t('vDomainLong', { n: CHROME_MAX_ATTRIBUTE_BYTES });
  if (!['unspecified', 'no_restriction', 'lax', 'strict'].includes(cookie.sameSite))
    errors.sameSite = t('vSameSite');
  if (cookie.sameSite === 'no_restriction' && !cookie.secure) errors.sameSite = t('vSameSiteNone');
  if (
    !cookie.session &&
    (!Number.isFinite(cookie.expirationDate) || cookie.expirationDate! <= Date.now() / 1000)
  )
    errors.expirationDate = t('vExpiry');
  if (cookie.session && cookie.expirationDate !== undefined)
    errors.expirationDate = t('vSessionExpiry');
  if (cookie.name.startsWith('__Secure-') && !cookie.secure) errors.secure = t('vSecurePrefix');
  if (
    cookie.name.startsWith('__Host-') &&
    (!cookie.secure || !cookie.hostOnly || cookie.path !== '/')
  )
    errors.name = t('vHostPrefix');
  if (
    (cookie.name.startsWith('__Http-') || cookie.name.startsWith('__Host-Http-')) &&
    (!cookie.secure || !cookie.httpOnly)
  )
    errors.httpOnly = t('vHttpPrefix');
  if (cookie.partitionKey && (!cookie.secure || !cookie.partitionKey.topLevelSite))
    errors.partitionKey = t('vPartition');
  if (context && !inScope(cookie, context)) errors.domain = t('vScope');
  const root = getDomain(bareDomain(cookie.domain), { allowPrivateDomains: true });
  if (!cookie.hostOnly && !root && bareDomain(cookie.domain) !== 'localhost')
    errors.domain = t('vDomainRoot');
  return errors;
}
