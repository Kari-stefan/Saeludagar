import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { codeFrom, startSite } from './helpers.js';

describe('privacy (BR-57, BR-19)', () => {
  test('BR-57: the only cookie the site sets is the session cookie, and pages load nothing from other sites', async () => {
    const site = await startSite();
    try {
      const admin = await site.addUser({ isAdmin: true });
      const browser = site.browser();
      const pages = [];
      const visit = async (path) => pages.push((await browser.get(path)).html);
      await visit('/');
      await visit('/login/new-code');
      await browser.post('/login/new-code', { kennitala: admin.kennitala });
      await browser.post('/language', { lang: 'en', returnTo: '/' });
      await browser.login(admin.kennitala, admin.code);
      for (const path of ['/teacher', '/admin', '/admin/teachers', '/no-such-page']) await visit(path);
      await browser.post('/admin/teachers', { action: 'create', name: 'Jón', email: 'jon@example.is', kennitala: '0000000042' });
      await browser.post('/logout');
      await visit('/login');

      assert.deepEqual([...browser.cookies.keys()], ['sid']);
      for (const html of pages) {
        assert.doesNotMatch(html, /(?:src|href|action)="(?:https?:)?\/\//, 'no third-party requests');
        assert.doesNotMatch(html, /<script/, 'no scripts yet, and none from other sites');
      }
      const cookie = (await site.browser().get('/')).setCookies[0];
      assert.match(cookie, /^sid=[^;]+; Path=\/; Expires=[^;]+; HttpOnly; SameSite=Lax$/);
    } finally {
      await site.close();
    }
  });

  test('§9 item 1: in production the session cookie is Secure and HSTS is on', async () => {
    const site = await startSite({ NODE_ENV: 'production', TRUST_PROXY: '1' });
    try {
      const overHttps = await fetch(`${site.baseUrl}/`, { headers: { 'X-Forwarded-Proto': 'https' } });
      assert.match(overHttps.headers.getSetCookie()[0], /; Secure/);
      assert.match(overHttps.headers.get('strict-transport-security'), /max-age=\d+/);
      const overHttp = await fetch(`${site.baseUrl}/`);
      assert.deepEqual(overHttp.headers.getSetCookie(), [], 'no cookie over plain HTTP');
    } finally {
      await site.close();
    }
  });

  test('BR-19: the database file contains no plaintext kennitala', async () => {
    const site = await startSite();
    try {
      const admin = await site.addUser({ isAdmin: true });
      const student = await site.addUser({ role: 'student' });
      const browser = site.browser();
      await browser.login(admin.kennitala, admin.code);
      await browser.post('/admin/teachers', { action: 'create', name: 'Jón', email: 'jon@example.is', kennitala: '000000-0042' });
      const [email] = await site.sendEmails();
      await site.browser().login('000000-0042', codeFrom(email));
      await site.browser().login(student.kennitala, '000000');
      await site.browser().post('/login/new-code', { kennitala: student.kennitala });
      await site.browser().post('/login/new-code', { kennitala: '0000000077' });

      const kennitolur = [admin.kennitala, student.kennitala, '0000000042', '0000000077'];
      const forms = kennitolur.flatMap((k) => [k, `${k.slice(0, 6)}-${k.slice(6)}`]);
      const search = () => {
        const files = [site.dbFile, `${site.dbFile}-wal`, `${site.dbFile}-shm`].filter((file) => fs.existsSync(file));
        assert.ok(files.length >= 1);
        for (const file of files) {
          const bytes = fs.readFileSync(file);
          for (const form of forms) assert.equal(bytes.includes(form), false, `${form} found in ${file}`);
        }
      };
      search(); // including the write-ahead log
      site.db.pragma('wal_checkpoint(TRUNCATE)');
      search(); // and once everything is in the main file

      // The values are there, encrypted.
      assert.equal(site.db.prepare('SELECT COUNT(*) FROM users').pluck().get(), 3);
      const stored = site.db.prepare('SELECT kennitala_enc FROM users WHERE kennitala_hmac = ?').pluck().get(site.kt.hmac('0000000042'));
      assert.equal(site.kt.decrypt(stored), '0000000042');
    } finally {
      await site.close();
    }
  });
});
