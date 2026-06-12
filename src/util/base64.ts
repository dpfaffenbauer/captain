const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Encode a binary/ASCII string to standard base64. */
export function base64Encode(input: string): string {
  let output = '';
  for (let i = 0; i < input.length; i += 3) {
    const a = input.charCodeAt(i);
    const b = i + 1 < input.length ? input.charCodeAt(i + 1) : NaN;
    const c = i + 2 < input.length ? input.charCodeAt(i + 2) : NaN;
    output += ALPHABET[a >> 2];
    output += ALPHABET[((a & 3) << 4) | (Number.isNaN(b) ? 0 : b >> 4)];
    output += Number.isNaN(b) ? '=' : ALPHABET[((b & 15) << 2) | (Number.isNaN(c) ? 0 : c >> 6)];
    output += Number.isNaN(c) ? '=' : ALPHABET[c & 63];
  }
  return output;
}

/** Decode standard base64 into a binary/ASCII string. */
export function base64Decode(input: string): string {
  const clean = input.replace(/[^A-Za-z0-9+/]/g, '');
  let output = '';
  for (let i = 0; i < clean.length; i += 4) {
    const chunk = [0, 1, 2, 3].map((offset) => ALPHABET.indexOf(clean[i + offset] ?? 'A'));
    const length = clean.slice(i, i + 4).length;
    output += String.fromCharCode(((chunk[0] << 2) | (chunk[1] >> 4)) & 255);
    if (length > 2) output += String.fromCharCode(((chunk[1] << 4) | (chunk[2] >> 2)) & 255);
    if (length > 3) output += String.fromCharCode(((chunk[2] << 6) | chunk[3]) & 255);
  }
  return output;
}

/** URL-safe base64 without padding, as used by EKS tokens. */
export function base64UrlEncode(input: string): string {
  return base64Encode(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Heuristic: treat input as base64 if it decodes and re-encodes cleanly. */
export function looksLikeBase64(input: string): boolean {
  const trimmed = input.trim();
  return /^[A-Za-z0-9+/=\s]+$/.test(trimmed) && !trimmed.includes('-----BEGIN');
}
