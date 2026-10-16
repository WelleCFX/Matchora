import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base32Decode, base32Encode, hotp, verifyTotp } from '../lib/totp';
import { decrypt, encrypt } from '../lib/crypto';

const rfc = Buffer.from('12345678901234567890');
test('RFC 6238: тестови вектори (SHA-1, 8 цифри)', () => {
  const v: [number, string][] = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037']];
  for (const [t, code] of v) assert.equal(hotp(rfc, Math.floor(t / 30), 8), code);
});
test('base32 е обратим и приема малки букви', () => {
  const s = base32Encode(rfc); assert.equal(s, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.deepEqual(base32Decode(s.toLowerCase()), rfc);
});
test('verifyTotp: приема ±1 стъпка, отхвърля останалите и невалиден формат', () => {
  const sec = base32Encode(rfc), now = 1234567890_000, code = hotp(rfc, Math.floor(now / 30000));
  assert.equal(verifyTotp(sec, code, now), Math.floor(now / 30000));
  assert.equal(verifyTotp(sec, code, now + 30_000), Math.floor(now / 30000), 'предишна стъпка в допуска');
  assert.equal(verifyTotp(sec, code, now + 120_000), null);
  assert.equal(verifyTotp(sec, '12345', now), null); assert.equal(verifyTotp(sec, 'abcdef', now), null);
});
test('crypto: AES-GCM шифрова/дешифрова и открива подправяне', () => {
  const e = encrypt('JBSWY3DPEHPK3PXP'); assert.notEqual(e, 'JBSWY3DPEHPK3PXP'); assert.equal(decrypt(e), 'JBSWY3DPEHPK3PXP');
  const b = Buffer.from(e, 'base64url'); b[b.length - 1] ^= 1;
  assert.throws(() => decrypt(b.toString('base64url')));
});
