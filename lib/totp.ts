import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf: Buffer): string {
  let bits = 0, v = 0, out = '';
  for (const b of buf) { v = (v << 8) | b; bits += 8; while (bits >= 5) { out += A[(v >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += A[(v << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  let bits = 0, v = 0; const out: number[] = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const i = A.indexOf(ch); if (i < 0) throw new Error('Невалиден base32');
    v = (v << 5) | i; bits += 5;
    if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
export const newSecret = () => base32Encode(randomBytes(20));

/** RFC 6238 (SHA-1, 6 цифри, 30 с). */
export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(b).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, '0');
}
export const stepOf = (ms = Date.now()) => Math.floor(ms / 1000 / 30);
/** Връща номера на стъпката, ако кодът е верен (±1 стъпка за разминаване на часовника), иначе null. */
export function verifyTotp(secretB32: string, code: string, nowMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const s = base32Decode(secretB32), cur = stepOf(nowMs);
  for (const d of [0, -1, 1]) {
    const exp = Buffer.from(hotp(s, cur + d)), got = Buffer.from(code);
    if (exp.length === got.length && timingSafeEqual(exp, got)) return cur + d;
  }
  return null;
}
export const otpauthUri = (secret: string, account: string) =>
  `otpauth://totp/Matchora:${encodeURIComponent(account)}?secret=${secret}&issuer=Matchora&algorithm=SHA1&digits=6&period=30`;
