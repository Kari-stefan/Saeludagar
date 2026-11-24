// Shared test setup. Only fake data: kennitölur are 000000000N.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase, toIso } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { createOutboxWorker } from '../src/jobs/outbox.js';
import { hashCode } from '../src/services/codes.js';
import { kennitalaCrypto } from '../src/services/crypto.js';

export function randomKey() {
  return crypto.randomBytes(32).toString('base64');
}

export function testConfig(env = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    SESSION_SECRET: 'test-secret',
    SCHOOL_NAME: 'Prófunarskóli',
    CONTACT_EMAIL: 'sambandi@example.is',
    PRIVACY_EMAIL: 'personuvernd@example.is',
    KENNITALA_ENC_KEY: randomKey(),
    KENNITALA_HMAC_KEY: randomKey(),
    ...env,
  });
}

export function tempDatabase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saeludagar-test-'));
  const file = path.join(dir, 'test.db');
  const db = openDatabase(file);
  migrate(db);
  return {
    db,
    dir,
    file,
    remove() {
      if (db.open) db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// Inserts an account with a known code, the way an import or create-admin would.
export async function insertUser(db, kt, {
  kennitala, role = 'teacher', isAdmin = false, active = true, name = 'Prófun', email = 'profun@example.is', code = '123456',
}) {
  const now = toIso();
  const isEventManager = role === 'teacher' ? 1 : 0;
  const result = db.prepare(`INSERT INTO users
    (role, is_admin, is_event_manager, kennitala_hmac, kennitala_enc, name, email, active, code_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(role, isAdmin ? 1 : 0, isEventManager, kt.hmac(kennitala), kt.encrypt(kennitala), name, email, active ? 1 : 0,
      code === null ? null : await hashCode(code), now, now);
  return { id: Number(result.lastInsertRowid), kennitala, code };
}

// Inserts an event (published unless said otherwise) on a Sæludagar day, adding the day if needed.
// `images` are file names for its images, in order; `image_file` is short for one image.
export function insertEvent(db, ownerId, fields = {}) {
  const now = toIso();
  const event = {
    status: 'published', title_is: 'Prófunarviðburður', title_en: null, description_is: 'Lýsing.', description_en: null,
    host: 'Gestgjafi', braut_restricted: 0, capacity: 10, fee_isk: 0, image_file: null, images: [], event_date: '2027-03-11',
    start_time: '10:00', end_time: '12:00', location: 'Stofa 101', brautir: [], ...fields,
  };
  db.prepare('INSERT OR IGNORE INTO saeludagar_days (day) VALUES (?)').run(event.event_date);
  const id = Number(db.prepare(`INSERT INTO events (owner_id, status, title_is, title_en, description_is, description_en,
    host, braut_restricted, capacity, fee_isk, event_date, start_time, end_time, location, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(ownerId, event.status, event.title_is, event.title_en,
    event.description_is, event.description_en, event.host, event.braut_restricted, event.capacity, event.fee_isk,
    event.event_date, event.start_time, event.end_time, event.location, now, now).lastInsertRowid);
  const images = event.image_file ? [event.image_file, ...event.images] : event.images;
  images.forEach((file, position) => db.prepare('INSERT INTO event_images (event_id, file, position) VALUES (?, ?, ?)').run(id, file, position));
  for (const braut of event.brautir) db.prepare('INSERT INTO event_brautir (event_id, braut) VALUES (?, ?)').run(id, braut);
  return id;
}

// A running site on a random port with a temporary database. Emails go to `sent` when the
// test runs the outbox worker with sendEmails().
export async function startSite(env = {}) {
  const database = tempDatabase();
  // Event images go to the temporary folder too, never to the repository's uploads/.
  const config = testConfig({ UPLOAD_DIR: path.join(database.dir, 'uploads'), ...env });
  const app = createApp({ config, db: database.db });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const kt = kennitalaCrypto(config);
  const sent = [];
  const outbox = createOutboxWorker({ db: database.db, config, mailer: { async send(message) { sent.push(message); } } });
  let lastFake = 0;

  return {
    db: database.db,
    dbFile: database.file,
    config,
    kt,
    baseUrl,
    browser: () => new Browser(baseUrl),
    addUser(fields = {}) {
      lastFake += 1;
      return insertUser(database.db, kt, { kennitala: String(lastFake).padStart(10, '0'), ...fields });
    },
    // Runs the outbox worker once and returns the emails it sent.
    async sendEmails() {
      await outbox.runOnce();
      return sent.splice(0);
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      database.remove();
    },
  };
}

// The 6-digit code on its own line in a code email.
export function codeFrom(email) {
  const match = /^ {4}(\d{6})$/m.exec(email.text);
  assert.ok(match, 'no code in the email');
  return match[1];
}

// A browser with a cookie jar. post() sends the CSRF token from a page in the same session,
// as the site's own forms do.
export class Browser {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookies = new Map();
  }

  async request(method, url, form, headers = {}) {
    const cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    const res = await fetch(this.baseUrl + url, {
      method,
      redirect: 'manual',
      headers: { ...(cookie ? { cookie } : {}), ...headers },
      body: form instanceof FormData || !form ? form : new URLSearchParams(form),
    });
    const setCookies = res.headers.getSetCookie();
    for (const header of setCookies) {
      const [pair] = header.split(';');
      const eq = pair.indexOf('=');
      this.cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
    return { status: res.status, location: res.headers.get('location'), setCookies, html: await res.text() };
  }

  get(url) {
    return this.request('GET', url);
  }

  // A guest's front page has no token (BR-70), so a guest's token comes from the login page,
  // which starts the session the way a real visitor's would.
  async csrfToken(from = '/') {
    const page = await this.get(from);
    let match = /name="_csrf" value="([^"]+)"/.exec(page.html);
    if (!match && from === '/') match = /name="_csrf" value="([^"]+)"/.exec((await this.get('/login')).html);
    assert.ok(match, `no CSRF token on ${from}`);
    return match[1];
  }

  async post(url, form = {}) {
    return this.request('POST', url, { _csrf: await this.csrfToken(), ...form });
  }

  login(kennitala, code) {
    return this.post('/login', { kennitala, code });
  }

  // Uploads one file as a multipart form, the way the import page does: the token field comes first.
  // Posts a multipart form such as the event form: fields (an array value repeats the field)
  // and optionally files, one { field, bytes, name, type } or a list of them. The field is the
  // event form's "images" unless said otherwise.
  async postForm(url, fields, files) {
    const form = new FormData();
    form.append('_csrf', await this.csrfToken());
    for (const [name, value] of Object.entries(fields)) {
      for (const item of [].concat(value)) form.append(name, String(item));
    }
    for (const file of [].concat(files ?? [])) {
      form.append(file.field ?? 'images', new Blob([file.bytes], { type: file.type ?? 'application/octet-stream' }), file.name ?? 'mynd.png');
    }
    return this.request('POST', url, form);
  }

  async upload(url, bytes, { token, filename = 'nemendur.csv' } = {}) {
    const form = new FormData();
    if (token !== null) form.append('_csrf', token ?? await this.csrfToken());
    form.append('file', new Blob([bytes]), filename);
    return this.request('POST', url, form);
  }

  // The session ID inside the signed cookie value (s:<id>.<signature>).
  get sessionId() {
    const value = this.cookies.get('sid');
    return value && decodeURIComponent(value).slice(2).split('.')[0];
  }
}

