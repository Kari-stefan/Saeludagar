// Milestone 9 (audit finding A-02). BR-71: event images are stored without their metadata. These
// test the service; the event form's tests are in test/events.test.js and test/front-page.test.js.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { cleanImage, saveImage, stripMetadata } from '../src/services/images.js';
import { exifTiff, GPS_NUMBER, jpegSegment, jpegWithMetadata, SECRET, TEST_IMAGES } from './helpers.js';

const latin1 = (text) => Buffer.from(text, 'latin1');
const u32 = (n, little = false) => { const b = Buffer.alloc(4); if (little) b.writeUInt32LE(n); else b.writeUInt32BE(n); return b; };

// Whether anything the helpers inject is still in the file: a SECRET text or the GPS position.
function leaks(bytes) {
  return bytes.includes(SECRET) || bytes.includes(u32(GPS_NUMBER)) || bytes.includes(u32(GPS_NUMBER, true));
}

// The IFD0 entries of a TIFF block as [tag, first value] pairs, and the offset of the next IFD.
function tiffEntries(tiff) {
  if (tiff.subarray(0, 6).equals(latin1('Exif\0\0'))) tiff = tiff.subarray(6);
  const little = tiff.toString('latin1', 0, 2) === 'II';
  const u16 = (at) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const r32 = (at) => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  const ifd = r32(4);
  const entries = Array.from({ length: u16(ifd) }, (_, n) => [u16(ifd + 2 + n * 12), u16(ifd + 2 + n * 12 + 8)]);
  return { entries, next: r32(ifd + 2 + entries.length * 12) };
}
const ONLY_ORIENTATION_6 = { entries: [[0x0112, 6]], next: 0 };

