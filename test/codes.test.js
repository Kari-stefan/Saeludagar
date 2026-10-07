import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { generateCode, hashCode, verifyCode } from '../src/services/codes.js';

describe('login codes (BR-06)', () => {
  test('BR-06: a code is 6 digits from crypto.randomInt, zero-padded', (t) => {
    for (let i = 0; i < 200; i += 1) assert.match(generateCode(), /^\d{6}$/);
    const randomInt = t.mock.method(crypto, 'randomInt', () => 42);
    assert.equal(generateCode(), '000042');
    assert.deepEqual(randomInt.mock.calls[0].arguments, [0, 1_000_000]);
  });

  test('BR-06: codes are stored only as salted scrypt hashes', async () => {
    const hash = await hashCode('012345');
    assert.match(hash, /^scrypt\$[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=$/);
    assert.doesNotMatch(hash, /012345/);
    assert.notEqual(await hashCode('012345'), hash, 'each hash has its own salt');
  });

  test('BR-06: verification accepts only the right code', async () => {
    const hash = await hashCode('012345');
    assert.equal(await verifyCode('012345', hash), true);
    assert.equal(await verifyCode('012346', hash), false);
    assert.equal(await verifyCode('12345', hash), false);
  });

  test('BR-06: a missing or malformed hash never verifies', async () => {
    for (const stored of [null, undefined, '', 'scrypt$x', 'bcrypt$abc$def', '012345']) {
      assert.equal(await verifyCode('012345', stored), false, String(stored));
    }
  });
});