// Tiny real images (made with Pillow), without metadata: an 8x8 baseline JPEG, a 32x16
// progressive JPEG with a restart marker after every block, a 4x4 PNG and a 4x4 lossy WebP.
export const TEST_IMAGES = {
  jpg: Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwA03w90+SiiiuKtiqnNuaZdjK3sFqf/2Q==', 'base64'),
  progressiveJpg: Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wgARCAAQACADASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAAAwQF/8QAFgEBAQEAAAAAAAAAAAAAAAAAAgME/90ABAAB/9oADAMBAAIQAxAAAAHNW9Vn/9Cdb1F//8QAFhAAAwAAAAAAAAAAAAAAAAAAAAEC/9oACAEBAAEFAlB//9BQf//RUH//0lB//9NQf//UUH//1VB//9ZQf//EABURAQEAAAAAAAAAAAAAAAAAAAMA/9oACAEDAQE/ATe//9A3v//EABYRAAMAAAAAAAAAAAAAAAAAAAABA//aAAgBAgEBPwF1P//QdT//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/An//0H//0X//0n//03//1H//1X//1n//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IT//0D//0T//0j//0z//1D//1T//1j//2gAMAwEAAgADAAAAEPv/0K//xAAVEQEBAAAAAAAAAAAAAAAAAAAAYf/aAAgBAwEBPxCj/9Cj/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//9B//8QAFRABAQAAAAAAAAAAAAAAAAAAAGH/2gAIAQEAAT8Qi//Qi//Ri//Si//Ti//Ui//Vi//Wi//Z', 'base64'),
  png: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAGElEQVR4nGNkYGgIZWCAIBaGUAY4wM0BAF7bAowQZ82nAAAAAElFTkSuQmCC', 'base64'),
  webp: Buffer.from('UklGRlIAAABXRUJQVlA4IEYAAADwAQCdASoEAAQAAsBMJbACdEyAAdW2o4AAzj69ckkum3C1gaRAG/GPTZHdycHyPD+eH4gPn/8qa5WOJ4ON050q/n/8iWAA', 'base64'),
};

// Every text the metadata helpers below put into an image contains SECRET, and the GPS position
// contains GPS_NUMBER, so a test can check that none of it is left.
export const SECRET = 'SECRET';
export const GPS_NUMBER = 0x1234567;

