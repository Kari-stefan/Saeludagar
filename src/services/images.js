import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // BR-27
export const MAX_IMAGES_PER_EVENT = 5; // BR-27
export const CONTENT_TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
// Stored names are <uuid>.<ext>, so nothing else can be asked for under /uploads.
export const IMAGE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

// AGENT_START §8: the file type comes from its first bytes, never from its name or the browser.
export function imageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

// BR-71: the images cleanImage made. saveImage takes nothing else, so raw upload bytes cannot reach
// UPLOAD_DIR by mistake.
const cleaned = new WeakSet();

// BR-27, BR-71: an uploaded file as it may be saved, { type, bytes } without its metadata, or
// { error } (an i18n key) when it is not a JPG, PNG or WebP image or cannot be read as one.
export function cleanImage(bytes) {
  const type = imageType(bytes);
  if (!type) return { error: 'events.errors.imageType' };
  const stripped = stripMetadata(bytes, type);
  if (!stripped) return { error: 'events.errors.imageUnreadable' };
  const image = Object.freeze({ type, bytes: stripped });
  cleaned.add(image);
  return image;
}

// Saves an image from cleanImage under a random name in UPLOAD_DIR, which is outside public/.
// Returns the file name.
export async function saveImage(uploadDir, image) {
  if (!cleaned.has(image)) throw new Error('BR-71: only an image from cleanImage can be saved');
  await fs.mkdir(uploadDir, { recursive: true });
  const name = `${crypto.randomUUID()}.${image.type}`;
  const file = path.join(uploadDir, name);
  try {
    await fs.writeFile(file, image.bytes, { flag: 'wx' });
  } catch (err) {
    // A write that stops halfway, on a full disk say, must not leave part of a file behind. (If
    // the name was taken, the file there is someone else's and stays.)
    if (err.code !== 'EEXIST') await fs.rm(file, { force: true });
    throw err;
  }
  return name;
}

// Deleting a file that is already gone is fine.
export async function deleteImage(uploadDir, name) {
  if (!name || !IMAGE_NAME.test(name)) return;
  await fs.rm(path.join(uploadDir, name), { force: true });
}

// BR-71: the image without EXIF, XMP, IPTC, comments, thumbnails and anything after its end, or
// null when its structure cannot be walked to the end. It works on the file's structure only: the
// image data is copied byte for byte, never decoded. The orientation (as a one-tag EXIF block),
// the colour profile and, in PNG, the cICP colour signal are kept. Stripping a stripped image gives
// the same bytes. Every length in the file is checked against the bytes that are really there
// before it is used.
export function stripMetadata(bytes, type) {
  if (type === 'jpg') return stripJpeg(bytes);
  if (type === 'png') return stripPng(bytes);
  if (type === 'webp') return stripWebp(bytes);
  return null;
}

const EXIF_HEADER = Buffer.from('Exif\0\0', 'latin1');
const ORIENTATION_TAG = 0x0112;

// The EXIF Orientation (1 to 8) in IFD0 of a TIFF block, either byte order, or null when it is
// missing or the block is malformed.
function exifOrientation(tiff) {
  if (tiff.length >= EXIF_HEADER.length && tiff.subarray(0, EXIF_HEADER.length).equals(EXIF_HEADER)) {
    tiff = tiff.subarray(EXIF_HEADER.length);
  }
  if (tiff.length < 8) return null;
  const order = tiff.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const little = order === 'II';
  const u16 = (at) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at) => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  if (u16(2) !== 42) return null;
  const ifd = u32(4);
  if (ifd < 8 || ifd > tiff.length - 2) return null;
  const count = u16(ifd);
  if (count > (tiff.length - ifd - 2) / 12) return null;
  for (let n = 0; n < count; n += 1) {
    const entry = ifd + 2 + n * 12;
    if (u16(entry) !== ORIENTATION_TAG) continue;
    if (u16(entry + 2) !== 3 || u32(entry + 4) !== 1) return null; // one SHORT
    const value = u16(entry + 8);
    return value >= 1 && value <= 8 ? value : null;
  }
  return null;
}