describe('JPEG metadata (BR-71)', () => {
  const { jpg } = TEST_IMAGES;
  const SOI = Buffer.from([0xff, 0xd8]);
  // The fixture's APP0 as stripping writes it: JFIF 1.2, no units, density 1x1, no thumbnail.
  const cleanJfif = jpegSegment(0xe0, Buffer.concat([latin1('JFIF\0'), Buffer.from([1, 2, 0, 0, 1, 0, 1, 0, 0])]));
  // The segments before the first scan, as [marker, payload].
  function headerSegments(bytes) {
    const found = [];
    for (let pos = 2; bytes[pos + 1] !== 0xda; pos += 2 + bytes.readUInt16BE(pos + 2)) {
      found.push([bytes[pos + 1], bytes.subarray(pos + 4, pos + 2 + bytes.readUInt16BE(pos + 2))]);
    }
    return found;
  }

  test('BR-71: Exif with GPS, XMP, IPTC, comments, thumbnails and bytes after the end are removed; the image data and colour profile stay', () => {
    const icc = latin1('fake colour profile');
    const { bytes, rest } = jpegWithMetadata(jpg, { icc });
    assert.ok(leaks(bytes), 'the test file carries the metadata');
    const stripped = stripMetadata(bytes, 'jpg');
    assert.ok(!leaks(stripped));
    const iccSegment = jpegSegment(0xe2, Buffer.concat([latin1('ICC_PROFILE\0'), Buffer.from([1, 1]), icc]));
    assert.deepEqual(stripped, Buffer.concat([SOI, cleanJfif, iccSegment, rest]), 'everything from the tables to EOI byte for byte');
    assert.deepEqual([...stripped.subarray(0, 2)], [0xff, 0xd8]);
    assert.deepEqual([...stripped.subarray(-2)], [0xff, 0xd9]);
  });

  test('BR-71: orientation 6 survives as the only tag, in either byte order; orientation 1 leaves no Exif', () => {
    for (const bigEndian of [false, true]) {
      const stripped = stripMetadata(jpegWithMetadata(jpg, { orientation: 6, bigEndian }).bytes, 'jpg');
      assert.ok(!leaks(stripped));
      const segments = headerSegments(stripped);
      assert.deepEqual(segments.slice(0, 2).map(([marker]) => marker), [0xe0, 0xe1], 'Exif right after APP0');
      assert.equal(segments.filter(([marker]) => marker === 0xe1).length, 1);
      assert.deepEqual(segments[1][1].subarray(0, 6), latin1('Exif\0\0'));
      assert.deepEqual(tiffEntries(segments[1][1]), ONLY_ORIENTATION_6);
    }
    const upright = stripMetadata(jpegWithMetadata(jpg, { orientation: 1 }).bytes, 'jpg');
    assert.ok(!headerSegments(upright).some(([marker]) => marker === 0xe1));
    assert.deepEqual(upright, stripMetadata(jpegWithMetadata(jpg).bytes, 'jpg'));
  });

  test('BR-71: a clean JPEG comes back unchanged, and stripping twice equals stripping once', () => {
    assert.deepEqual(stripMetadata(jpg, 'jpg'), jpg);
    assert.deepEqual(stripMetadata(TEST_IMAGES.progressiveJpg, 'jpg'), TEST_IMAGES.progressiveJpg);
    for (const options of [{}, { orientation: 6 }, { orientation: 3, bigEndian: true, icc: latin1('profile') }]) {
      const once = stripMetadata(jpegWithMetadata(jpg, options).bytes, 'jpg');
      assert.deepEqual(stripMetadata(once, 'jpg'), once);
    }
  });

  test('BR-71: a progressive JPEG with several scans and restart markers is walked to its end; fill bytes are tolerated', () => {
    const progressive = TEST_IMAGES.progressiveJpg;
    const scans = [];
    for (let at = progressive.indexOf(Buffer.from([0xff, 0xda])); at >= 0; at = progressive.indexOf(Buffer.from([0xff, 0xda]), at + 2)) scans.push(at);
    assert.ok(scans.length >= 3, 'several scans');
    assert.ok([0xd0, 0xd1, 0xd2].every((rst) => progressive.includes(Buffer.from([0xff, rst]))), 'restart markers');
    // Metadata between the scans, and fill bytes before a marker after scan data.
    const between = Buffer.concat([
      progressive.subarray(0, scans[1]),
      jpegSegment(0xfe, latin1(`${SECRET}-COMMENT`)),
      jpegSegment(0xe1, Buffer.concat([latin1('Exif\0\0'), exifTiff({ orientation: 6 })])),
      progressive.subarray(scans[1], scans[2]),
      Buffer.from([0xff, 0xff, 0xff]),
      progressive.subarray(scans[2]),
    ]);
    // The Exif after the first scan still counts for the orientation; the rest is the original.
    const stripped = stripMetadata(between, 'jpg');
    assert.ok(!leaks(stripped));
    const [jfif, [marker, exif]] = headerSegments(stripped);
    assert.equal(marker, 0xe1);
    assert.deepEqual(tiffEntries(exif), ONLY_ORIENTATION_6);
    const exifStart = 2 + 4 + jfif[1].length;
    assert.deepEqual(Buffer.concat([stripped.subarray(0, exifStart), stripped.subarray(exifStart + 4 + exif.length)]), progressive);

    // A scan with stuffed bytes, restart markers and fill bytes before EOI.
    const scanData = Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0xff, 0xd7, 0x78]);
    const tables = Buffer.concat([SOI, jpegSegment(0xdb, Buffer.alloc(65, 1)), jpegSegment(0xc0, Buffer.alloc(9, 2)), jpegSegment(0xda, Buffer.alloc(8, 3))]);
    const synthetic = Buffer.concat([tables, scanData, Buffer.from([0xff, 0xff, 0xff, 0xd9])]);
    assert.deepEqual(stripMetadata(synthetic, 'jpg'), Buffer.concat([tables, scanData, Buffer.from([0xff, 0xd9])]));
  });

  test('BR-71: a JPEG whose structure cannot be walked to the end is refused', () => {
    const cases = {
      'cut off in the scan data': jpg.subarray(0, jpg.length - 10),
      'without EOI': jpg.subarray(0, jpg.length - 2),
      'a length past the end': Buffer.concat([SOI, Buffer.from([0xff, 0xe1, 0xff, 0xff]), latin1('Exif')]),
      'a length under 2': Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0xff, 0xd9]),
      'a byte that is not a marker': Buffer.concat([jpg.subarray(0, 20), Buffer.from([0x00]), jpg.subarray(20)]),
      'no scan': Buffer.concat([SOI, jpegSegment(0xdb, Buffer.alloc(65)), Buffer.from([0xff, 0xd9])]),
      'a second SOI': Buffer.concat([SOI, jpg]),
    };
    for (const [name, bytes] of Object.entries(cases)) assert.equal(stripMetadata(bytes, 'jpg'), null, name);
    assert.deepEqual(cleanImage(cases['cut off in the scan data']), { error: 'events.errors.imageUnreadable' });
  });

  test('BR-71: the reserved JPG and JPGn segments (0xC8, 0xF0 to 0xFD) are removed', () => {
    const head = jpg.subarray(0, 20); // SOI and APP0
    const reserved = [0xc8, ...Array.from({ length: 14 }, (_, n) => 0xf0 + n)];
    const bytes = Buffer.concat([head, ...reserved.map((marker) => jpegSegment(marker, latin1(`${SECRET}-${marker}`))), jpg.subarray(20)]);
    assert.ok(leaks(bytes));
    const stripped = stripMetadata(bytes, 'jpg');
    assert.deepEqual(stripped, jpg);
    assert.deepEqual(stripMetadata(stripped, 'jpg'), stripped, 'stripping twice equals stripping once');
  });

  test('BR-71: a restart marker or TEM outside a scan is refused, also a file full of them', () => {
    const head = jpg.subarray(0, 20);
    for (const marker of [0xd0, 0xd7, 0x01]) {
      const bytes = Buffer.concat([head, Buffer.from([0xff, marker]), jpg.subarray(20)]);
      assert.equal(stripMetadata(bytes, 'jpg'), null, marker.toString(16));
    }
    const flood = Buffer.concat([head, Buffer.alloc(2 * 1024 * 1024 - 400, Buffer.from([0xff, 0xd0])), jpg.subarray(20)]);
    assert.deepEqual(cleanImage(flood), { error: 'events.errors.imageUnreadable' });
    assert.deepEqual(stripMetadata(TEST_IMAGES.progressiveJpg, 'jpg'), TEST_IMAGES.progressiveJpg, 'restart markers inside a scan still work');
  });

  test('BR-71: a malformed metadata block inside a good JPEG is dropped, and the orientation counts as absent', () => {
    const rest = jpg.subarray(20);
    const head = jpg.subarray(0, 20);
    const badTiffs = [
      Buffer.concat([latin1('II'), Buffer.from([42, 0]), u32(0xfffffff0, true)]), // IFD0 past the end
      Buffer.concat([latin1('MM'), Buffer.from([0, 42]), u32(8), Buffer.from([0xff, 0xff])]), // 65535 entries
      latin1('XX not a TIFF'),
      Buffer.concat([latin1('MM'), Buffer.from([0, 42]), u32(8), Buffer.from([0, 1, 0x01, 0x12, 0, 4, 0, 0, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0])]), // LONG, not SHORT
    ];
    for (const tiff of badTiffs) {
      const bytes = Buffer.concat([head, jpegSegment(0xe1, Buffer.concat([latin1('Exif\0\0'), tiff])), jpegSegment(0xe0, latin1('JFIF\0')), rest]);
      assert.deepEqual(stripMetadata(bytes, 'jpg'), jpg);
    }
  });
});

