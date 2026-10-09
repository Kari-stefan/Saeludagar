import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createMailer, renderEmail } from '../src/services/email.js';
import { testConfig } from './helpers.js';

const data = { name: 'Jóna Jónsdóttir', code: '012345', loginUrl: 'http://localhost:3000/login' };

describe('code emails (BR-52)', () => {
  for (const [kind, isText, enText, subject] of [
    ['new_code', 'Beðið var um nýjan kóða', 'A new code was requested', 'Nýr kóði fyrir Sæludaga / Your new Sæludagar code'],
    ['teacher_code', 'Hér er kóðinn þinn', 'Here is your code', 'Kóði fyrir Sæludagavefinn / Your code for the Sæludagar website'],
  ]) {
    test(`BR-52: ${kind} has the Icelandic text first, then the English text, in one message`, async () => {
      const email = await renderEmail(kind, data);
      assert.equal(email.subject, subject);
      const is = email.text.indexOf(isText);
      const en = email.text.indexOf(enText);
      assert.ok(is >= 0 && en > is, 'Icelandic before English');
      assert.ok(email.text.indexOf('Halló Jóna Jónsdóttir,') < email.text.indexOf('Hello Jóna Jónsdóttir,'));
      assert.equal(email.text.match(/^ {4}012345$/gm).length, 2, 'the code in both languages');
      assert.equal(email.text.match(/^http:\/\/localhost:3000\/login$/gm).length, 2, 'the link in both languages');
    });
  }

  test('BR-52: emails are plain text, so names are not HTML-escaped', async () => {
    const email = await renderEmail('new_code', { ...data, name: 'Ása & <Óli>' });
    assert.match(email.text, /^Halló Ása & <Óli>,$/m);
    assert.doesNotMatch(email.text, /&amp;|&lt;/);
  });
});