// A TIFF block that holds only the orientation (2 to 8: 1 is the default and needs no block).
function orientationTiff(orientation) {
  const tiff = Buffer.alloc(26);
  tiff.write('MM', 0, 'latin1');
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4); // IFD0 right after the header
  tiff.writeUInt16BE(1, 8); // one entry
  tiff.writeUInt16BE(ORIENTATION_TAG, 10);
  tiff.writeUInt16BE(3, 12); // SHORT
  tiff.writeUInt32BE(1, 14); // count
  tiff.writeUInt16BE(orientation, 18); // value, padded to 4 bytes; then next IFD offset 0
  return tiff;
}

const keepOrientation = (orientation) => orientation !== null && orientation >= 2;

// JPEG: walk the segments from SOI to EOI. Kept: the tables, frames and scans, APP0 JFIF (without
// its thumbnail), APP2 ICC_PROFILE and APP14 Adobe. Dropped: every other APPn (Exif, XMP, IPTC,
// JFXX thumbnails), COM, the reserved JPG and JPGn segments, fill bytes and anything after EOI. A
// restart marker or TEM outside a scan is not valid there, so the file is refused.
const isRst = (marker) => marker >= 0xd0 && marker <= 0xd7;
const isReserved = (marker) => marker === 0xc8 || (marker >= 0xf0 && marker <= 0xfd);
const startsWith = (payload, text) => payload.length >= text.length && payload.toString('latin1', 0, text.length) === text;

function stripJpeg(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const segments = [];
  let orientation = null;
  let scans = 0;
  let pos = 2;
  for (;;) {
    if (pos >= bytes.length || bytes[pos] !== 0xff) return null;
    while (pos < bytes.length && bytes[pos] === 0xff) pos += 1; // fill bytes
    if (pos >= bytes.length) return null;
    const marker = bytes[pos];
    pos += 1;
    if (marker === 0xd9) break; // EOI
    if (marker === 0x00 || marker === 0xd8) return null;
    if (isRst(marker) || marker === 0x01) return null; // inside a scan they are part of its data
    if (pos + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(pos);
    if (length < 2 || pos + length > bytes.length) return null;
    const payload = bytes.subarray(pos + 2, pos + length);
    const segment = bytes.subarray(pos - 2, pos + length);
    pos += length;

    if (marker === 0xe0) {
      // JFIF\0, version, units, density: 12 bytes, then the thumbnail size, set to 0x0.
      if (startsWith(payload, 'JFIF\0') && payload.length >= 14) {
        segments.push(Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 16]), payload.subarray(0, 12), Buffer.from([0, 0])]));
      }
    } else if (marker === 0xe1) {
      if (orientation === null && startsWith(payload, 'Exif\0\0')) orientation = exifOrientation(payload);
    } else if (marker === 0xe2) {
      if (startsWith(payload, 'ICC_PROFILE\0')) segments.push(segment);
    } else if (marker === 0xee) {
      if (startsWith(payload, 'Adobe')) segments.push(segment);
    } else if ((marker >= 0xe3 && marker <= 0xef) || marker === 0xfe || isReserved(marker)) {
      // other APPn, COM and the reserved segments: dropped
    } else {
      segments.push(segment);
    }

    if (marker === 0xda) {
      // SOS: the entropy-coded data runs to the next marker that is not a stuffed 0xFF00, a
      // restart marker or a fill byte.
      const start = pos;
      for (;;) {
        if (pos + 1 >= bytes.length) return null;
        if (bytes[pos] !== 0xff) pos += 1;
        else if (bytes[pos + 1] === 0x00 || isRst(bytes[pos + 1])) pos += 2;
        else if (bytes[pos + 1] === 0xff) pos += 1;
        else break;
      }
      let end = pos;
      while (end > start && bytes[end - 1] === 0xff) end -= 1; // fill bytes before the marker
      segments.push(bytes.subarray(start, end));
      scans += 1;
    }
  }
  if (scans === 0) return null;
  if (keepOrientation(orientation)) {
    const tiff = orientationTiff(orientation);
    const app1 = Buffer.alloc(4);
    app1.writeUInt16BE(0xffe1, 0);
    app1.writeUInt16BE(2 + EXIF_HEADER.length + tiff.length, 2);
    const at = segments.length > 0 && segments[0][1] === 0xe0 ? 1 : 0; // right after APP0 JFIF
    segments.splice(at, 0, Buffer.concat([app1, EXIF_HEADER, tiff]));
  }
  return Buffer.concat([Buffer.from([0xff, 0xd8]), ...segments, Buffer.from([0xff, 0xd9])]);
}