// An EXIF (TIFF) block as a phone writes one: IFD0 with the camera, the time and the orientation
// (if given), a GPS IFD with a position, and IFD1 with an embedded thumbnail.
export function exifTiff({ orientation, bigEndian = false } = {}) {
  const u16 = (n) => { const b = Buffer.alloc(2); if (bigEndian) b.writeUInt16BE(n); else b.writeUInt16LE(n); return b; };
  const u32 = (n) => { const b = Buffer.alloc(4); if (bigEndian) b.writeUInt32BE(n); else b.writeUInt32LE(n); return b; };
  const ascii = (tag, text) => ({ tag, type: 2, count: text.length + 1, value: Buffer.from(`${text}\0`, 'latin1') });
  const long = (tag, n) => ({ tag, type: 4, count: 1, value: u32(n) });
  const rationals = (tag, pairs) => ({ tag, type: 5, count: pairs.length, value: Buffer.concat(pairs.flatMap(([a, b]) => [u32(a), u32(b)])) });
  const padded = (value) => (value.length % 2 ? Buffer.concat([value, Buffer.alloc(1)]) : value);
  const size = (entries) => 6 + 12 * entries.length + entries.reduce((sum, e) => sum + (e.value.length > 4 ? padded(e.value).length : 0), 0);
  function ifd(entries, at, next) {
    const parts = [u16(entries.length)];
    const data = [];
    let dataAt = at + 6 + 12 * entries.length;
    for (const e of entries) {
      parts.push(u16(e.tag), u16(e.type), u32(e.count));
      if (e.value.length <= 4) {
        parts.push(Buffer.concat([e.value, Buffer.alloc(4 - e.value.length)]));
      } else {
        parts.push(u32(dataAt));
        data.push(padded(e.value));
        dataAt += padded(e.value).length;
      }
    }
    return Buffer.concat([...parts, u32(next), ...data]);
  }
  const ifd0 = (gpsAt) => [
    ascii(0x010f, `${SECRET}-CAMERA`),
    ...(orientation ? [{ tag: 0x0112, type: 3, count: 1, value: u16(orientation) }] : []),
    ascii(0x0132, '2026:11:24 10:00:00'),
    long(0x8825, gpsAt),
  ];
  const gps = [
    ascii(0x0001, 'N'),
    rationals(0x0002, [[64, 1], [8, 1], [GPS_NUMBER, 1000]]),
    ascii(0x0003, 'W'),
    rationals(0x0004, [[21, 1], [56, 1], [GPS_NUMBER, 1000]]),
    ascii(0x0012, `${SECRET}-GPS`),
  ];
  const thumbnail = Buffer.from(`${SECRET}-EXIF-THUMBNAIL`, 'latin1');
  const ifd1 = (thumbAt) => [long(0x0201, thumbAt), long(0x0202, thumbnail.length)];
  const gpsAt = 8 + size(ifd0(0));
  const ifd1At = gpsAt + size(gps);
  const thumbAt = ifd1At + size(ifd1(0));
  return Buffer.concat([
    Buffer.from(bigEndian ? 'MM' : 'II', 'latin1'), u16(42), u32(8),
    ifd(ifd0(gpsAt), 8, ifd1At), ifd(gps, gpsAt, 0), ifd(ifd1(thumbAt), ifd1At, 0), thumbnail,
  ]);
}

export function jpegSegment(marker, payload) {
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

// A JPEG from TEST_IMAGES with what phones and editors add: a JFIF thumbnail, Exif with GPS, XMP,
// IPTC, a comment, a JFXX thumbnail, an unknown APP segment and bytes after the end. With icc, a
// colour profile segment goes in too. Returns { bytes, rest }: rest is the original after its
// APP0, up to and with EOI, which stripping must leave unchanged.
export function jpegWithMetadata(jpeg, { orientation, bigEndian, icc } = {}) {
  const rest = jpeg.subarray(4 + jpeg.readUInt16BE(4));
  const jfif = Buffer.concat([Buffer.from('JFIF\0', 'latin1'), Buffer.from([1, 2, 0, 0, 1, 0, 1, 1, 1]), Buffer.from(SECRET.slice(0, 3), 'latin1')]);
  const bytes = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe0, jfif),
    jpegSegment(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), exifTiff({ orientation, bigEndian })])),
    jpegSegment(0xe1, Buffer.from(`http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>${SECRET}-XMP</x:xmpmeta>`, 'latin1')),
    ...(icc ? [jpegSegment(0xe2, Buffer.concat([Buffer.from('ICC_PROFILE\0', 'latin1'), Buffer.from([1, 1]), icc]))] : []),
    jpegSegment(0xed, Buffer.from(`Photoshop 3.0\x008BIM\x04\x04\0\0\0\0\0\x0b${SECRET}-IPTC`, 'latin1')),
    jpegSegment(0xfe, Buffer.from(`${SECRET}-COMMENT`, 'latin1')),
    jpegSegment(0xe0, Buffer.from(`JFXX\0\x10${SECRET}-JFXX`, 'latin1')),
    jpegSegment(0xe4, Buffer.from(`${SECRET}-APP4`, 'latin1')),
    rest,
    Buffer.from(`${SECRET}-TRAILER`, 'latin1'),
  ]);
  return { bytes, rest };
}
