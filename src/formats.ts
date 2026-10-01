import { validateCookie, type Cookie } from './domain';
export type Format = 'cookiess' | 'cookie-editor' | 'netscape';
export interface ParseResult {
  cookies: Cookie[];
  errors: string[];
  warnings: string[];
}
const known = new Set([
  'name',
  'value',
  'domain',
  'path',
  'hostOnly',
  'secure',
  'httpOnly',
  'sameSite',
  'session',
  'expirationDate',
  'storeId',
  'partitionKey',
  'id',
]);
function record(input: unknown, index: number, result: ParseResult, legacy = false): void {
  const fail = (reason: string): void => {
    result.errors.push(`Запись ${index}: ${reason}`);
  };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('ожидается объект.');
  const data = { ...(input as Record<string, unknown>) };
  // Cookie-Editor JsonFormat exports null storeId and null for unspecified SameSite.
  // These adaptations belong only to the detected legacy array, never Cookiess v1.
  if (legacy && data.storeId === null) data.storeId = '';
  if (legacy && data.sameSite === null) data.sameSite = 'unspecified';
  for (const field of ['name', 'value', 'domain', 'path'])
    if (typeof data[field] !== 'string') return fail(`поле ${field} должно быть строкой.`);
  for (const field of ['hostOnly', 'secure', 'httpOnly', 'session'])
    if (data[field] !== undefined && typeof data[field] !== 'boolean')
      return fail(`поле ${field} должно быть boolean.`);
  if (
    data.expirationDate !== undefined &&
    (typeof data.expirationDate !== 'number' || !Number.isFinite(data.expirationDate))
  )
    return fail('некорректный expirationDate.');
  if (data.storeId !== undefined && typeof data.storeId !== 'string')
    return fail('storeId должен быть строкой.');
  if (data.sameSite !== undefined && typeof data.sameSite !== 'string')
    return fail('sameSite должен быть строкой.');
  if (data.partitionKey !== undefined) {
    const key = data.partitionKey as Record<string, unknown>;
    if (
      !key ||
      typeof key !== 'object' ||
      Array.isArray(key) ||
      typeof key.topLevelSite !== 'string' ||
      (key.hasCrossSiteAncestor !== undefined && typeof key.hasCrossSiteAncestor !== 'boolean') ||
      Object.keys(key).some((k) => !['topLevelSite', 'hasCrossSiteAncestor'].includes(k))
    )
      return fail('неподдерживаемый partitionKey.');
    try {
      const url = new URL(key.topLevelSite);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== key.topLevelSite)
        return fail('topLevelSite должен быть HTTP(S) origin.');
    } catch {
      return fail('некорректный topLevelSite.');
    }
  }
  const unknown = Object.keys(data).filter((k) => !known.has(k));
  if (unknown.length)
    result.warnings.push(
      `Запись ${index}: неизвестные поля (${unknown.join(', ')}) не переносятся.`,
    );
  const cookie: Cookie = {
    name: data.name as string,
    value: data.value as string,
    domain: data.domain as string,
    path: data.path as string,
    hostOnly: (data.hostOnly as boolean) ?? !(data.domain as string).startsWith('.'),
    secure: (data.secure as boolean) ?? false,
    httpOnly: (data.httpOnly as boolean) ?? false,
    sameSite: (data.sameSite as Cookie['sameSite']) ?? 'unspecified',
    session: (data.session as boolean) ?? data.expirationDate === undefined,
    storeId: (data.storeId as string) ?? '',
    ...(data.expirationDate !== undefined ? { expirationDate: data.expirationDate as number } : {}),
    ...(data.partitionKey ? { partitionKey: data.partitionKey as Cookie['partitionKey'] } : {}),
  };
  const errors = validateCookie(cookie);
  if (Object.keys(errors).length) return fail(Object.values(errors).join(' '));
  result.cookies.push(cookie);
}
export function parse(text: string): ParseResult {
  const result: ParseResult = { cookies: [], errors: [], warnings: [] };
  if (text.length > 10_000_000) return { ...result, errors: ['Файл больше 10 MB.'] };
  const trimmed = text.trim();
  if (!trimmed) return { ...result, errors: ['Вставьте текст или выберите файл.'] };
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let data: unknown;
    try {
      data = JSON.parse(trimmed);
    } catch {
      return { ...result, errors: ['Некорректный JSON.'] };
    }
    let entries: unknown[];
    if (Array.isArray(data)) entries = data;
    else {
      const root = data as Record<string, unknown>;
      if (!root || root.format !== 'cookiess' || root.version !== 1 || !Array.isArray(root.cookies))
        return { ...result, errors: ['Ожидается Cookiess version 1 или массив Cookie-Editor.'] };
      entries = root.cookies;
    }
    entries.forEach((entry, i) => record(entry, i + 1, result, Array.isArray(data)));
  } else {
    result.warnings.push(
      'cookies.txt не хранит SameSite, partitionKey и store. SameSite: unspecified; store: текущей вкладки.',
    );
    text.split(/\r?\n/).forEach((line, i) => {
      if (!line || (line.startsWith('#') && !line.startsWith('#HttpOnly_'))) return;
      const parts = line.split('\t');
      if (
        parts.length !== 7 ||
        !['TRUE', 'FALSE'].includes(parts[1]) ||
        !['TRUE', 'FALSE'].includes(parts[3]) ||
        !/^\d+$/.test(parts[4])
      ) {
        result.errors.push(`Строка ${i + 1}: ожидаются 7 tab-полей, TRUE/FALSE и целый срок.`);
        return;
      }
      const [domain, subdomains, path, secure, expiration, name, value] = parts;
      record(
        {
          domain: domain.replace(/^#HttpOnly_/, ''),
          hostOnly: subdomains === 'FALSE',
          path,
          secure: secure === 'TRUE',
          httpOnly: domain.startsWith('#HttpOnly_'),
          session: expiration === '0',
          ...(expiration !== '0' ? { expirationDate: Number(expiration) } : {}),
          name,
          value,
        },
        i + 1,
        result,
      );
    });
  }
  return result;
}
export function serialize(cookies: Cookie[], format: Format): { text: string; warnings: string[] } {
  if (format !== 'netscape')
    return {
      text: JSON.stringify(
        format === 'cookiess'
          ? { format: 'cookiess', version: 1, cookies }
          : cookies.map((c) => ({
              ...c,
              storeId: null,
              sameSite: c.sameSite === 'unspecified' ? null : c.sameSite,
            })),
        null,
        2,
      ),
      warnings:
        format === 'cookie-editor'
          ? [
              'Cookie-Editor JSON: storeId не переносится; Unspecified SameSite обозначается null. Для полного архива используйте Cookiess JSON.',
            ]
          : [],
    };
  if (cookies.some((c) => c.partitionKey))
    throw new Error(
      'cookies.txt не поддерживает partitioned cookies. Выберите JSON или только непартиционированные записи.',
    );
  if (cookies.some((c) => [c.domain, c.path, c.name, c.value].some((s) => /[\t\r\n]/.test(s))))
    throw new Error('Tab и переводы строк нельзя сохранить в cookies.txt. Выберите JSON.');
  return {
    text:
      '# Netscape HTTP Cookie File\n' +
      cookies
        .map((c) =>
          [
            `${c.httpOnly ? '#HttpOnly_' : ''}${c.domain}`,
            c.hostOnly ? 'FALSE' : 'TRUE',
            c.path,
            c.secure ? 'TRUE' : 'FALSE',
            c.session ? 0 : Math.trunc(c.expirationDate!),
            c.name,
            c.value,
          ].join('\t'),
        )
        .join('\n') +
      '\n',
    warnings: ['Потери cookies.txt: SameSite, store и partitionKey.'],
  };
}