// PNG: walk the chunks from IHDR to IEND and keep only those needed to show the image.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_KEPT = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'bKGD', 'pHYs', 'acTL', 'fcTL', 'fdAT', 'cICP']);

function pngChunk(type, data) {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 'latin1');
  data.copy(chunk, 8);
  chunk.writeUInt32BE(zlib.crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

function stripPng(bytes) {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  const chunks = [];
  let orientation = null;
  let firstIdat = -1;
  let pos = 8;
  for (;;) {
    if (pos + 12 > bytes.length) return null;
    const length = bytes.readUInt32BE(pos);
    if (length > bytes.length - pos - 12) return null;
    const type = bytes.toString('latin1', pos + 4, pos + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) return null;
    if (chunks.length === 0 && (type !== 'IHDR' || length !== 13)) return null;
    const chunk = bytes.subarray(pos, pos + 12 + length);
    pos += 12 + length;
    if (type === 'eXIf' && orientation === null) orientation = exifOrientation(chunk.subarray(8, 8 + length));
    if (!PNG_KEPT.has(type)) continue;
    if (type === 'IDAT' && firstIdat < 0) firstIdat = chunks.length;
    chunks.push(chunk);
    if (type === 'IEND') break;
  }
  if (firstIdat < 0) return null;
  if (keepOrientation(orientation)) chunks.splice(firstIdat, 0, pngChunk('eXIf', orientationTiff(orientation)));
  return Buffer.concat([PNG_SIGNATURE, ...chunks]);
}

// WebP: walk the RIFF chunks. A simple file (VP8 or VP8L) holds only the image. An extended file
// (VP8X) keeps the image, animation, alpha and colour-profile chunks and drops EXIF, XMP and the
// rest, with the VP8X flags to match.
const WEBP_KEPT = new Set(['VP8X', 'ICCP', 'ANIM', 'ANMF', 'ALPH', 'VP8 ', 'VP8L']);
const WEBP_IMAGE = new Set(['VP8 ', 'VP8L', 'ANMF']);
const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;

function webpChunk(id, data) {
  const chunk = Buffer.alloc(8 + data.length + (data.length % 2));
  chunk.write(id, 0, 'latin1');
  chunk.writeUInt32LE(data.length, 4);
  data.copy(chunk, 8);
  return chunk;
}

function stripWebp(bytes) {
  if (bytes.length < 20 || bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WEBP') return null;
  const riffSize = bytes.readUInt32LE(4);
  if (riffSize < 12 || riffSize > bytes.length - 8) return null;
  const end = 8 + riffSize;
  const chunks = [];
  let orientation = null;
  let pos = 12;
  while (pos < end) {
    if (pos + 8 > end) return null;
    const id = bytes.toString('latin1', pos, pos + 4);
    const size = bytes.readUInt32LE(pos + 4);
    if (size > end - pos - 8) return null;
    const data = bytes.subarray(pos + 8, pos + 8 + size);
    // The pad byte after an odd size may be missing only at the very end.
    pos = Math.min(end, pos + 8 + size + (size % 2));
    if (chunks.length === 0) {
      if (id === 'VP8 ' || id === 'VP8L') {
        chunks.push({ id, data });
        break;
      }
      if (id !== 'VP8X' || size < 10) return null;
    }
    if (id === 'EXIF' && orientation === null) orientation = exifOrientation(data);
    if (WEBP_KEPT.has(id)) chunks.push({ id, data });
  }
  if (!chunks.some((chunk) => WEBP_IMAGE.has(chunk.id))) return null;
  if (chunks[0].id === 'VP8X') {
    const vp8x = Buffer.from(chunks[0].data);
    vp8x[0] &= ~(VP8X_EXIF | VP8X_XMP);
    if (keepOrientation(orientation)) {
      vp8x[0] |= VP8X_EXIF;
      chunks.push({ id: 'EXIF', data: orientationTiff(orientation) });
    }
    chunks[0] = { id: 'VP8X', data: vp8x };
  }
  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), ...chunks.map((chunk) => webpChunk(chunk.id, chunk.data))]);
  const header = Buffer.alloc(8);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}