describe('PNG metadata (BR-71)', () => {
  const { png } = TEST_IMAGES;
  const SIGNATURE = png.subarray(0, 8);
  function chunk(type, data) {
    const body = Buffer.concat([latin1(type), data]);
    return Buffer.concat([u32(data.length), body, u32(zlib.crc32(body))]);
  }
  // The chunks of a PNG as [type, data, whole chunk].
  function chunks(bytes) {
    const found = [];
    for (let pos = 8; pos < bytes.length; pos += 12 + bytes.readUInt32BE(pos)) {
      const length = bytes.readUInt32BE(pos);
      found.push([bytes.toString('latin1', pos + 4, pos + 8), bytes.subarray(pos + 8, pos + 8 + length), bytes.subarray(pos, pos + 12 + length)]);
    }
    return found;
  }
  const original = chunks(png);
  const [ihdr] = original;
  const image = original.slice(1).map(([, , whole]) => whole); // IDAT and IEND
  const iccp = chunk('iCCP', Buffer.concat([latin1('Profile\0\0'), zlib.deflateSync(latin1('fake colour profile'))]));
  function withMetadata(orientation, exif = exifTiff({ orientation })) {
    return Buffer.concat([
      SIGNATURE, ihdr[2], iccp,
      chunk('tEXt', latin1(`Comment\0${SECRET}-TEXT`)),
      chunk('zTXt', Buffer.concat([latin1('Author\0\0'), zlib.deflateSync(latin1(`${SECRET}-ZTXT`))])),
      chunk('iTXt', latin1(`XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta>${SECRET}-XMP</x:xmpmeta>`)),
      chunk('eXIf', exif),
      chunk('tIME', Buffer.from([0x07, 0xea, 11, 24, 10, 0, 0])),
      chunk('prVt', latin1(`${SECRET}-PRIVATE`)),
      ...image,
      latin1(`${SECRET}-TRAILER`),
    ]);
  }

  test('BR-71: text, XMP, eXIf, tIME, unknown chunks and bytes after IEND are removed; the image data and colour profile stay', () => {
    const bytes = withMetadata();
    assert.ok(leaks(bytes));
    const stripped = stripMetadata(bytes, 'png');
    assert.ok(!leaks(stripped));
    assert.deepEqual(stripped, Buffer.concat([SIGNATURE, ihdr[2], iccp, ...image]));
  });

  test('BR-71: orientation 6 survives as an eXIf chunk before IDAT with only that tag; orientation 1 leaves none', () => {
    const stripped = stripMetadata(withMetadata(6), 'png');
    assert.ok(!leaks(stripped));
    const found = chunks(stripped);
    assert.deepEqual(found.map(([type]) => type), ['IHDR', 'iCCP', 'eXIf', 'IDAT', 'IEND']);
    assert.deepEqual(found[2][2], chunk('eXIf', found[2][1]), 'a correct CRC');
    assert.deepEqual(tiffEntries(found[2][1]), ONLY_ORIENTATION_6);
    assert.deepEqual(stripMetadata(withMetadata(1), 'png'), stripMetadata(withMetadata(), 'png'));
  });

  test('BR-71: a clean PNG comes back unchanged, and stripping twice equals stripping once', () => {
    assert.deepEqual(stripMetadata(png, 'png'), png);
    for (const orientation of [undefined, 6, 8]) {
      const once = stripMetadata(withMetadata(orientation), 'png');
      assert.deepEqual(stripMetadata(once, 'png'), once);
    }
  });

  test('BR-71: a PNG whose chunks cannot be walked to IEND is refused', () => {
    const huge = Buffer.concat([u32(0xffffffff), latin1('tEXt')]);
    const cases = {
      'cut off before IEND': png.subarray(0, png.length - 12),
      'a length past the end': Buffer.concat([SIGNATURE, ihdr[2], huge, ...image]),
      'IHDR not first': Buffer.concat([SIGNATURE, chunk('tEXt', latin1('a\0b')), ihdr[2], ...image]),
      'no IDAT': Buffer.concat([SIGNATURE, ihdr[2], image.at(-1)]),
      'a chunk type that is not letters': Buffer.concat([SIGNATURE, ihdr[2], chunk('a\0b!', Buffer.alloc(1)), ...image]),
      'only the signature': SIGNATURE,
    };
    for (const [name, bytes] of Object.entries(cases)) assert.equal(stripMetadata(bytes, 'png'), null, name);
    assert.deepEqual(cleanImage(cases['cut off before IEND']), { error: 'events.errors.imageUnreadable' });
  });

  test('BR-71: the cICP colour signal is kept like the colour profile, and stripping twice equals stripping once', () => {
    const cicp = chunk('cICP', Buffer.from([9, 16, 0, 1]));
    const bytes = Buffer.concat([SIGNATURE, ihdr[2], cicp, chunk('tEXt', latin1(`Comment\0${SECRET}-TEXT`)), ...image]);
    const stripped = stripMetadata(bytes, 'png');
    assert.deepEqual(stripped, Buffer.concat([SIGNATURE, ihdr[2], cicp, ...image]));
    assert.deepEqual(stripMetadata(stripped, 'png'), stripped);
  });

  test('BR-71: a malformed eXIf inside a good PNG is dropped, and the orientation counts as absent', () => {
    for (const exif of [latin1('garbage'), Buffer.concat([latin1('MM'), Buffer.from([0, 42]), u32(0x7ffffff0)])]) {
      assert.deepEqual(stripMetadata(withMetadata(undefined, exif), 'png'), Buffer.concat([SIGNATURE, ihdr[2], iccp, ...image]));
    }
  });
});

