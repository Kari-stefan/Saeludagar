import crypto from 'node:crypto';

// BR-01: 10 digits, with or without a hyphen after the 6th. Returns the 10-digit string, or null.
export function normalizeKennitala(input) {
  if (typeof input !== 'string') return null;
  const match = /^(\d{6})-?(\d{4})$/.exec(input.trim());
  return match ? match[1] + match[2] : null;
}

function readKey(name, value) {
  const text = (value ?? '').trim();
  if (!text) {
    throw new Error(`${name} is not set. Copy .env.example to .env and fill it in (see README, "Setup").`);
  }
  const key = Buffer.from(text, 'base64');
  if (key.length !== 32 || key.toString('base64') !== text) {
    throw new Error(`${name} must be 32 random bytes, base64-encoded. Generate it as described in the README ("Setup", step 3).`);
  }
  return key;
}

// BR-19 and AGENT_START §8: kennitölur are stored with AES-256-GCM and looked up by an
// HMAC-SHA256 made with a separate key. Both keys live only in the environment.
export function kennitalaCrypto({ kennitalaEncKey, kennitalaHmacKey }) {
  const encKey = readKey('KENNITALA_ENC_KEY', kennitalaEncKey);
  const hmacKey = readKey('KENNITALA_HMAC_KEY', kennitalaHmacKey);
  if (encKey.equals(hmacKey)) {
    throw new Error('KENNITALA_ENC_KEY and KENNITALA_HMAC_KEY must be different. Generate a separate value for each (see README, "Setup", step 3).');
  }

  return {
    hmac(kennitala) {
      return crypto.createHmac('sha256', hmacKey).update(kennitala).digest('hex');
    },

    // Stored as base64(iv).base64(tag).base64(ciphertext), with a random 12-byte IV per value.
    encrypt(kennitala) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
      const ciphertext = Buffer.concat([cipher.update(kennitala, 'utf8'), cipher.final()]);
      return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64')).join('.');
    },

    // Only the office export (milestone 7) decrypts. Never show the result in the UI, URLs or logs.
    decrypt(stored) {
      const [iv, tag, ciphertext] = stored.split('.').map((part) => Buffer.from(part, 'base64'));
      const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, iv, { authTagLength: 16 });
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    },
  };
}
