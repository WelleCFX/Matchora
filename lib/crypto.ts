import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function key(): Buffer {
  const s = process.env.APP_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === 'production') throw new Error('APP_SECRET е задължителен в продукция (поне 32 случайни символа)');
    return createHash('sha256').update('dev-app-secret-change-me').digest();
  }
  if (s.length < 32 && process.env.NODE_ENV === 'production') throw new Error('APP_SECRET трябва да е поне 32 символа');
  return createHash('sha256').update(s).digest();
}
/** AES-256-GCM: iv(12) | tag(16) | ciphertext, base64url. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
}
export function decrypt(blob: string): string {
  const b = Buffer.from(blob, 'base64url');
  const d = createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}