describe('WebP metadata (BR-71)', () => {
  const { webp } = TEST_IMAGES;
  function chunk(id, data) {
    return Buffer.concat([latin1(id), u32(data.length, true), data, Buffer.alloc(data.length % 2)]);
  }
  const riff = (...parts) => {
    const body = Buffer.concat([latin1('WEBP'), ...parts]);
    return Buffer.concat([latin1('RIFF'), u32(body.length, true), body]);
  };
  const vp8 = webp.subarray(12); // the simple file's one chunk
  const vp8x = (flags) => chunk('VP8X', Buffer.from([flags, 0, 0, 0, 3, 0, 0, 3, 0, 0])); // 4x4 canvas
  const iccp = chunk('ICCP', latin1('fake colour profile'));
  const ICC = 0x20;
  const EXIF = 0x08;
  const XMP = 0x04;
  function withMetadata(orientation, exif = Buffer.concat([latin1('Exif\0\0'), exifTiff({ orientation })])) {
    return Buffer.concat([
      riff(vp8x(ICC | EXIF | XMP), iccp, vp8, chunk('EXIF', exif), chunk('XMP ', latin1(`<x:xmpmeta>${SECRET}-XMP</x:xmpmeta>`)), chunk('ZZZZ', latin1(`${SECRET}-UNKNOWN`))),
      latin1(`${SECRET}-TRAILER`),
    ]);
  }
  // The chunks of a WebP as [id, data].
  function chunks(bytes) {
    const found = [];
    for (let pos = 12; pos < bytes.length; pos += 8 + bytes.readUInt32LE(pos + 4) + (bytes.readUInt32LE(pos + 4) % 2)) {
      found.push([bytes.toString('latin1', pos, pos + 4), bytes.subarray(pos + 8, pos + 8 + bytes.readUInt32LE(pos + 4))]);
    }
    return found;
  }

  test('BR-71: EXIF, XMP, unknown chunks and bytes after the RIFF are removed and the flags cleared; the image data and colour profile stay', () => {
    const bytes = withMetadata();
    assert.ok(leaks(bytes));
    const stripped = stripMetadata(bytes, 'webp');
    assert.ok(!leaks(stripped));
    assert.deepEqual(stripped, riff(vp8x(ICC), iccp, vp8));
    assert.equal(stripped.readUInt32LE(4), stripped.length - 8, 'the RIFF size is rewritten');
  });

  test('BR-71: orientation 6 survives as an EXIF chunk with only that tag, with the flag set; orientation 1 leaves none', () => {
    for (const exif of [undefined, exifTiff({ orientation: 6, bigEndian: true })]) {
      const stripped = stripMetadata(withMetadata(6, exif), 'webp');
      assert.ok(!leaks(stripped));
      const found = chunks(stripped);
      assert.deepEqual(found.map(([id]) => id), ['VP8X', 'ICCP', 'VP8 ', 'EXIF']);
      assert.equal(found[0][1][0], ICC | EXIF);
      assert.deepEqual(tiffEntries(found[3][1]), ONLY_ORIENTATION_6);
    }
    assert.deepEqual(stripMetadata(withMetadata(1), 'webp'), riff(vp8x(ICC), iccp, vp8));
  });

  test('BR-71: a simple WebP keeps only its image chunk, a clean one comes back unchanged, and stripping twice equals stripping once', () => {
    assert.deepEqual(stripMetadata(webp, 'webp'), webp);
    assert.deepEqual(stripMetadata(Buffer.concat([webp, latin1(`${SECRET}-TRAILER`)]), 'webp'), webp);
    assert.deepEqual(stripMetadata(riff(vp8, chunk('EXIF', exifTiff())), 'webp'), webp, 'a chunk after the image of a simple file');
    for (const orientation of [undefined, 6]) {
      const once = stripMetadata(withMetadata(orientation), 'webp');
      assert.deepEqual(stripMetadata(once, 'webp'), once);
    }
  });

  test('BR-71: a WebP whose chunks cannot be walked to the end of the RIFF is refused', () => {
    const tooBig = Buffer.from(webp);
    tooBig.writeUInt32LE(webp.length, 4);
    const chunkPastEnd = riff(vp8x(0), Buffer.concat([latin1('VP8 '), u32(0xfffffff0, true)]));
    const cases = {
      'a RIFF size past the end': tooBig,
      'cut off in the image chunk': Buffer.concat([webp.subarray(0, 4), u32(webp.length - 18, true), webp.subarray(8, webp.length - 10)]),
      'an unknown first chunk': riff(chunk('ZZZZ', Buffer.alloc(4)), vp8),
      'a chunk size past the end': chunkPastEnd,
      'VP8X without an image': riff(vp8x(ICC), iccp),
      'a VP8X that is too short': riff(chunk('VP8X', Buffer.alloc(4)), vp8),
    };
    for (const [name, bytes] of Object.entries(cases)) assert.equal(stripMetadata(bytes, 'webp'), null, name);
    assert.deepEqual(cleanImage(tooBig), { error: 'events.errors.imageUnreadable' });
  });

  test('BR-71: a malformed EXIF inside a good WebP is dropped, and the orientation counts as absent', () => {
    for (const exif of [latin1('Exif\0\0garbage'), Buffer.concat([latin1('II'), Buffer.from([42, 0]), u32(9999, true)])]) {
      assert.deepEqual(stripMetadata(withMetadata(undefined, exif), 'webp'), riff(vp8x(ICC), iccp, vp8));
    }
  });
});

describe('saving images (BR-71)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saeludagar-images-'));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('BR-71: cleanImage gives the stripped image or the error key, and saveImage takes nothing else', async () => {
    const { bytes } = jpegWithMetadata(TEST_IMAGES.jpg);
    const image = cleanImage(bytes);
    assert.equal(image.type, 'jpg');
    assert.deepEqual(image.bytes, stripMetadata(bytes, 'jpg'));
    assert.deepEqual(cleanImage(latin1('<svg onload="x"></svg>')), { error: 'events.errors.imageType' });

    await assert.rejects(saveImage(dir, { type: 'jpg', bytes }), /BR-71/, 'raw bytes are refused');
    await assert.rejects(saveImage(dir, { ...image }), /BR-71/, 'a copy is not an image from cleanImage');
    assert.deepEqual(fs.readdirSync(dir), []);
    const name = await saveImage(dir, image);
    assert.ok(!leaks(fs.readFileSync(path.join(dir, name))));
  });
});
