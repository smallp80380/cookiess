// Read-only views of a cookie value. Nothing here changes the stored value.
export interface Decoded {
  kind: 'url' | 'base64' | 'jwt';
  text: string;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

// Accepts standard and URL-safe Base64, with or without padding. Returns undefined unless
// the bytes are valid UTF-8 text without control characters (other than tab/newline).
export function decodeBase64(value: string): string | undefined {
  const compact = value.trim();
  if (compact.length < 4 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)) return undefined;
  const normalized = compact.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (normalized.length % 4 === 1) return undefined;
  try {
    const binary = atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4));
    const text = utf8.decode(Uint8Array.from(binary, (ch) => ch.charCodeAt(0)));
    return /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text) ? undefined : text;
  } catch {
    return undefined;
  }
}

function prettyJson(text: string): string | undefined {
  try {
    const data: unknown = JSON.parse(text);
    return data && typeof data === 'object' ? JSON.stringify(data, null, 2) : undefined;
  } catch {
    return undefined;
  }
}

export function decodeJwt(value: string): string | undefined {
  const parts = value.trim().split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1]) return undefined;
  const header = decodeBase64(parts[0]);
  const payload = decodeBase64(parts[1]);
  const h = header && prettyJson(header);
  const p = payload && prettyJson(payload);
  return h && p ? `${h}\n${p}` : undefined;
}

export function decodeValue(value: string): Decoded[] {
  const results: Decoded[] = [];
  if (/%[0-9a-f]{2}|\+/i.test(value)) {
    try {
      const text = decodeURIComponent(value.replace(/\+/g, ' '));
      if (text !== value) results.push({ kind: 'url', text });
    } catch {
      // Malformed escapes: nothing to show.
    }
  }
  const jwt = decodeJwt(value);
  if (jwt) results.push({ kind: 'jwt', text: jwt });
  else {
    const base64 = decodeBase64(value);
    if (base64 !== undefined && base64 !== value) results.push({ kind: 'base64', text: base64 });
  }
  return results;
}
