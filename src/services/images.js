import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // BR-27
export const CONTENT_TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
// Stored names are <uuid>.<ext>, so nothing else can be asked for under /uploads.
export const IMAGE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

// AGENT_START §8: the file type comes from its first bytes, never from its name or the browser.
export function imageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

// Saves under a random name in UPLOAD_DIR, which is outside public/. Returns the file name.
export async function saveImage(uploadDir, bytes, type) {
  await fs.mkdir(uploadDir, { recursive: true });
  const name = `${crypto.randomUUID()}.${type}`;
  await fs.writeFile(path.join(uploadDir, name), bytes, { flag: 'wx' });
  return name;
}

// Deleting a file that is already gone is fine.
export async function deleteImage(uploadDir, name) {
  if (!name || !IMAGE_NAME.test(name)) return;
  await fs.rm(path.join(uploadDir, name), { force: true });
}