describe('mail transport (AGENT_START §8)', () => {
  test('without SMTP_HOST, development prints each email to the console', async () => {
    const lines = [];
    const mailer = createMailer(testConfig({ NODE_ENV: 'development', SMTP_HOST: '' }), { log: (text) => lines.push(text) });
    await mailer.send({ to: { name: 'Jóna', address: 'jona@example.is' }, subject: 'Efni / Subject', text: 'Texti\n' });
    assert.equal(lines.length, 1);
    assert.equal(lines[0], [
      '--- Email (not sent, because SMTP_HOST is empty) ---',
      'To: Jóna <jona@example.is>',
      'Subject: Efni / Subject',
      '',
      'Texti',
      '--- End of email ---',
    ].join('\n'));
  });

  test('§9 item 10: without SMTP_HOST, production never prints an email; sending fails instead', async () => {
    const lines = [];
    const mailer = createMailer(testConfig({ NODE_ENV: 'production', SMTP_HOST: '' }), { log: (text) => lines.push(text) });
    await assert.rejects(
      mailer.send({ to: { name: 'Jóna', address: 'jona@example.is' }, subject: 'S', text: 'kóði 012345' }),
      /SMTP_HOST is not set, so emails cannot be sent/,
    );
    assert.deepEqual(lines, []);
  });

  test('with SMTP_HOST set, MAIL_FROM is required', () => {
    assert.throws(() => createMailer(testConfig({ SMTP_HOST: 'smtp.example.is', MAIL_FROM: '' })),
      /^Error: MAIL_FROM is not set\. Set it to the school's noreply address/);
  });

  test('SMTP_PORT and SMTP_SECURE must match: 465 uses TLS from the start, 587 does not', () => {
    const smtp = (port, secure) => testConfig({ SMTP_HOST: 'smtp.example.is', MAIL_FROM: 'noreply@example.is', SMTP_PORT: port, SMTP_SECURE: secure });
    assert.throws(() => createMailer(smtp('465', 'false')), /^Error: SMTP_PORT is 465, so SMTP_SECURE must be true/);
    assert.throws(() => createMailer(smtp('465', '')), /SMTP_SECURE must be true/);
    assert.throws(() => createMailer(smtp('587', 'true')), /^Error: SMTP_PORT is 587, so SMTP_SECURE must be false/);
    for (const yes of ['true', 'True', 'TRUE', ' true ', '1', 'yes']) {
      assert.doesNotThrow(() => createMailer(smtp('465', yes)), yes);
    }
    assert.doesNotThrow(() => createMailer(smtp('587', 'false')));
  });

  describe('SMTP', () => {
    let server;
    const received = [];
    let connections = 0;
    let dropNext = 0; // connections to close at once, like a network hiccup
    let rejectRecipients = false;

    // A minimal SMTP server that accepts every message.
    before(async () => {
      server = net.createServer((socket) => {
        connections += 1;
        if (dropNext > 0) {
          dropNext -= 1;
          socket.destroy();
          return;
        }
        let buffer = '';
        let message = null;
        const reply = (line) => socket.write(`${line}\r\n`);
        reply('220 localhost ESMTP test');
        socket.on('data', (chunk) => {
          buffer += chunk.toString('latin1');
          let end;
          while ((end = buffer.indexOf('\r\n')) !== -1) {
            const line = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (message) {
              if (line === '.') {
                received.push(message.join('\n'));
                message = null;
                reply('250 OK');
              } else {
                message.push(line);
              }
            } else if (/^DATA/i.test(line)) {
              message = [];
              reply('354 Go ahead');
            } else if (/^QUIT/i.test(line)) {
              reply('221 Bye');
              socket.end();
            } else if (rejectRecipients && /^RCPT TO/i.test(line)) {
              reply('550 No such user');
            } else {
              reply('250 OK');
            }
          }
        });
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    });

    after(() => new Promise((resolve) => server.close(resolve)));

    test('sends through nodemailer with MAIL_FROM as the sender, as plain text', async () => {
      const mailer = createMailer(testConfig({
        SMTP_HOST: '127.0.0.1', SMTP_PORT: String(server.address().port), SMTP_SECURE: 'false', MAIL_FROM: 'noreply@example.is',
      }));
      const email = await renderEmail('teacher_code', data);
      await mailer.send({ to: { name: 'Jóna Jónsdóttir', address: 'jona@example.is' }, ...email });
      assert.equal(received.length, 1);
      const [message] = received;
      assert.match(message, /^From: noreply@example\.is$/m);
      assert.match(message, /^To: .+ <jona@example\.is>$/m);
      assert.match(message, /^Content-Type: text\/plain; charset=utf-8/im);
      assert.doesNotMatch(message, /text\/html/);
    });

    const mailer = () => createMailer(testConfig({
      SMTP_HOST: '127.0.0.1', SMTP_PORT: String(server.address().port), SMTP_SECURE: 'false', MAIL_FROM: 'noreply@example.is',
    }), { retryDelayMs: 10 });
    const message = { to: { name: 'Jóna', address: 'jona@example.is' }, subject: 'Prófun', text: 'Texti' };

    test('a dropped connection is tried once more at once, so a network hiccup does not delay the email', async () => {
      received.length = 0;
      connections = 0;
      dropNext = 1;
      await mailer().send(message);
      assert.equal(connections, 2);
      assert.equal(received.length, 1);
    });

    test('a second failure in a row goes to the outbox, which retries later', async () => {
      received.length = 0;
      connections = 0;
      dropNext = 2;
      await assert.rejects(mailer().send(message), { code: 'ECONNECTION' });
      assert.equal(connections, 2, 'only one quick retry');
      assert.equal(received.length, 0);
    });

    test('an error that is not a network problem, such as a refused address, is not retried at once', async () => {
      connections = 0;
      rejectRecipients = true;
      try {
        await assert.rejects(mailer().send(message), { code: 'EENVELOPE' });
        assert.equal(connections, 1);
      } finally {
        rejectRecipients = false;
      }
    });
  });
});
