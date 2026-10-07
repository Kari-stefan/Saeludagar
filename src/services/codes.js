import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const HASH_BYTES = 32;

// BR-06: every account has a personal 6-digit code, stored only as a hash (AGENT_START §8).
export function generateCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

// Self-describing format: scrypt$<salt>$<hash>, with a random 16-byte salt per code.
export async function hashCode(code) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(code, salt, HASH_BYTES);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

// Checked when there is no account or no code, so those attempts cost the same scrypt work.
const DUMMY_HASH = `scrypt$${crypto.randomBytes(16).toString('base64')}$${crypto.randomBytes(HASH_BYTES).toString('base64')}`;

// Always runs one scrypt computation; returns false for a missing or malformed hash.
export async function verifyCode(code, storedHash) {
  const [scheme, salt = '', hash = ''] = (storedHash || DUMMY_HASH).split('$');
  const actual = await scrypt(String(code), Buffer.from(salt, 'base64'), HASH_BYTES);
  const expected = Buffer.from(hash, 'base64');
  return Boolean(storedHash) && scheme === 'scrypt' && expected.length === HASH_BYTES
    && crypto.timingSafeEqual(actual, expected);
}
