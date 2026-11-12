// Pure list/editor helpers for the popup: no DOM and no Chrome API, so they are unit-tested.
import type { Cookie } from './domain';
import { t, locale } from './i18n';

export type SortKey = 'name' | 'domain' | 'path' | 'expiry';
export type FlagFilter = 'all' | 'secure' | 'httpOnly' | 'session' | 'persistent' | 'partitioned';

const flagTests: Record<FlagFilter, (c: Cookie) => boolean> = {
  all: () => true,
  secure: (c) => c.secure,
  httpOnly: (c) => c.httpOnly,
  session: (c) => c.session,
  persistent: (c) => !c.session,
  partitioned: (c) => Boolean(c.partitionKey),
};

// Session cookies sort after every persistent one: they have no expiry to compare.
const expiryOf = (c: Cookie): number => (c.session ? Infinity : (c.expirationDate ?? Infinity));

export function visibleCookies(
  cookies: Cookie[],
  query: string,
  sort: SortKey,
  flag: FlagFilter = 'all',
): Cookie[] {
  const needle = query.toLocaleLowerCase();
  return cookies
    .filter(flagTests[flag] ?? flagTests.all)
    .filter((c) =>
      [c.name, c.value, c.domain, c.path].some((s) => s.toLocaleLowerCase().includes(needle)),
    )
    .sort(
      (a, b) =>
        (sort === 'expiry' ? expiryOf(a) - expiryOf(b) : a[sort].localeCompare(b[sort])) ||
        a.name.localeCompare(b.name) ||
        a.path.localeCompare(b.path),
    );
}

export function formatRelative(seconds: number, now = Date.now() / 1000): string {
  const left = seconds - now;
  if (left <= 0) return t('expiryExpired');
  if (left < 3600) return t('expiryMinutes', { n: Math.max(1, Math.round(left / 60)) });
  if (left < 86400) return t('expiryHours', { n: Math.round(left / 3600) });
  return t('expiryDays', { n: Math.round(left / 86400) });
}

export function expiryLabel(cookie: Cookie, now = Date.now() / 1000): string {
  return cookie.session || cookie.expirationDate === undefined
    ? t('expirySession')
    : formatRelative(cookie.expirationDate, now);
}

export function formatDate(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString(locale());
}

const pad = (n: number): string => String(n).padStart(2, '0');
// datetime-local works in the viewer's local time zone; Unix seconds stay the stored value.
export function toLocalInput(seconds: number): string {
  if (!Number.isFinite(seconds)) return '';
  const d = new Date(Math.floor(seconds) * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function fromLocalInput(text: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (!match) return undefined;
  const [, y, mo, d, h, mi, s] = match.map(Number);
  const date = new Date(y, mo - 1, d, h, mi, Number.isNaN(s) ? 0 : s);
  const value = date.getTime() / 1000;
  return Number.isFinite(value) ? value : undefined;
}
