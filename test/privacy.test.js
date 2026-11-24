import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApp } from '../src/app.js';
import { codeFrom, startSite, tempDatabase, testConfig } from './helpers.js';

describe('privacy (BR-57, BR-19)', () => {
  test('BR-57: the only cookie the site sets is the session cookie, and pages load nothing from other sites', async () => {
    const site = await startSite();
    try {
      const admin = await site.addUser({ isAdmin: true });
      const browser = site.browser();
      const pages = [];
      const visit = async (path) => pages.push((await browser.get(path)).html);
      await visit('/');
      await visit('/info');
      await browser.post('/theme', { theme: 'dark', returnTo: '/' });
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
        for (const [script] of html.matchAll(/<script[^>]*>[\s\S]*?<\/script>/g)) {
          assert.match(script, /^<script src="\/js\/[\w-]+\.js" defer><\/script>$/, 'only the site\'s own script files, nothing inline');
        }
      }
      const cookie = (await site.browser().get('/login')).setCookies[0]; // BR-70: the front page sets none
      assert.match(cookie, /^sid=[^;]+; Path=\/; Expires=[^;]+; HttpOnly; SameSite=Lax$/);
    } finally {
      await site.close();
    }
  });

  test('§9 item 1: in production the session cookie is Secure and HSTS is on', async () => {
    const site = await startSite({ NODE_ENV: 'production', TRUST_PROXY: '1' });
    try {
      const overHttps = await fetch(`${site.baseUrl}/login`, { headers: { 'X-Forwarded-Proto': 'https' } });
      assert.match(overHttps.headers.getSetCookie()[0], /; Secure/);
      assert.match(overHttps.headers.get('strict-transport-security'), /max-age=\d+/);
      const overHttp = await fetch(`${site.baseUrl}/login`);
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

describe('the privacy notice (BR-58)', () => {
  const MAILTO = /href="mailto:([^"]*)"/g;
  const mailtos = (html) => [...html.matchAll(MAILTO)].map((m) => m[1]);
  const english = async (site) => {
    const browser = site.browser();
    await browser.post('/language', { lang: 'en', returnTo: '/' });
    return browser;
  };

  test('BR-58: a guest can read /privacy in both languages, with both addresses and the school\'s name', async () => {
    const site = await startSite();
    try {
      const is = (await site.browser().get('/privacy')).html;
      assert.equal((await site.browser().get('/privacy')).status, 200);
      assert.equal(is.match(/<h1[ >]/g).length, 1);
      assert.match(is, /<h1>Persónuvernd<\/h1>/);
      for (const heading of ['Ábyrgðaraðili', 'Hvaða upplýsingar eru geymdar', 'Hvaðan koma upplýsingarnar', 'Til hvers eru þær notaðar',
        'Hverjir sjá upplýsingarnar', 'Hve lengi eru þær geymdar', 'Vafrakökur', 'Réttur þinn', 'Hafa samband']) {
        assert.match(is, new RegExp(`<h2>${heading}</h2>`));
      }
      assert.match(is, /Prófunarskóli ber ábyrgð á meðferð persónuupplýsinga/);
      assert.deepEqual(mailtos(is).sort(), ['personuvernd@example.is', 'sambandi@example.is']);
      assert.match(is, /<a href="https:\/\/www\.personuvernd\.is">personuvernd\.is<\/a>/);
      assert.doesNotMatch(is, /atburð/i);

      const en = (await (await english(site)).get('/privacy')).html;
      assert.match(en, /<h1>Privacy<\/h1>/);
      for (const heading of ['Who is responsible', 'What is stored', 'Where the data comes from', 'What it is used for', 'Who sees the data',
        'How long it is kept', 'Cookies', 'Your rights', 'Contact']) {
        assert.match(en, new RegExp(`<h2>${heading}</h2>`));
      }
      assert.match(en, /Prófunarskóli is responsible for how personal data is handled/);
      assert.deepEqual(mailtos(en).sort(), ['personuvernd@example.is', 'sambandi@example.is']);
    } finally {
      await site.close();
    }
  });

  test('BR-58: without a school name the text says "Skólinn" and "The school"', async () => {
    const site = await startSite({ SCHOOL_NAME: '' });
    try {
      assert.match((await site.browser().get('/privacy')).html, /Skólinn ber ábyrgð/);
      assert.match((await (await english(site)).get('/privacy')).html, /The school is responsible/);
    } finally {
      await site.close();
    }
  });

  test('BR-58: with both addresses empty (development) the pages still render, with no empty mailto and no placeholder', async () => {
    const site = await startSite({ NODE_ENV: 'development', CONTACT_EMAIL: '', PRIVACY_EMAIL: '' });
    try {
      for (const browser of [site.browser(), await english(site)]) {
        for (const path of ['/privacy', '/info']) {
          const res = await browser.get(path);
          assert.equal(res.status, 200);
          assert.doesNotMatch(res.html, /mailto:/);
          assert.doesNotMatch(res.html, /class="placeholder"|koma hér þegar skólinn|will be added here/);
          if (path === '/info') assert.match(res.html, /href="\/privacy"/);
          else assert.doesNotMatch(res.html, /<h2>(?:Hafa samband|Contact)<\/h2>/, 'no empty contact section');
        }
      }
    } finally {
      await site.close();
    }
  });

  test('BR-58: with only one address set, only its sentence is shown', async () => {
    const site = await startSite({ NODE_ENV: 'development', PRIVACY_EMAIL: '' });
    try {
      assert.deepEqual(mailtos((await site.browser().get('/privacy')).html), ['sambandi@example.is']);
    } finally {
      await site.close();
    }
  });

  test('BR-58: every page has the footer link to /privacy', async () => {
    const site = await startSite();
    try {
      const student = await site.addUser({ role: 'student' });
      const browser = site.browser();
      await browser.login(student.kennitala, student.code);
      const link = /<footer class="site-footer">[\s\S]*<a href="\/privacy">Persónuvernd<\/a>[\s\S]*<\/footer>/;
      for (const [who, path] of [[site.browser(), '/'], [site.browser(), '/info'], [site.browser(), '/login'], [site.browser(), '/privacy'],
        [site.browser(), '/no-such-page'], [browser, '/'], [browser, '/points']]) {
        const res = await who.get(path);
        assert.match(res.html, link, path);
      }
      assert.match((await (await english(site)).get('/')).html, /<footer[\s\S]*<a href="\/privacy">Privacy<\/a>/);
    } finally {
      await site.close();
    }
  });

  test('BR-58: /info shows the contact address and a link to /privacy, and the old placeholder is gone', async () => {
    const site = await startSite();
    try {
      const is = (await site.browser().get('/info')).html;
      assert.match(is, /Sendu spurningar um Sæludaga og vefinn á <a href="mailto:sambandi@example\.is">sambandi@example\.is<\/a>\./);
      assert.match(is, /<a href="\/privacy">Svona fer vefurinn með persónuupplýsingar<\/a>/);
      assert.doesNotMatch(is, /class="placeholder"|koma hér þegar skólinn/);
      const en = (await (await english(site)).get('/info')).html;
      assert.match(en, /Send questions about Sæludagar and the site to <a href="mailto:sambandi@example\.is">sambandi@example\.is<\/a>\./);
      assert.match(en, /<a href="\/privacy">How the site handles personal data<\/a>/);
      assert.doesNotMatch(en, /class="placeholder"|will be added here/);
    } finally {
      await site.close();
    }
  });

  test('BR-58: in production the site refuses to start without both valid addresses', () => {
    const database = tempDatabase();
    try {
      const start = (env) => createApp({ config: testConfig({ NODE_ENV: 'production', ...env }), db: database.db });
      const message = /^CONTACT_EMAIL and PRIVACY_EMAIL must be set to the school's addresses in production \(see docs\/run\.md, "Environment variables"\)\.$/;
      for (const env of [
        { CONTACT_EMAIL: '' }, { PRIVACY_EMAIL: '' }, { CONTACT_EMAIL: '   ' }, { CONTACT_EMAIL: 'ekki-netfang' },
        { PRIVACY_EMAIL: 'a@b' }, { PRIVACY_EMAIL: 'a b@example.is' }, { CONTACT_EMAIL: 'a@@example.is' }, { PRIVACY_EMAIL: 'a@example.' },
      ]) {
        assert.throws(() => start(env), (error) => message.test(error.message), JSON.stringify(env));
      }
      assert.doesNotThrow(() => start({}));
      assert.doesNotThrow(() => createApp({ config: testConfig({ NODE_ENV: 'development', CONTACT_EMAIL: '', PRIVACY_EMAIL: '' }), db: database.db }));
    } finally {
      database.remove();
    }
  });
});
