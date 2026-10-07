import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { kennitalaCrypto, normalizeKennitala } from '../src/services/crypto.js';
import { randomKey } from './helpers.js';

const keys = () => ({ kennitalaEncKey: randomKey(), kennitalaHmacKey: randomKey() });

describe('kennitala input (BR-01)', () => {
  test('BR-01: 10 digits, with or without a hyphen after the 6th digit, become one 10-digit string', () => {
    assert.equal(normalizeKennitala('0000000001'), '0000000001');
    assert.equal(normalizeKennitala('000000-0001'), '0000000001');
    assert.equal(normalizeKennitala('  000000-0001 '), '0000000001');
  });

  test('BR-01: any other input is rejected', () => {
    const rejected = [
      '', '000000001', '00000000011', '00000-00001', '0000000-001', '000000--0001', '000000 0001',
      '-0000000001', 'abcdefghij', '000000-000a', '０００００００００１', undefined, null, 1, ['0000000001'],
    ];
    for (const input of rejected) assert.equal(normalizeKennitala(input), null, JSON.stringify(input));
  });
});

describe('kennitala storage (BR-19)', () => {
  test('BR-19: encryption is reversible and the stored value does not contain the kennitala', () => {
    const kt = kennitalaCrypto(keys());
    const stored = kt.encrypt('0000000001');
    assert.equal(kt.decrypt(stored), '0000000001');
    assert.doesNotMatch(stored, /0000000001/);
    const [iv, tag, ciphertext] = stored.split('.').map((part) => Buffer.from(part, 'base64'));
    assert.equal(iv.length, 12);
    assert.equal(tag.length, 16);
    assert.equal(ciphertext.length, 10);
  });

  test('BR-19: every value gets its own random IV', () => {
    const kt = kennitalaCrypto(keys());
    assert.notEqual(kt.encrypt('0000000001'), kt.encrypt('0000000001'));
  });

  test('BR-19: decrypting needs the same key, and tampering is detected', () => {
    const k = keys();
    const stored = kennitalaCrypto(k).encrypt('0000000001');
    assert.throws(() => kennitalaCrypto(keys()).decrypt(stored));
    const [iv, tag, ciphertext] = stored.split('.');
    const flipped = Buffer.from(ciphertext, 'base64');
    flipped[0] ^= 1;
    assert.throws(() => kennitalaCrypto(k).decrypt([iv, tag, flipped.toString('base64')].join('.')));
  });

  test('BR-19: lookups use a keyed hash (HMAC-SHA256) with its own key', () => {
    const k = keys();
    const kt = kennitalaCrypto(k);
    const hmac = kt.hmac('0000000001');
    assert.match(hmac, /^[0-9a-f]{64}$/);
    assert.equal(kennitalaCrypto(k).hmac('0000000001'), hmac);
    assert.notEqual(kennitalaCrypto(keys()).hmac('0000000001'), hmac);
    assert.notEqual(crypto.createHash('sha256').update('0000000001').digest('hex'), hmac);
    assert.notEqual(kt.hmac('0000000002'), hmac);
  });

  test('BR-19: the keys must be set, be 32 base64-encoded bytes, and differ from each other', () => {
    const key = randomKey();
    assert.throws(() => kennitalaCrypto({ kennitalaEncKey: '', kennitalaHmacKey: key }),
      /^Error: KENNITALA_ENC_KEY is not set\. Copy \.env\.example to \.env/);
    assert.throws(() => kennitalaCrypto({ kennitalaEncKey: key, kennitalaHmacKey: undefined }),
      /^Error: KENNITALA_HMAC_KEY is not set/);
    for (const bad of ['not-base64!', crypto.randomBytes(16).toString('base64'), `${key}AAAA`]) {
      assert.throws(() => kennitalaCrypto({ kennitalaEncKey: bad, kennitalaHmacKey: key }),
        /KENNITALA_ENC_KEY must be 32 random bytes, base64-encoded/);
    }
    assert.throws(() => kennitalaCrypto({ kennitalaEncKey: key, kennitalaHmacKey: key }),
      /KENNITALA_ENC_KEY and KENNITALA_HMAC_KEY must be different/);
  });
});
